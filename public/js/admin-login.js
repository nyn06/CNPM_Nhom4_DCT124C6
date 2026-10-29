(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  let csrfToken = null;
  let busy = false;
  let disposed = false;
  let controller;
  const issues = new Map();
  let statusKey = 'js.admin_login.004';
  function messageKey(key) { statusKey = key; byId('login-status').textContent = window.ADMIN_I18N?.t(key) ?? key; }
  function showIssue(id, key) {
    const input = byId(id); const errorNode = byId(`${id}-error`);
    if (key) issues.set(id, key); else issues.delete(id);
    errorNode.textContent = key ? (window.ADMIN_I18N?.t(key) ?? key) : '';
    errorNode.hidden = !key;
    input.setAttribute('aria-invalid', String(Boolean(key)));
  }
  function issue(id) {
    const value = byId(id).value;
    if (!value.trim()) return id === 'login-username' ? 'js.admin_login.011' : 'js.admin_login.012';
    if (id === 'login-username' && value.length > 64) return 'js.admin_login.013';
    return null;
  }
  window.ADMIN_I18N?.onChange(() => {
    messageKey(statusKey);
    for (const [id, key] of issues) showIssue(id, key);
    const toggle = byId('toggle-login-password');
    const key = byId('login-password').type === 'password' ? 'js.admin_login.002' : 'js.admin_login.001';
    toggle.setAttribute('aria-label', window.ADMIN_I18N.t(key));
    toggle.setAttribute('title', window.ADMIN_I18N.t(key));
  });
  byId('toggle-login-password').addEventListener('click', () => {
    const password = byId('login-password');
    const toggle = byId('toggle-login-password');
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.setAttribute('aria-label', visible ? (window.ADMIN_I18N?.t('js.admin_login.001') ?? 'Ẩn mật khẩu') : (window.ADMIN_I18N?.t('js.admin_login.002') ?? 'Hiện mật khẩu'));
    toggle.setAttribute('title', visible ? (window.ADMIN_I18N?.t('js.admin_login.001') ?? 'Ẩn mật khẩu') : (window.ADMIN_I18N?.t('js.admin_login.002') ?? 'Hiện mật khẩu'));
  });
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
      messageKey('js.admin_login.003');
    } catch { if (!disposed) { messageKey('js.admin_login.004'); byId('login-retry').hidden = false; } }
    finally { busy = false; }
  }
  byId('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !csrfToken || disposed) return;
    for (const id of ['login-username', 'login-password']) showIssue(id, issue(id));
    const first = ['login-username', 'login-password'].find((id) => issues.has(id));
    if (first) { byId(first).focus(); return; }
    busy = true;
    byId('login-submit').disabled = true;
    messageKey('js.admin_login.005');
    try {
      const response = await request('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ username: byId('login-username').value, password: byId('login-password').value }),
      });
      if (disposed) return;
      if (response.ok) { window.location.replace('/admin.html'); return; }
      messageKey(response.status === 401 ? 'js.admin_login.006'
        : response.status === 429 ? 'js.admin_login.007'
          : response.status === 403 ? 'js.admin_login.008' : 'js.admin_login.009');
      if (response.status === 403) { csrfToken = null; byId('login-retry').hidden = false; }
    } catch { if (!disposed) messageKey('js.admin_login.010'); }
    finally { busy = false; byId('login-password').value = ''; byId('login-submit').disabled = !csrfToken; }
  });
  for (const id of ['login-username', 'login-password']) byId(id).addEventListener('input', () => {
    if (issues.has(id)) showIssue(id, issue(id));
  });
  byId('login-retry').addEventListener('click', prepare);
  window.addEventListener('pagehide', () => { disposed = true; controller?.abort(); byId('login-password').value = ''; });
  prepare();
})();
