(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const auth = window.ADMIN_AUTH;
  const t = (key, params) => window.ADMIN_I18N?.t(key, params) ?? key;
  const passwordIds = ['account-password', 'account-current-password', 'account-new-password', 'account-confirm-password'];
  let busy = false;
  let disposed = false;
  let allAccounts = [];
  let page = 1;
  let filters = { search: '', role: 'all', lock: 'all' };
  let renderedRows = [];
  let passwordTarget = null;
  let lastFocus = null;
  const controllers = new Set();
  const fieldIssues = new Map();
  let statusNotice = null;
  let modalStatusKey = null;
  const fieldIds = ['account-username', ...passwordIds];
  function messageKey(key, params = []) {
    statusNotice = key ? { key, params } : null;
    byId('account-status').textContent = key ? t(key, params) : '';
    byId('account-status').hidden = !key;
  }
  function modalMessage(key) {
    modalStatusKey = key;
    byId('account-modal-status').textContent = key ? t(key) : '';
  }
  function showField(id, issue) {
    const input = byId(id);
    const errorNode = byId(`${id}-error`);
    if (issue) fieldIssues.set(id, issue);
    else fieldIssues.delete(id);
    const active = fieldIssues.get(id);
    errorNode.textContent = active ? t(active.key, active.params) : '';
    errorNode.hidden = !active;
    input.setAttribute('aria-invalid', String(Boolean(active)));
  }
  function passwordIssue(value) {
    if (!value) return { key: 'js.accounts.024' };
    if (value.length < 12) return { key: 'js.accounts.025', params: [value.length] };
    const bytes = new TextEncoder().encode(value).length;
    if (bytes > 72) return { key: 'js.accounts.026', params: [bytes] };
    return null;
  }
  function usernameIssue(value) {
    if (!value.trim()) return { key: 'js.accounts.027' };
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(value.trim())) return { key: 'js.accounts.028' };
    return null;
  }
  function modalIssue(id) {
    const value = byId(id).value;
    if (id === 'account-current-password') return value ? null : { key: 'js.accounts.029' };
    if (id === 'account-new-password') return passwordIssue(value);
    if (!value) return { key: 'js.accounts.030' };
    if (value !== byId('account-new-password').value) return { key: 'html.admin.183' };
    if (passwordTarget?.id === auth.current()?.id && value === byId('account-current-password').value) return { key: 'html.admin.184' };
    return null;
  }

  async function request(url, method = 'GET', data) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', ...auth.headers(method), ...(data ? { 'Content-Type': 'application/json' } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}) });
      auth.handle(response);
      if (!response.ok) {
        const key = response.status === 409 ? (url === '/api/accounts' ? 'js.accounts.031'
          : method === 'PATCH' ? 'js.accounts.032' : 'js.accounts.033')
          : response.status === 403 ? 'js.accounts.002'
            : response.status === 400 ? (url === '/api/accounts/me/password' ? 'html.admin.186' : 'js.accounts.003') : 'js.accounts.004';
        const failure = new Error(t(key)); failure.key = key; throw failure;
      }
      try { return await response.json(); } catch { const failure = new Error(t('js.accounts.005')); failure.key = 'js.accounts.005'; throw failure; }
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }

  function matching() {
    return allAccounts.filter((account) => account.username.toLocaleLowerCase().includes(filters.search)
      && (filters.role === 'all' || account.role === filters.role)
      && (filters.lock === 'all' || account.isLocked === (filters.lock === 'locked')));
  }
  function roleName(role) { return t(role === 'ADMIN' ? 'html.admin.164' : 'html.admin.165'); }
  function setEye(button, input, shown = false) {
    input.type = shown ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(shown));
    button.setAttribute('aria-label', t(shown ? 'html.admin.172' : 'html.admin.171'));
    button.setAttribute('title', t(shown ? 'html.admin.172' : 'html.admin.171'));
  }
  for (const id of passwordIds) {
    const input = byId(id);
    const button = byId(`toggle-${id}`);
    setEye(button, input);
    button.addEventListener('click', () => setEye(button, input, input.type === 'password'));
  }
  function clearModal() {
    for (const id of passwordIds.slice(1)) {
      const input = byId(id);
      input.value = '';
      setEye(byId(`toggle-${id}`), input);
      showField(id, null);
    }
    modalMessage(null);
  }
  function closeModal() {
    byId('account-password-modal').hidden = true;
    passwordTarget = null;
    clearModal();
    lastFocus?.focus();
  }
  function modalText() {
    if (!passwordTarget) return;
    const own = passwordTarget.id === auth.current()?.id;
    byId('account-modal-title').textContent = t(own ? 'html.admin.173' : 'html.admin.174');
    byId('account-modal-description').textContent = t('html.admin.175', [passwordTarget.username]);
    byId('account-modal-submit').textContent = t(own ? 'html.admin.173' : 'html.admin.174');
  }
  function openModal(account, button) {
    if (busy) return;
    passwordTarget = account;
    lastFocus = button;
    clearModal();
    const own = account.id === auth.current()?.id;
    byId('account-current-field').hidden = !own;
    byId('account-current-password').required = own;
    modalText();
    byId('account-password-modal').hidden = false;
    byId(own ? 'account-current-password' : 'account-new-password').focus();
  }
  function makeButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `button ${className}`; button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }
  function render() {
    const filtered = matching();
    const pages = Math.max(1, Math.ceil(filtered.length / 10));
    page = Math.min(page, pages);
    const visible = filtered.slice((page - 1) * 10, page * 10);
    renderedRows = [];
    byId('account-rows').replaceChildren(...visible.map((account, index) => {
      const row = document.createElement('tr');
      const number = document.createElement('td'); number.textContent = String((page - 1) * 10 + index + 1);
      const identity = document.createElement('td'); identity.textContent = account.username;
      const own = account.id === auth.current()?.id;
      const roleCell = document.createElement('td');
      const role = document.createElement('select');
      role.setAttribute('aria-label', t('js.accounts.006', [account.username]));
      role.disabled = own;
      for (const value of ['ADMIN', 'POI_MANAGER']) {
        const option = document.createElement('option'); option.value = value; option.textContent = roleName(value); role.append(option);
      }
      role.value = account.role; roleCell.append(role);
      if (own) role.setAttribute('title', t('html.admin.176'));
      const statusCell = document.createElement('td');
      const badge = document.createElement('span'); badge.className = 'badge'; badge.dataset.tone = account.isLocked ? 'error' : 'success';
      badge.textContent = t(account.isLocked ? 'js.accounts.007' : 'js.accounts.008'); statusCell.append(badge);
      const actionsCell = document.createElement('td');
      const actions = document.createElement('div'); actions.className = 'account-row-actions';
      const save = makeButton(t('js.accounts.010'), 'secondary', () => {
        if (own || role.value === account.role) return;
        mutate(() => request(`/api/accounts/${encodeURIComponent(account.id)}`, 'PATCH', { role: role.value }), 'js.accounts.011');
      });
      save.disabled = true;
      if (own) save.setAttribute('title', t('html.admin.176'));
      role.addEventListener('change', () => { save.disabled = own || role.value === account.role || busy; });
      const lock = makeButton(t(account.isLocked ? 'html.admin.177' : 'html.admin.178'), 'secondary', () => {
        if (own) return;
        mutate(() => request(`/api/accounts/${encodeURIComponent(account.id)}`, 'PATCH', { isLocked: !account.isLocked }),
          account.isLocked ? 'html.admin.179' : 'html.admin.180');
      });
      lock.disabled = own;
      if (own) lock.setAttribute('title', t('html.admin.181'));
      const password = makeButton(t(own ? 'html.admin.173' : 'html.admin.174'), 'secondary', () => openModal(account, password));
      actions.append(save, lock, password); actionsCell.append(actions);
      row.append(number, identity, roleCell, statusCell, actionsCell);
      renderedRows.push({ account, role, badge, save, lock, password });
      return row;
    }));
    byId('account-page').textContent = t('js.accounts.016', [page, pages, filtered.length]);
    byId('account-prev').disabled = page <= 1;
    byId('account-next').disabled = page >= pages;
    if (!visible.length) messageKey(allAccounts.length ? 'js.accounts.017' : 'js.accounts.018');
  }
  async function load() {
    messageKey('js.accounts.020');
    const accounts = await request('/api/accounts');
    if (disposed) return;
    if (!Array.isArray(accounts) || accounts.some((account) => !account || typeof account.id !== 'string'
      || typeof account.username !== 'string' || !['ADMIN', 'POI_MANAGER'].includes(account.role)
      || typeof account.isLocked !== 'boolean')) throw new Error(t('js.accounts.021'));
    allAccounts = accounts.sort((a, b) => a.username.localeCompare(b.username) || a.id.localeCompare(b.id));
    byId('account-stat-total').textContent = String(accounts.length);
    byId('account-stat-admin').textContent = String(accounts.filter((account) => account.role === 'ADMIN').length);
    byId('account-stat-manager').textContent = String(accounts.filter((account) => account.role === 'POI_MANAGER').length);
    byId('account-stat-locked').textContent = String(accounts.filter((account) => account.isLocked).length);
    render();
    if (matching().length) messageKey(null);
  }
  async function mutate(work, successKey) {
    if (busy || disposed || auth.current()?.role !== 'ADMIN') return false;
    busy = true; byId('create-account').disabled = true; byId('reload-accounts').disabled = true;
    try { await work(); if (!disposed) { await load(); if (successKey) messageKey(successKey); } return true; }
    catch (error) {
      if (!disposed) messageKey(error instanceof TypeError || error.name === 'AbortError' ? 'js.accounts.022' : error.key || 'js.accounts.004');
      return false;
    } finally { busy = false; byId('create-account').disabled = false; byId('reload-accounts').disabled = false; }
  }
  byId('account-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const username = byId('account-username').value.trim();
    const password = byId('account-password').value;
    showField('account-username', usernameIssue(username));
    showField('account-password', passwordIssue(password));
    const first = ['account-username', 'account-password'].find((id) => fieldIssues.has(id));
    if (first) { byId(first).focus(); return; }
    mutate(async () => {
      try {
        await request('/api/accounts', 'POST', { username, password, role: byId('account-role').value });
        byId('account-username').value = '';
      } catch (error) {
        if (error.key === 'js.accounts.031') showField('account-username', { key: error.key });
        throw error;
      }
      finally { byId('account-password').value = ''; setEye(byId('toggle-account-password'), byId('account-password')); }
    }, 'js.accounts.023');
  });
  byId('account-username').addEventListener('input', () => { if (fieldIssues.has('account-username')) showField('account-username', usernameIssue(byId('account-username').value)); });
  byId('account-password').addEventListener('input', () => { if (fieldIssues.has('account-password')) showField('account-password', passwordIssue(byId('account-password').value)); });
  byId('account-search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    filters = { search: byId('account-search').value.trim().toLocaleLowerCase(), role: byId('account-role-filter').value || 'all',
      lock: byId('account-lock-filter').value || 'all' };
    page = 1; render();
  });
  byId('account-search-reset').addEventListener('click', () => {
    byId('account-search').value = ''; byId('account-role-filter').value = 'all'; byId('account-lock-filter').value = 'all';
    filters = { search: '', role: 'all', lock: 'all' }; page = 1; render();
    if (allAccounts.length) messageKey(null);
  });
  byId('account-prev').addEventListener('click', () => { if (page > 1) { page--; render(); } });
  byId('account-next').addEventListener('click', () => { page++; render(); });
  byId('reload-accounts').addEventListener('click', () => mutate(async () => {}));
  byId('account-modal-cancel').addEventListener('click', closeModal);
  byId('account-password-modal').addEventListener('click', (event) => { if (event.target === byId('account-password-modal')) closeModal(); });
  byId('account-password-modal').addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });
  for (const id of passwordIds.slice(1)) {
    byId(id).addEventListener('input', () => {
      if (fieldIssues.has(id)) showField(id, modalIssue(id));
      if (id === 'account-new-password' && fieldIssues.has('account-confirm-password')) showField('account-confirm-password', modalIssue('account-confirm-password'));
      if (modalStatusKey) modalMessage(null);
    });
  }
  byId('account-password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!passwordTarget || busy) return;
    const own = passwordTarget.id === auth.current()?.id;
    const current = byId('account-current-password').value;
    const next = byId('account-new-password').value;
    for (const id of passwordIds.slice(1)) showField(id, id === 'account-current-password' && !own ? null : modalIssue(id));
    const first = passwordIds.slice(1).find((id) => fieldIssues.has(id));
    if (first) { byId(first).focus(); return; }
    const target = passwordTarget;
    if (own) {
      busy = true; byId('account-modal-submit').disabled = true;
      try {
        await request('/api/accounts/me/password', 'POST', { currentPassword: current, newPassword: next });
        if (!disposed) { closeModal(); messageKey('html.admin.185'); setTimeout(() => auth.expire(), 1800); }
      } catch (error) {
        if (!disposed) {
          const key = error instanceof TypeError || error.name === 'AbortError' ? 'js.accounts.022' : error.key || 'js.accounts.004';
          if (key === 'html.admin.186') showField('account-current-password', { key });
          else modalMessage(key);
        }
      } finally { busy = false; byId('account-modal-submit').disabled = false; }
      return;
    }
    const success = await mutate(() => request(`/api/accounts/${encodeURIComponent(target.id)}/password`, 'POST', { password: next }), 'js.accounts.015');
    if (success) closeModal();
    else modalMessage(statusNotice?.key || 'js.accounts.004');
  });
  window.ADMIN_I18N?.onChange(() => {
    for (const { account, role, badge, save, lock, password } of renderedRows) {
      role.setAttribute('aria-label', t('js.accounts.006', [account.username]));
      role.children[0].textContent = roleName('ADMIN'); role.children[1].textContent = roleName('POI_MANAGER');
      badge.textContent = t(account.isLocked ? 'js.accounts.007' : 'js.accounts.008');
      save.textContent = t('js.accounts.010');
      lock.textContent = t(account.isLocked ? 'html.admin.177' : 'html.admin.178');
      password.textContent = t(account.id === auth.current()?.id ? 'html.admin.173' : 'html.admin.174');
      if (role.disabled) { role.setAttribute('title', t('html.admin.176')); save.setAttribute('title', t('html.admin.176')); lock.setAttribute('title', t('html.admin.181')); }
    }
    for (const id of passwordIds) setEye(byId(`toggle-${id}`), byId(id), byId(id).type === 'text');
    modalText();
    const count = matching().length;
    byId('account-page').textContent = t('js.accounts.016', [page, Math.max(1, Math.ceil(count / 10)), count]);
    for (const id of fieldIds) if (fieldIssues.has(id)) showField(id, fieldIssues.get(id));
    if (modalStatusKey) modalMessage(modalStatusKey);
    if (statusNotice) messageKey(statusNotice.key, statusNotice.params);
  });
  auth.onLost(() => { disposed = true; for (const controller of controllers) controller.abort(); byId('account-rows').replaceChildren(); byId('account-password').value = ''; closeModal(); });
  window.addEventListener('pagehide', () => { disposed = true; for (const controller of controllers) controller.abort(); clearModal(); });
  auth.ready.then((user) => { if (user?.role === 'ADMIN') mutate(async () => {}); });
})();
