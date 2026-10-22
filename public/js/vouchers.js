(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const auth = window.ADMIN_AUTH;
  let busy = false;
  let disposed = false;
  let controller = null;
  let createdVoucherId = null;
  const statuses = { unused: 'Chưa kích hoạt', redeemed: 'Đã kích hoạt', expired: 'Phiên đã hết hạn' };
  const voucherStatus = (voucher) => `Vé ${voucher.durationMinutes} phút · ${statuses[voucher.status] || 'Không xác định'}.`;
  function message(text, tone = 'neutral') {
    byId('voucher-message').textContent = text;
    byId('voucher-message').dataset.tone = tone;
  }
  async function request(method = 'GET', body) {
    controller = new AbortController();
    const current = controller;
    const timer = setTimeout(() => current.abort(), 10000);
    try {
      const response = await fetch('/api/access/vouchers', {
        method, signal: current.signal, cache: 'no-store', credentials: 'same-origin',
        headers: { Accept: 'application/json', ...auth.headers(method), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      auth.handle(response);
      if (!response.ok) throw new Error(response.status === 401 ? 'Phiên quản trị đã hết hạn. Hãy đăng nhập lại.' : response.status === 403
        ? 'Chỉ ADMIN được quản lý voucher; hãy kiểm tra quyền hoặc tải lại trang.'
        : 'Không xử lý được vé. Kiểm tra thời hạn và PUBLIC_ORIGIN rồi thử lại.');
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError || error instanceof SyntaxError) {
        throw new Error('Không tải được vé. Kiểm tra kết nối và server rồi thử lại.');
      }
      throw error;
    } finally { clearTimeout(timer); if (controller === current) controller = null; }
  }
  async function load() {
    const vouchers = await request();
    if (disposed) return;
    if (!Array.isArray(vouchers)) throw new Error('Danh sách vé không hợp lệ.');
    const created = vouchers.find((voucher) => voucher.id === createdVoucherId);
    if (created) byId('created-voucher-status').textContent = voucherStatus(created);
    byId('voucher-list').replaceChildren(...vouchers.map((voucher) => {
      const row = document.createElement('li');
      row.textContent = `${voucher.id} · ${voucher.durationMinutes} phút · ${statuses[voucher.status] || 'Không xác định'}${voucher.expiresAt ? ` · hết hạn ${new Date(voucher.expiresAt).toLocaleString('vi-VN')}` : ''}`;
      return row;
    }));
  }
  async function work(create = false) {
    if (busy || disposed || auth.current()?.role !== 'ADMIN') return;
    busy = true;
    byId('create-voucher').disabled = true;
    byId('reload-vouchers').disabled = true;
    byId('voucher-list').setAttribute('aria-busy', 'true');
    try {
      if (create) {
        const voucher = await request('POST', { durationMinutes: Number(byId('voucher-duration').value) });
        if (disposed) return;
        const url = new URL(voucher.activationUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.searchParams.get('voucher') !== voucher.code
          || !/^[A-Za-z0-9]{7}$/.test(voucher.activationCode)
          || typeof voucher.qrSvg !== 'string' || !voucher.qrSvg.startsWith('<svg')) throw new Error('QR trả về không hợp lệ.');
        byId('voucher-qr').src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(voucher.qrSvg)}`;
        byId('activation-url').value = voucher.activationUrl;
        byId('activation-code').value = voucher.activationCode;
        createdVoucherId = voucher.id;
        byId('created-voucher-status').textContent = voucherStatus(voucher);
        byId('voucher-result').hidden = false;
        message('Đã tạo vé. Lưu QR, URL hoặc mã kích hoạt ngay; danh sách không tiết lộ lại mã vé.', 'success');
      }
      await load();
    } catch (error) { if (!disposed) message(error.message, 'error'); }
    finally {
      busy = false;
      byId('create-voucher').disabled = false;
      byId('reload-vouchers').disabled = false;
      byId('voucher-list').setAttribute('aria-busy', 'false');
    }
  }
  byId('voucher-form').addEventListener('submit', (event) => { event.preventDefault(); work(true); });
  byId('reload-vouchers').addEventListener('click', () => work());
  byId('copy-voucher-url').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(byId('activation-url').value); message('Đã sao chép URL kích hoạt.', 'success'); }
    catch { message('Không sao chép tự động được. Hãy chọn và sao chép URL trong ô phía trên.', 'info'); }
  });
  byId('copy-activation-code').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(byId('activation-code').value); message('Đã sao chép mã kích hoạt.', 'success'); }
    catch { message('Không sao chép tự động được. Hãy chọn và sao chép mã trong ô phía trên.', 'info'); }
  });
  window.addEventListener('pagehide', () => { disposed = true; if (controller) controller.abort(); });
  auth.onLost(() => { disposed = true; controller?.abort(); byId('voucher-result').hidden = true; byId('activation-url').value = ''; byId('activation-code').value = ''; byId('voucher-qr').removeAttribute('src'); });
  auth.ready.then((user) => { if (user?.role === 'ADMIN') work(); });
})();
