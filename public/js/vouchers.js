(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  let busy = false;
  let disposed = false;
  let controller = null;
  const statuses = { unused: 'Chưa kích hoạt', redeemed: 'Đã kích hoạt', expired: 'Phiên đã hết hạn' };
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
        method, signal: current.signal, cache: 'no-store',
        headers: { Accept: 'application/json', 'X-Demo-Admin': 'true', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error(response.status === 403
        ? 'Quản lý vé chỉ dùng trong demo local. Cần bật DEMO_ADMIN_ENABLED=true; production luôn bị chặn.'
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
    byId('voucher-list').replaceChildren(...vouchers.map((voucher) => {
      const row = document.createElement('li');
      row.textContent = `${voucher.id} · ${voucher.durationMinutes} phút · ${statuses[voucher.status] || 'Không xác định'}${voucher.expiresAt ? ` · hết hạn ${new Date(voucher.expiresAt).toLocaleString('vi-VN')}` : ''}`;
      return row;
    }));
  }
  async function work(create = false) {
    if (busy || disposed) return;
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
          || typeof voucher.qrSvg !== 'string' || !voucher.qrSvg.startsWith('<svg')) throw new Error('QR trả về không hợp lệ.');
        byId('voucher-qr').src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(voucher.qrSvg)}`;
        byId('activation-url').value = voucher.activationUrl;
        byId('created-voucher-status').textContent = `Vé ${voucher.durationMinutes} phút · Chưa kích hoạt. Dùng danh sách bên dưới để xem trạng thái mới.`;
        byId('voucher-origin-note').textContent = voucher.mobileReady
          ? 'QR dùng origin HTTPS đã cấu hình. Điện thoại cần truy cập được origin này.'
          : 'QR chỉ phục vụ demo local; chưa sẵn sàng dùng từ điện thoại khác. Cần origin HTTPS công khai phù hợp.';
        byId('voucher-result').hidden = false;
        message('Đã tạo vé. Lưu QR hoặc URL ngay; danh sách không tiết lộ lại mã vé.', 'success');
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
  window.addEventListener('pagehide', () => { disposed = true; if (controller) controller.abort(); });
  work();
})();
