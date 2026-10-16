(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const storageKey = 'tourist-access-token';
  const listeners = new Set();
  let token = null;
  let deadline = 0;
  let timer = null;
  let busy = false;
  let disposed = false;
  let controller = null;
  let requestStartedAt = 0;

  function message(text, tone = 'neutral') {
    byId('access-message').textContent = text;
    byId('access-message').dataset.tone = tone;
  }

  function active() { return !!token && performance.now() < deadline && !disposed; }
  function notify() {
    byId('toggle-tour').disabled = !active();
    for (const listener of listeners) listener(active());
  }

  function lose(text = 'Phiên truy cập đã hết hạn. Hãy kích hoạt vé khác.') {
    token = null;
    deadline = 0;
    clearTimeout(timer);
    timer = null;
    try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be blocked. */ }
    byId('access-status').textContent = 'Chưa có phiên hợp lệ';
    byId('access-countdown').textContent = '00:00';
    byId('access-expiry').textContent = '—';
    message(text, 'error');
    notify();
  }

  function tick() {
    clearTimeout(timer);
    if (!active()) { lose(); return; }
    const seconds = Math.ceil((deadline - performance.now()) / 1000);
    byId('access-countdown').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    timer = setTimeout(tick, Math.min(1000, deadline - performance.now()));
  }

  function accept(data, accessToken) {
    const serverRemaining = Date.parse(data?.expiresAt) - Date.parse(data?.serverTime);
    const remaining = serverRemaining - Math.max(0, performance.now() - requestStartedAt);
    if (!/^[a-f0-9]{64}$/.test(accessToken || '') || ![15, 60, 120].includes(data?.durationMinutes)
      || !Number.isFinite(remaining) || remaining <= 0 || serverRemaining > data.durationMinutes * 60000) {
      throw new Error('Phản hồi phiên không hợp lệ. Hãy kiểm tra server.');
    }
    token = accessToken;
    // Countdown uses server time + monotonic elapsed time, not the wall clock.
    // Backend still checks its own expiry on every protected request.
    deadline = performance.now() + remaining;
    try { sessionStorage.setItem(storageKey, token); } catch { /* Memory-only fallback. */ }
    byId('access-status').textContent = `Đã kích hoạt · ${data.durationMinutes} phút`;
    byId('access-expiry').textContent = new Date(data.expiresAt).toLocaleString('vi-VN');
    message('Vé có hiệu lực cho mọi POI đang hoạt động. Bấm Bắt đầu tham quan.', 'success');
    tick();
    notify();
  }

  async function request(url, options) {
    // Subtract the full round trip conservatively: a slow response must never
    // extend local playback beyond the duration supplied by the server.
    requestStartedAt = performance.now();
    controller = new AbortController();
    const current = controller;
    const timeout = setTimeout(() => current.abort(), 10000);
    try {
      const response = await fetch(url, { ...options, signal: current.signal, cache: 'no-store' });
      if (!response.ok) {
        if (response.status === 409) throw new Error('Vé đã được dùng. Hãy kích hoạt một mã vé khác.');
        if (response.status === 400) throw new Error('Mã vé không hợp lệ. Hãy kiểm tra lại.');
        if (response.status === 401) throw new Error('Phiên không hợp lệ hoặc đã hết hạn. Hãy kích hoạt vé khác.');
        throw new Error('Server chưa xử lý được yêu cầu. Hãy thử lại.');
      }
      try { return await response.json(); } catch { throw new Error('Phản hồi phiên không hợp lệ.'); }
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) {
        throw new Error('Không kết nối được server hoặc đã quá thời gian chờ. Kiểm tra mạng; nếu vé đã dùng, cần mã khác.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (controller === current) controller = null;
    }
  }

  async function redeem(event) {
    event.preventDefault();
    if (busy || disposed) return;
    const code = byId('voucher-code').value.trim();
    if (!/^[a-f0-9]{64}$/.test(code)) { message('Nhập mã vé hợp lệ để kích hoạt.', 'error'); return; }
    busy = true;
    byId('activate-voucher').disabled = true;
    message('Đang kích hoạt vé…');
    try {
      const data = await request('/api/access/redeem', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (disposed) return;
      // Switching tickets also cancels playback/requests from the old session.
      if (token) lose('Đang chuyển sang vé mới.');
      accept(data, data.accessToken);
      byId('voucher-code').value = '';
      const url = new URL(window.location.href);
      url.searchParams.delete('voucher');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (error) { if (!disposed) message(error.message, 'error'); }
    finally { busy = false; byId('activate-voucher').disabled = false; }
  }

  async function checkSession(savedToken = token) {
    if (!savedToken || busy || disposed) return;
    busy = true;
    byId('activate-voucher').disabled = true;
    try {
      const data = await request('/api/access/session', { headers: { Authorization: `Bearer ${savedToken}`, Accept: 'application/json' } });
      if (!disposed) accept(data, savedToken);
    } catch (error) { if (!disposed) lose(error.message); }
    finally { busy = false; byId('activate-voucher').disabled = false; }
  }

  window.TOUR_ACCESS = {
    active,
    headers: () => active() ? { Authorization: `Bearer ${token}` } : {},
    lose,
    subscribe: (listener) => { listeners.add(listener); listener(active()); },
  };
  byId('access-form').addEventListener('submit', redeem);
  byId('toggle-tour').disabled = true;
  const code = new URL(window.location.href).searchParams.get('voucher');
  if (code) {
    byId('voucher-code').value = code;
    message('Đã nhận mã từ QR. Bấm Kích hoạt vé để bắt đầu thời hạn; mở liên kết chưa dùng vé.');
  }
  let savedToken;
  try { savedToken = sessionStorage.getItem(storageKey); } catch { /* Start inactive. */ }
  if (savedToken) checkSession(savedToken);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && token) checkSession(); });
  window.addEventListener('pagehide', () => {
    disposed = true;
    clearTimeout(timer);
    if (controller) controller.abort();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) { disposed = false; if (token) checkSession(); }
  });
})();
