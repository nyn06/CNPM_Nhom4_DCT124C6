(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const auth = window.ADMIN_AUTH;
  let busy = false;
  let disposed = false;
  const controllers = new Set();
  const message = (text) => { byId('account-status').textContent = text; };
  const accountHint = byId('account-status').textContent;
  async function request(url, method = 'GET', data) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', ...auth.headers(method), ...(data ? { 'Content-Type': 'application/json' } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}) });
      auth.handle(response);
      if (!response.ok) throw new Error(response.status === 409 ? 'Thao tác xung đột: kiểm tra username hoặc ADMIN hoạt động cuối cùng.'
        : response.status === 403 ? 'Bạn không có quyền quản lý tài khoản hoặc CSRF token đã thay đổi.'
          : response.status === 400 ? 'Kiểm tra username, role và mật khẩu (12 ký tự trở lên, tối đa 72 byte UTF-8).'
            : 'Không thực hiện được thao tác tài khoản.');
      try { return await response.json(); } catch { throw new Error('Phản hồi tài khoản không hợp lệ. Hãy thử tải lại.'); }
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  async function load() {
    const accounts = await request('/api/accounts');
    if (disposed) return;
    if (!Array.isArray(accounts)) throw new Error('Danh sách tài khoản không hợp lệ.');
    byId('account-rows').replaceChildren(...accounts.map((account) => {
      const row = document.createElement('tr');
      const identity = document.createElement('td'); identity.textContent = account.username;
      const roleCell = document.createElement('td');
      const role = document.createElement('select'); role.setAttribute('aria-label', `Vai trò của ${account.username}`);
      for (const name of ['ADMIN', 'POI_MANAGER']) { const option = document.createElement('option'); option.value = name; option.textContent = name; role.append(option); }
      role.value = account.role; roleCell.append(role);
      const lockCell = document.createElement('td');
      const label = document.createElement('label'); const locked = document.createElement('input'); locked.type = 'checkbox'; locked.checked = account.isLocked;
      label.append(locked, document.createTextNode(' Khóa')); lockCell.append(label);
      const actions = document.createElement('td');
      const save = document.createElement('button'); save.type = 'button'; save.className = 'button secondary'; save.textContent = 'Lưu quyền';
      save.addEventListener('click', () => mutate(async () => {
        await request(`/api/accounts/${encodeURIComponent(account.id)}`, 'PATCH', { role: role.value, isLocked: locked.checked });
        if (account.id === auth.current()?.id) auth.expire();
      }));
      const password = document.createElement('input'); password.type = 'password'; password.autocomplete = 'new-password'; password.placeholder = 'Mật khẩu mới';
      password.setAttribute('aria-label', `Mật khẩu mới cho ${account.username}`);
      const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'button secondary'; reset.textContent = 'Reset mật khẩu';
      reset.addEventListener('click', () => mutate(async () => {
        try {
          await request(`/api/accounts/${encodeURIComponent(account.id)}/password`, 'POST', { password: password.value });
          if (account.id === auth.current()?.id) auth.expire();
        } finally { password.value = ''; }
      }));
      actions.append(save, password, reset); row.append(identity, roleCell, lockCell, actions); return row;
    }));
  }
  async function mutate(work) {
    if (busy || disposed || auth.current()?.role !== 'ADMIN') return;
    busy = true; byId('create-account').disabled = true; byId('reload-accounts').disabled = true;
    try { await work(); if (!disposed) { await load(); message(accountHint); } }
    catch (error) { if (!disposed) message(error instanceof TypeError || error.name === 'AbortError' ? 'Không kết nối được server. Hãy thử lại.' : error.message); }
    finally { busy = false; byId('create-account').disabled = false; byId('reload-accounts').disabled = false; }
  }
  byId('account-form').addEventListener('submit', (event) => {
    event.preventDefault();
    mutate(async () => {
      try { await request('/api/accounts', 'POST', { username: byId('account-username').value, password: byId('account-password').value, role: byId('account-role').value }); }
      finally { byId('account-password').value = ''; }
    });
  });
  byId('reload-accounts').addEventListener('click', () => mutate(async () => {}));
  auth.onLost(() => { disposed = true; for (const controller of controllers) controller.abort(); byId('account-rows').replaceChildren(); byId('account-password').value = ''; });
  window.addEventListener('pagehide', () => { disposed = true; for (const controller of controllers) controller.abort(); });
  auth.ready.then((user) => { if (user?.role === 'ADMIN') mutate(async () => {}); });
})();
