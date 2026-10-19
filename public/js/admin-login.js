(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  let csrfToken = null;
  let busy = false;
  let disposed = false;
  let controller;
  byId('toggle-login-password').addEventListener('click', () => {
    const password = byId('login-password');
    const toggle = byId('toggle-login-password');
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.setAttribute('aria-label', visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    toggle.setAttribute('title', visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
  });
  function message(text) { byId('login-status').textContent = text; }
  async function request(url, options = {}) {
    controller = new AbortController();
    const current = controller;
    const timer = setTimeout(() => current.abort(), 10000);
    try { return await fetch(url, { ...options, credentials: 'same-origin', cache: 'no-store', signal: current.signal }); }
    finally { clearTimeout(timer); }
  }
  async function prepare() {
    if (busy || disposed) return;
    busy = true;
    byId('login-submit').disabled = true;
    byId('login-retry').hidden = true;
    try {
      const response = await request('/api/auth/csrf');
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!/^[a-f0-9]{64}$/.test(data.csrfToken || '')) throw new Error();
      if (disposed) return;
      csrfToken = data.csrfToken;
      byId('login-submit').disabled = false;
      message('Nhập tài khoản được ADMIN cấp.');
    } catch { if (!disposed) { message('Không chuẩn bị được phiên đăng nhập. Kiểm tra kết nối và thử lại.'); byId('login-retry').hidden = false; } }
    finally { busy = false; }
  }
  byId('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !csrfToken || disposed) return;
    busy = true;
    byId('login-submit').disabled = true;
    message('Đang đăng nhập…');
    try {
      const response = await request('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ username: byId('login-username').value, password: byId('login-password').value }),
      });
      if (disposed) return;
      if (response.ok) { window.location.replace('/admin.html'); return; }
      message(response.status === 401 ? 'Tên đăng nhập hoặc mật khẩu không đúng.'
        : response.status === 429 ? 'Quá nhiều lần đăng nhập. Hãy thử lại sau 15 phút.'
          : response.status === 403 ? 'Phiên bảo vệ đã thay đổi. Bấm Thử kết nối lại.' : 'Không đăng nhập được. Hãy thử lại.');
      if (response.status === 403) { csrfToken = null; byId('login-retry').hidden = false; }
    } catch { if (!disposed) message('Không kết nối được server. Hãy kiểm tra mạng và thử lại.'); }
    finally { busy = false; byId('login-password').value = ''; byId('login-submit').disabled = !csrfToken; }
  });
  byId('login-retry').addEventListener('click', prepare);
  window.addEventListener('pagehide', () => { disposed = true; controller?.abort(); byId('login-password').value = ''; });
  prepare();
})();
