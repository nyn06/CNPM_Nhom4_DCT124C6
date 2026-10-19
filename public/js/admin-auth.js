(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const listeners = new Set();
  let csrfToken = null;
  let user = null;
  let timer;
  let disposed = false;
  let controller;
  function expire() {
    if (disposed) return;
    disposed = true;
    user = null; csrfToken = null;
    byId('admin-shell').hidden = true;
    byId('admin-identity').textContent = 'Phiên quản trị đã kết thúc';
    clearTimeout(timer);
    for (const listener of listeners) listener();
    window.location.replace('/admin-login.html');
  }
  async function initialize() {
    controller = new AbortController();
    const current = controller;
    const timeout = setTimeout(() => current.abort(), 10000);
    const started = performance.now();
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store', signal: current.signal });
      if (!response.ok) throw new Error();
      const data = await response.json();
      const remaining = Date.parse(data.expiresAt) - Date.parse(data.serverTime) - (performance.now() - started);
      if (!data.user || !['ADMIN', 'POI_MANAGER'].includes(data.user.role) || !/^[a-f0-9]{64}$/.test(data.csrfToken || '')
        || !Number.isFinite(remaining) || remaining <= 0) throw new Error();
      if (disposed) return null;
      user = data.user;
      csrfToken = data.csrfToken;
      byId('admin-identity').textContent = `${user.username} · ${user.role}`;
      byId('admin-shell').hidden = false;
      byId('voucher-management').hidden = user.role !== 'ADMIN';
      byId('account-management').hidden = user.role !== 'ADMIN';
      timer = setTimeout(expire, remaining);
      return user;
    } catch { expire(); return null; }
    finally { clearTimeout(timeout); }
  }
  const api = {
    headers: (method = 'GET') => !['GET', 'HEAD'].includes(method) && csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
    handle: (response) => { if (response.status === 401) expire(); },
    onLost: (listener) => listeners.add(listener),
    expire,
    current: () => user,
  };
  window.ADMIN_AUTH = api;
  byId('admin-logout').addEventListener('click', async () => {
    if (disposed || !csrfToken) return;
    byId('admin-logout').disabled = true;
    const current = new AbortController();
    const timeout = setTimeout(() => current.abort(), 10000);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: current.signal,
        headers: { 'Content-Type': 'application/json', ...api.headers('POST') }, body: '{}' });
      if (response.ok || response.status === 401) expire();
      else byId('admin-session-status').textContent = 'Chưa đăng xuất được. Tải lại trang và thử lại.';
    } catch { byId('admin-session-status').textContent = 'Mất kết nối; phiên trên server có thể còn hiệu lực. Hãy thử Đăng xuất lại.'; }
    finally { clearTimeout(timeout); byId('admin-logout').disabled = false; }
  });
  window.addEventListener('pagehide', () => { disposed = true; clearTimeout(timer); controller?.abort(); byId('admin-shell').hidden = true; });
  // A cached Admin page must revalidate before exposing controls again.
  window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
  api.ready = initialize();
})();
