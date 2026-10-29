(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const listeners = new Set();
  let csrfToken = null;
  let user = null;
  let timer;
  let disposed = false;
  function renderIdentity() {
    if (!user) return;
    const role = window.ADMIN_I18N?.t(user.role === 'ADMIN' ? 'html.admin.164' : 'html.admin.165') ?? user.role;
    byId('admin-identity').textContent = `${user.username} · ${role}`;
  }
  let controller;
  function expire() {
    if (disposed) return;
    disposed = true;
    user = null; csrfToken = null;
    byId('admin-shell').hidden = true;
    byId('admin-identity').textContent = (window.ADMIN_I18N?.t('js.admin_auth.001') ?? 'Phiên quản trị đã kết thúc');
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
      renderIdentity();
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

  const logoutButton = byId('admin-logout');
  const logoutModal = byId('admin-logout-modal');
  const logoutCancel = byId('admin-logout-cancel');
  const logoutConfirm = byId('admin-logout-confirm');
  window.ADMIN_I18N?.onChange(() => {
    renderIdentity();
    logoutConfirm.textContent = logoutConfirm.disabled
      ? window.ADMIN_I18N.t('js.admin_auth.002') : window.ADMIN_I18N.t('js.admin_auth.005');
    byId('admin-session-status').textContent = '';
  });

  function closeLogoutModal() {
    if (logoutModal.hidden) return;
    logoutModal.hidden = true;
    logoutButton.focus();
  }

  function openLogoutModal() {
    if (disposed || !csrfToken || logoutButton.disabled) return;
    logoutModal.hidden = false;
    logoutCancel.focus();
  }

  logoutButton.addEventListener('click', openLogoutModal);

  logoutCancel.addEventListener('click', closeLogoutModal);

  logoutModal.addEventListener('click', (event) => {
    if (event.target === logoutModal) closeLogoutModal();
  });

  logoutModal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLogoutModal();
    }
  });

  logoutConfirm.addEventListener('click', async () => {
    if (disposed || !csrfToken || logoutButton.disabled) return;

    logoutButton.disabled = true;
    logoutCancel.disabled = true;
    logoutConfirm.disabled = true;
    logoutConfirm.textContent = (window.ADMIN_I18N?.t('js.admin_auth.002') ?? 'Đang đăng xuất…');

    const current = new AbortController();
    const timeout = setTimeout(() => current.abort(), 10000);

    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: current.signal,
        headers: {
          'Content-Type': 'application/json',
          ...api.headers('POST')
        },
        body: '{}'
      });

      if (response.ok || response.status === 401) {
        expire();
      } else {
        byId('admin-session-status').textContent =
          (window.ADMIN_I18N?.t('js.admin_auth.003') ?? 'Chưa đăng xuất được. Tải lại trang và thử lại.');
        logoutModal.hidden = true;
      }
    } catch {
      byId('admin-session-status').textContent =
        (window.ADMIN_I18N?.t('js.admin_auth.004') ?? 'Mất kết nối; phiên trên server có thể còn hiệu lực. Hãy thử Đăng xuất lại.');
      logoutModal.hidden = true;
    } finally {
      clearTimeout(timeout);
      logoutButton.disabled = false;
      logoutCancel.disabled = false;
      logoutConfirm.disabled = false;
      logoutConfirm.textContent = (window.ADMIN_I18N?.t('js.admin_auth.005') ?? 'Tiếp tục');
    }
  });

  window.addEventListener('pagehide', () => { disposed = true; clearTimeout(timer); controller?.abort(); byId('admin-shell').hidden = true; });
  // A cached Admin page must revalidate before exposing controls again.
  window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
  api.ready = initialize();
})();
