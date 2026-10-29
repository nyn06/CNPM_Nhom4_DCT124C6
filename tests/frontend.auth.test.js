const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (name) => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const csrf = 'c'.repeat(64);
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const flush = () => jest.advanceTimersByTimeAsync(0);
const element = () => ({
  value: '', textContent: '', hidden: false, disabled: false, checked: false, dataset: {}, events: {}, attributes: {}, children: [],
  addEventListener(name, fn) { this.events[name] = fn; },
  setAttribute(name, value) { this.attributes[name] = value; },
  removeAttribute(name) { delete this.attributes[name]; },
  append(...children) { this.children.push(...children); },
  replaceChildren(...children) { this.children = children; },
  focus: jest.fn(),
});
function environment(html, fetch, auth) {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], element()]));
  // Reflect attributes from the real HTML so input type and accessibility
  // defaults are exercised along with the script, rather than hard-coded.
  for (const match of html.matchAll(/<\w+\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = elements[match[1]];
    for (const attr of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) {
      node.setAttribute(attr[1], attr[2]);
      if (attr[1] === 'type') node.type = attr[2];
    }
  }
  const events = {};
  const window = { ADMIN_AUTH: auth, location: { replace: jest.fn(), reload: jest.fn() }, addEventListener(name, fn) { (events[name] ||= []).push(fn); } };
  const storage = { getItem: jest.fn(() => { throw new Error('No storage permitted'); }), setItem: jest.fn(() => { throw new Error('No storage permitted'); }) };
  const context = { document: { getElementById: (id) => elements[id], createElement: element, createTextNode: (text) => ({ textContent: text }) }, window,
    fetch, localStorage: storage, sessionStorage: storage, AbortController, TextEncoder, Date, performance, TypeError, SyntaxError, setTimeout, clearTimeout, URL, encodeURIComponent };
  return { elements, events, window, context, storage };
}
async function loginUi() {
  const state = { csrfStatus: 200, loginStatus: 200, network: false };
  const fetch = jest.fn(async (url) => {
    if (state.network) throw new TypeError('SECRET');
    return url === '/api/auth/csrf' ? json({ csrfToken: csrf }, state.csrfStatus) : json({ error: 'SECRET internal path' }, state.loginStatus);
  });
  const ui = environment(read('admin-login.html'), fetch);
  vm.runInNewContext(read('js/admin-translations.js'), ui.context);
  let language = 'vi'; let listener;
  ui.window.ADMIN_I18N = { t: (key, params = []) => (ui.window.ADMIN_TRANSLATIONS[language][key] || key)
    .replace(/\{(\d+)\}/g, (_, index) => String(params[index])), onChange: (callback) => { listener = callback; },
  setLanguage: (next) => { language = next; listener(next); } };
  vm.runInNewContext(read('js/admin-login.js'), ui.context); await flush();
  return { ...ui, fetch, state };
}
async function adminUi({ role = 'ADMIN', status = 200, remaining = 3600000 } = {}) {
  const state = { logoutStatus: 204, network: false };
  const fetch = jest.fn(async (url) => {
    if (state.network) throw new TypeError('SECRET');
    return url === '/api/auth/me' ? json({ user: { id: 'root', username: 'test_user', role }, csrfToken: csrf,
      expiresAt: new Date(Date.now() + remaining).toISOString(), serverTime: new Date(Date.now()).toISOString() }, status) : json({}, state.logoutStatus);
  });
  const ui = environment(read('admin.html'), fetch);
  vm.runInNewContext(read('js/admin-auth.js'), ui.context); await flush();
  return { ...ui, fetch, state, auth: ui.window.ADMIN_AUTH };
}
beforeEach(() => jest.useFakeTimers({ now: Date.parse('2026-10-16T01:00:00Z') }));
afterEach(() => jest.useRealTimers());

it('login obtains pre-login CSRF before enabling submission; never uses Web Storage', async () => {
  const ui = await loginUi();
  expect(ui.fetch.mock.calls[0][0]).toBe('/api/auth/csrf');
  expect(ui.elements['login-submit'].disabled).toBe(false);
  expect(ui.storage.getItem).not.toHaveBeenCalled(); expect(ui.storage.setItem).not.toHaveBeenCalled();
});

it('password is hidden by default and toggle is a labelled native non-submit button', async () => {
  const ui = await loginUi();
  const toggle = ui.elements['toggle-login-password'];
  expect(ui.elements['login-password'].type).toBe('password');
  expect(toggle.type).toBe('button');
  expect(toggle.attributes).toMatchObject({ 'aria-label': 'Hiện mật khẩu', 'aria-pressed': 'false', 'aria-controls': 'login-password' });
  expect(toggle.attributes.tabindex).not.toBe('-1');
});

it('eye toggles password visibility twice, retaining content without submitting, fetching or storing it', async () => {
  const ui = await loginUi();
  const password = ui.elements['login-password'];
  const toggle = ui.elements['toggle-login-password'];
  password.value = 'Mật-khẩu-test-🔒';
  const requests = ui.fetch.mock.calls.length;
  toggle.events.click();
  expect(password.type).toBe('text');
  expect(password.value).toBe('Mật-khẩu-test-🔒');
  expect(toggle.attributes).toMatchObject({ 'aria-label': 'Ẩn mật khẩu', 'aria-pressed': 'true' });
  toggle.events.click();
  expect(password.type).toBe('password');
  expect(password.value).toBe('Mật-khẩu-test-🔒');
  expect(toggle.attributes).toMatchObject({ 'aria-label': 'Hiện mật khẩu', 'aria-pressed': 'false' });
  expect(ui.fetch).toHaveBeenCalledTimes(requests);
  expect(ui.window.location.replace).not.toHaveBeenCalled();
  expect(ui.storage.setItem).not.toHaveBeenCalled();
});

it('login still submits the original password and CSRF after toggling visibility', async () => {
  const ui = await loginUi();
  ui.elements['login-username'].value = 'test_user';
  ui.elements['login-password'].value = 'test-only-password';
  ui.elements['toggle-login-password'].events.click();
  await ui.elements['login-form'].events.submit({ preventDefault: jest.fn() });
  const [url, options] = ui.fetch.mock.calls[1];
  expect(url).toBe('/api/auth/login');
  expect(JSON.parse(options.body)).toEqual({ username: 'test_user', password: 'test-only-password' });
  expect(options.headers['X-CSRF-Token']).toBe(csrf);
  expect(options.credentials).toBe('same-origin');
  expect(ui.window.location.replace).toHaveBeenCalledWith('/admin.html');
  expect(ui.elements['login-password'].value).toBe('');
});

it('login sends password with bound CSRF/credentials, clears password and navigates only after success', async () => {
  const ui = await loginUi();
  ui.elements['login-username'].value = 'test_user'; ui.elements['login-password'].value = 'test-only-password';
  await ui.elements['login-form'].events.submit({ preventDefault: jest.fn() });
  const [url, options] = ui.fetch.mock.calls[1];
  expect(url).toBe('/api/auth/login'); expect(options.headers['X-CSRF-Token']).toBe(csrf);
  expect(options.credentials).toBe('same-origin');
  expect(JSON.parse(options.body)).toEqual({ username: 'test_user', password: 'test-only-password' });
  expect(ui.elements['login-password'].value).toBe('');
  expect(ui.window.location.replace).toHaveBeenCalledWith('/admin.html');
  expect(ui.storage.setItem).not.toHaveBeenCalled();
});

it.each([401, 403, 429, 500])('login failure HTTP %i is safe, clears password and restores controls', async (status) => {
  const ui = await loginUi(); ui.state.loginStatus = status;
  ui.elements['login-username'].value = 'test_user';
  ui.elements['login-password'].value = 'test-only-password';
  await ui.elements['login-form'].events.submit({ preventDefault: jest.fn() });
  expect(ui.elements['login-status'].textContent).not.toContain('SECRET');
  expect(ui.elements['login-password'].value).toBe('');
  expect(ui.window.location.replace).not.toHaveBeenCalled();
  expect(ui.elements['login-submit'].disabled).toBe(status === 403);
  if (status === 403) expect(ui.elements['login-retry'].hidden).toBe(false);
});

it('login network failure and failed CSRF preparation can be retried explicitly', async () => {
  const ui = await loginUi(); ui.state.network = true;
  ui.elements['login-username'].value = 'test_user'; ui.elements['login-password'].value = 'test-only-password';
  await ui.elements['login-form'].events.submit({ preventDefault: jest.fn() });
  expect(ui.elements['login-status'].textContent).toContain('Không kết nối');
  await ui.elements['login-retry'].events.click();
  expect(ui.elements['login-submit'].disabled).toBe(true);
  expect(ui.elements['login-retry'].hidden).toBe(false);
  ui.state.network = false; await ui.elements['login-retry'].events.click();
  expect(ui.elements['login-submit'].disabled).toBe(false);
});

it('login double-submit sends one request and pagehide aborts it without navigating late', async () => {
  const ui = await loginUi(); let finish;
  ui.elements['login-username'].value = 'test_user'; ui.elements['login-password'].value = 'test-only-password';
  ui.context.fetch = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  const first = ui.elements['login-form'].events.submit({ preventDefault: jest.fn() });
  const second = ui.elements['login-form'].events.submit({ preventDefault: jest.fn() });
  expect(ui.context.fetch).toHaveBeenCalledTimes(1);
  const signal = ui.context.fetch.mock.calls[0][1].signal;
  ui.events.pagehide.forEach((fn) => fn()); finish(json({})); await first; await second;
  expect(signal.aborted).toBe(true);
  expect(ui.window.location.replace).not.toHaveBeenCalled();
});

it.each(['ADMIN', 'POI_MANAGER'])('authenticated page shows identity and capabilities for %s', async (role) => {
  const ui = await adminUi({ role });
  expect(ui.elements['admin-identity'].textContent).toBe(`test_user · ${role}`);
  expect(ui.elements['admin-shell'].hidden).toBe(false);
  expect(ui.elements['voucher-management'].hidden).toBe(role !== 'ADMIN');
  expect(ui.elements['account-management'].hidden).toBe(role !== 'ADMIN');
  expect(ui.auth.headers('POST')).toEqual({ 'X-CSRF-Token': csrf });
  expect(ui.auth.headers('GET')).toEqual({});
  expect(ui.storage.getItem).not.toHaveBeenCalled(); expect(ui.storage.setItem).not.toHaveBeenCalled();
});

it.each([401, 403, 500])('failed session check HTTP %i redirects without showing Admin shell', async (status) => {
  const ui = await adminUi({ status });
  expect(ui.window.location.replace).toHaveBeenCalledWith('/admin-login.html');
  expect(ui.elements['admin-shell'].hidden).toBe(true);
  expect(ui.auth.current()).toBeNull();
});

it('session expiry or API 401 hides controls and notifies content/media cleanup once', async () => {
  const ui = await adminUi({ remaining: 2000 });
  const stop = jest.fn(); ui.auth.onLost(stop);
  await jest.advanceTimersByTimeAsync(2000);
  ui.auth.handle({ status: 401 });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(ui.elements['admin-shell'].hidden).toBe(true);
  expect(ui.auth.headers('POST')).toEqual({});
  expect(ui.fetch).toHaveBeenCalledTimes(1);
});

it('logout requires CSRF and successful response discards client state', async () => {
  const ui = await adminUi();
  ui.elements['admin-logout'].events.click();
  expect(ui.elements['admin-logout-modal'].hidden).toBe(false);
  expect(ui.elements['admin-logout-cancel'].focus).toHaveBeenCalledTimes(1);
  expect(ui.fetch).toHaveBeenCalledTimes(1);
  await ui.elements['admin-logout-confirm'].events.click();
  const [url, options] = ui.fetch.mock.calls[1];
  expect(url).toBe('/api/auth/logout'); expect(options.method).toBe('POST');
  expect(options.headers['X-CSRF-Token']).toBe(csrf); expect(options.credentials).toBe('same-origin');
  expect(ui.auth.current()).toBeNull();
  expect(ui.window.location.replace).toHaveBeenCalledWith('/admin-login.html');
});

it.each([403, 'network'])('logout failure %s does not falsely claim server session was invalidated', async (kind) => {
  const ui = await adminUi();
  if (kind === 'network') ui.state.network = true; else ui.state.logoutStatus = kind;
  ui.elements['admin-logout'].events.click();
  await ui.elements['admin-logout-confirm'].events.click();
  expect(ui.auth.current()).not.toBeNull();
  expect(ui.elements['admin-session-status'].textContent).toContain(kind === 'network' ? 'có thể còn hiệu lực' : 'Chưa đăng xuất');
  expect(ui.elements['admin-logout'].disabled).toBe(false);
});

it('logout modal cancellation returns focus and does not send a logout request', async () => {
  const ui = await adminUi();
  ui.elements['admin-logout'].events.click();
  expect(ui.elements['admin-logout-cancel'].focus).toHaveBeenCalledTimes(1);
  ui.elements['admin-logout-cancel'].events.click();
  expect(ui.elements['admin-logout-modal'].hidden).toBe(true);
  expect(ui.elements['admin-logout'].focus).toHaveBeenCalledTimes(1);
  expect(ui.fetch).toHaveBeenCalledTimes(1);
  expect(ui.auth.current()).not.toBeNull();
});

it('bfcache restore reloads the protected page and never keeps old content exposed', async () => {
  const ui = await adminUi();
  ui.events.pagehide.forEach((fn) => fn());
  expect(ui.elements['admin-shell'].hidden).toBe(true);
  ui.events.pageshow.forEach((fn) => fn({ persisted: true }));
  expect(ui.window.location.reload).toHaveBeenCalledTimes(1);
});

async function accountsUi(role = 'ADMIN', withI18n = false) {
  const state = { status: 200, list: [{ id: 'manager', username: '<img onerror=alert(1)>', role: 'POI_MANAGER', isLocked: false }] };
  const auth = { current: () => ({ id: 'root', role }), ready: Promise.resolve({ id: 'root', role }), headers: () => ({ 'X-CSRF-Token': csrf }), handle: jest.fn(), expire: jest.fn(), onLost: jest.fn() };
  const fetch = jest.fn(async (url, options) => json(options.method === 'GET' ? state.list : { id: 'manager' }, state.status));
  const ui = environment(read('admin.html'), fetch, auth);
  if (withI18n) {
    vm.runInNewContext(read('js/admin-translations.js'), ui.context);
    let language = 'vi';
    let listener;
    ui.window.ADMIN_I18N = { t: (key, params = []) => (ui.window.ADMIN_TRANSLATIONS[language][key] || key)
      .replace(/\{(\d+)\}/g, (_, index) => String(params[index])), onChange: (callback) => { listener = callback; },
    setLanguage: (next) => { language = next; listener(next); } };
  }
  vm.runInNewContext(read('js/accounts.js'), ui.context); await flush();
  return { ...ui, state, auth, fetch };
}

it('accounts list uses textContent; creation sends only intended fields and clears password', async () => {
  const ui = await accountsUi();
  expect(ui.elements['account-rows'].children[0].children[1].textContent).toBe(ui.state.list[0].username);
  ui.elements['account-username'].value = 'new_manager'; ui.elements['account-password'].value = 'test-only-password'; ui.elements['account-role'].value = 'POI_MANAGER';
  ui.elements['account-form'].events.submit({ preventDefault: jest.fn() }); await flush();
  const [, options] = ui.fetch.mock.calls.find(([, options]) => options.method === 'POST');
  expect(JSON.parse(options.body)).toEqual({ username: 'new_manager', password: 'test-only-password', role: 'POI_MANAGER' });
  expect(options.headers['X-CSRF-Token']).toBe(csrf);
  expect(ui.elements['account-password'].value).toBe(''); expect(ui.storage.setItem).not.toHaveBeenCalled();
});

it('tài khoản thống kê, tìm kiếm, lọc vai trò/trạng thái và phân trang', async () => {
  const ui = await accountsUi();
  ui.state.list = Array.from({ length: 12 }, (_, index) => ({ id: `account-${index}`, username: `user_${String(index).padStart(2, '0')}`,
    role: index % 2 ? 'ADMIN' : 'POI_MANAGER', isLocked: index < 3 }));
  ui.elements['reload-accounts'].events.click(); await flush();
  expect(ui.elements['account-stat-total'].textContent).toBe('12');
  expect(ui.elements['account-stat-admin'].textContent).toBe('6');
  expect(ui.elements['account-stat-manager'].textContent).toBe('6');
  expect(ui.elements['account-stat-locked'].textContent).toBe('3');
  expect(ui.elements['account-rows'].children).toHaveLength(10);
  ui.elements['account-next'].events.click();
  expect(ui.elements['account-rows'].children).toHaveLength(2);
  ui.elements['account-search'].value = 'user_0';
  ui.elements['account-search-form'].events.submit({ preventDefault: jest.fn() });
  expect(ui.elements['account-rows'].children).toHaveLength(10);
  ui.elements['account-role-filter'].value = 'ADMIN';
  ui.elements['account-search-form'].events.submit({ preventDefault: jest.fn() });
  expect(ui.elements['account-rows'].children).toHaveLength(5);
  ui.elements['account-lock-filter'].value = 'locked';
  ui.elements['account-search-form'].events.submit({ preventDefault: jest.fn() });
  expect(ui.elements['account-rows'].children).toHaveLength(1);
  ui.elements['account-search-reset'].events.click();
  expect(ui.elements['account-rows'].children).toHaveLength(10);
});

it('đổi ngôn ngữ tài khoản giữ nguyên vai trò, trạng thái khóa, mật khẩu và bộ lọc đang nhập', async () => {
  const ui = await accountsUi('ADMIN', true);
  const row = ui.elements['account-rows'].children[0];
  const role = row.children[2].children[0];
  role.value = 'ADMIN'; role.events.change();
  ui.elements['account-password'].value = 'draft-password';
  ui.elements['account-search'].value = '<img';
  const requestCount = ui.fetch.mock.calls.length;
  ui.window.ADMIN_I18N.setLanguage('ja');
  expect(ui.elements['account-rows'].children[0]).toBe(row);
  expect(role.value).toBe('ADMIN');
  expect(ui.elements['account-password'].value).toBe('draft-password');
  expect(ui.elements['account-search'].value).toBe('<img');
  expect(row.children[4].children[0].children[0].textContent).toBe(ui.window.ADMIN_TRANSLATIONS.ja['js.accounts.010']);
  expect(role.children[0].textContent).toBe(ui.window.ADMIN_TRANSLATIONS.ja['html.admin.164']);
  expect(ui.fetch.mock.calls).toHaveLength(requestCount);
});

it('account UI changes role, lock and password through separate actions', async () => {
  const ui = await accountsUi();
  let row = ui.elements['account-rows'].children[0];
  const role = row.children[2].children[0];
  const save = row.children[4].children[0].children[0];
  expect(save.disabled).toBe(true);
  role.value = 'ADMIN'; role.events.change(); expect(save.disabled).toBe(false);
  save.events.click(); await flush();
  const patch = ui.fetch.mock.calls.find(([, options]) => options.method === 'PATCH');
  expect(JSON.parse(patch[1].body)).toEqual({ role: 'ADMIN' });
  row = ui.elements['account-rows'].children[0];
  row.children[4].children[0].children[1].events.click(); await flush();
  expect(JSON.parse(ui.fetch.mock.calls.filter(([, options]) => options.method === 'PATCH')[1][1].body)).toEqual({ isLocked: true });
  row = ui.elements['account-rows'].children[0];
  row.children[4].children[0].children[2].events.click();
  ui.elements['account-new-password'].value = 'test-only-new-password';
  ui.elements['account-confirm-password'].value = 'test-only-new-password';
  ui.elements['account-password-form'].events.submit({ preventDefault: jest.fn() }); await flush();
  const reset = ui.fetch.mock.calls.find(([url]) => url.endsWith('/password'));
  expect(JSON.parse(reset[1].body)).toEqual({ password: 'test-only-new-password' });
  expect(ui.elements['account-new-password'].value).toBe('');
});

it('signed-in ADMIN cannot lock or demote themselves, but can change their own password', async () => {
  const ui = await accountsUi();
  ui.state.list = [{ id: 'root', username: 'root_admin', role: 'ADMIN', isLocked: false }];
  ui.elements['reload-accounts'].events.click(); await flush();
  const row = ui.elements['account-rows'].children[0];
  const actions = row.children[4].children[0].children;
  expect(row.children[2].children[0].disabled).toBe(true);
  expect(actions[0].disabled).toBe(true);
  expect(actions[1].disabled).toBe(true);
  actions[0].events.click(); actions[1].events.click();
  expect(ui.fetch.mock.calls.filter(([, options]) => options.method === 'PATCH')).toHaveLength(0);
  actions[2].events.click();
  expect(ui.elements['account-current-field'].hidden).toBe(false);
  ui.elements['account-current-password'].value = 'test-only-password';
  ui.elements['account-new-password'].value = 'different-test-only-password';
  ui.elements['account-confirm-password'].value = 'different-test-only-password';
  const before = ui.fetch.mock.calls.length;
  ui.elements['account-password-form'].events.submit({ preventDefault: jest.fn() }); await flush();
  const own = ui.fetch.mock.calls.find(([url]) => url === '/api/accounts/me/password');
  expect(JSON.parse(own[1].body)).toEqual({ currentPassword: 'test-only-password', newPassword: 'different-test-only-password' });
  expect(ui.fetch.mock.calls.slice(before).map(([url]) => url)).toEqual(['/api/accounts/me/password']);
  expect(ui.elements['account-password-modal'].hidden).toBe(true);
});

it('account password eyes retain the typed value and modal resets to hidden', async () => {
  const ui = await accountsUi();
  const input = ui.elements['account-password'];
  input.value = 'test-only-password';
  ui.elements['toggle-account-password'].events.click();
  expect(input.type).toBe('text'); expect(input.value).toBe('test-only-password');
  ui.elements['toggle-account-password'].events.click(); expect(input.type).toBe('password');
  ui.elements['account-rows'].children[0].children[4].children[0].children[2].events.click();
  const modalInput = ui.elements['account-new-password'];
  modalInput.value = 'another-test-only-password';
  ui.elements['toggle-account-new-password'].events.click();
  expect(modalInput.type).toBe('text'); expect(modalInput.value).toBe('another-test-only-password');
  ui.elements['account-modal-cancel'].events.click();
  expect(modalInput.value).toBe(''); expect(modalInput.type).toBe('password');
});

it('account creation has stable validation slots and no session-revocation description', async () => {
  const markup = read('admin.html');
  const styles = read('css/admin.css');
  expect(markup).not.toContain('Thay đổi quyền, trạng thái hoặc mật khẩu sẽ thu hồi các phiên');
  expect(markup).toMatch(/id="account-status"[^>]*hidden/);
  expect(markup.match(/class="account-create-error-slot"/g)).toHaveLength(2);
  expect(styles).toMatch(/#account-form\s*\{[^}]*align-items:\s*start/);
  expect(styles).toMatch(/\.account-create-error-slot\s*\{[^}]*min-height:/);
  const ui = await accountsUi('ADMIN', true);
  expect(ui.elements['account-status'].hidden).toBe(true);
  ui.elements['account-username'].value = 'new_manager'; ui.elements['account-password'].value = 'secret';
  ui.elements['account-form'].events.submit({ preventDefault: jest.fn() });
  expect(ui.elements['account-password-error'].hidden).toBe(false);
  expect(ui.elements['account-status'].hidden).toBe(true);
  ui.elements['toggle-account-password'].events.click();
  expect(ui.elements['account-password'].type).toBe('text');
  expect(ui.elements['account-password-error'].hidden).toBe(false);
});

it.each(['vi', 'en', 'ja', 'ko'])('account password length error uses %s and updates while typing', async (language) => {
  const ui = await accountsUi('ADMIN', true);
  ui.window.ADMIN_I18N.setLanguage(language);
  ui.elements['account-username'].value = 'new_manager';
  ui.elements['account-password'].value = 'secret';
  const requests = ui.fetch.mock.calls.length;
  ui.elements['account-form'].events.submit({ preventDefault: jest.fn() });
  expect(ui.elements['account-password-error'].textContent).toBe(ui.window.ADMIN_TRANSLATIONS[language]['js.accounts.025'].replace('{0}', '6'));
  expect(ui.elements['account-password-error'].hidden).toBe(false);
  expect(ui.elements['account-password'].attributes['aria-invalid']).toBe('true');
  expect(ui.fetch).toHaveBeenCalledTimes(requests);
  ui.elements['account-password'].value = 'test-only-password';
  ui.elements['account-password'].events.input();
  expect(ui.elements['account-password-error'].hidden).toBe(true);
  expect(ui.elements['account-password'].attributes['aria-invalid']).toBe('false');
});

it('active account errors translate immediately without losing input or duplicating messages', async () => {
  const ui = await accountsUi('ADMIN', true);
  ui.elements['account-username'].value = 'new_manager'; ui.elements['account-password'].value = 'secret';
  ui.elements['account-form'].events.submit({ preventDefault: jest.fn() });
  ui.window.ADMIN_I18N.setLanguage('ja');
  expect(ui.elements['account-password'].value).toBe('secret');
  expect(ui.elements['account-password-error'].textContent).toBe('パスワードは12文字以上で入力してください（現在6文字）。');
  ui.elements['account-username'].value = '';
  ui.elements['account-form'].events.submit({ preventDefault: jest.fn() });
  expect(ui.elements['account-username-error'].textContent).toBe(ui.window.ADMIN_TRANSLATIONS.ja['js.accounts.027']);
});

it('duplicate username response stays attached to the field across language changes', async () => {
  const ui = await accountsUi('ADMIN', true);
  ui.state.status = 409;
  ui.elements['account-username'].value = 'existing_user';
  ui.elements['account-password'].value = 'test-only-password';
  ui.elements['account-form'].events.submit({ preventDefault: jest.fn() }); await flush();
  expect(ui.elements['account-username-error'].textContent).toBe(ui.window.ADMIN_TRANSLATIONS.vi['js.accounts.031']);
  ui.window.ADMIN_I18N.setLanguage('en');
  expect(ui.elements['account-username-error'].textContent).toBe(ui.window.ADMIN_TRANSLATIONS.en['js.accounts.031']);
  expect(ui.elements['account-username'].value).toBe('existing_user');
  ui.elements['account-username'].value = 'different_user'; ui.elements['account-username'].events.input();
  expect(ui.elements['account-username-error'].hidden).toBe(true);
});

it('modal confirmation and current password errors are localized inline', async () => {
  const ui = await accountsUi('ADMIN', true);
  ui.state.list = [{ id: 'root', username: 'root_admin', role: 'ADMIN', isLocked: false }];
  ui.elements['reload-accounts'].events.click(); await flush();
  ui.elements['account-rows'].children[0].children[4].children[0].children[2].events.click();
  ui.elements['account-current-password'].value = 'current-password';
  ui.elements['account-new-password'].value = 'different-password';
  ui.elements['account-confirm-password'].value = 'wrong-password';
  ui.elements['account-password-form'].events.submit({ preventDefault: jest.fn() });
  expect(ui.elements['account-confirm-password-error'].textContent).toBe(ui.window.ADMIN_TRANSLATIONS.vi['html.admin.183']);
  ui.window.ADMIN_I18N.setLanguage('ko');
  expect(ui.elements['account-confirm-password-error'].textContent).toBe(ui.window.ADMIN_TRANSLATIONS.ko['html.admin.183']);
  ui.elements['account-confirm-password'].value = 'different-password';
  ui.elements['account-confirm-password'].events.input();
  expect(ui.elements['account-confirm-password-error'].hidden).toBe(true);
  ui.state.status = 400;
  ui.elements['account-password-form'].events.submit({ preventDefault: jest.fn() }); await flush();
  expect(ui.elements['account-current-password-error'].textContent).toBe(ui.window.ADMIN_TRANSLATIONS.ko['html.admin.186']);
});

it('reset modal blocks a short password and translates its live character count', async () => {
  const ui = await accountsUi('ADMIN', true);
  ui.elements['account-rows'].children[0].children[4].children[0].children[2].events.click();
  ui.elements['account-new-password'].value = 'secret';
  ui.elements['account-confirm-password'].value = 'secret';
  const requests = ui.fetch.mock.calls.length;
  ui.elements['account-password-form'].events.submit({ preventDefault: jest.fn() });
  expect(ui.elements['account-new-password-error'].textContent).toBe(ui.window.ADMIN_TRANSLATIONS.vi['js.accounts.025'].replace('{0}', '6'));
  ui.window.ADMIN_I18N.setLanguage('en');
  expect(ui.elements['account-new-password-error'].textContent).toBe(ui.window.ADMIN_TRANSLATIONS.en['js.accounts.025'].replace('{0}', '6'));
  expect(ui.fetch).toHaveBeenCalledTimes(requests);
});

it('login required fields use inline localized validation and never call the API', async () => {
  const ui = await loginUi(); const requests = ui.fetch.mock.calls.length;
  await ui.elements['login-form'].events.submit({ preventDefault: jest.fn() });
  expect(ui.elements['login-username-error'].textContent).toBe(ui.window.ADMIN_TRANSLATIONS.vi['js.admin_login.011']);
  expect(ui.elements['login-password-error'].textContent).toBe(ui.window.ADMIN_TRANSLATIONS.vi['js.admin_login.012']);
  expect(ui.fetch).toHaveBeenCalledTimes(requests);
  ui.window.ADMIN_I18N.setLanguage('en');
  expect(ui.elements['login-username-error'].textContent).toBe(ui.window.ADMIN_TRANSLATIONS.en['js.admin_login.011']);
  ui.elements['login-username'].value = 'test_user'; ui.elements['login-username'].events.input();
  expect(ui.elements['login-username-error'].hidden).toBe(true);
});

it('account and login forms bypass native constraint bubbles but retain constraints', () => {
  expect(read('admin.html')).toMatch(/<form id="account-form"[^>]*novalidate/);
  expect(read('admin.html')).toMatch(/<form id="account-password-form"[^>]*novalidate/);
  expect(read('admin.html')).toMatch(/id="account-password"[^>]*minlength="12"[^>]*required/);
  expect(read('admin-login.html')).toMatch(/<form id="login-form"[^>]*novalidate/);
});

it.each([400, 403, 409, 500])('account mutation HTTP %i restores controls and clears password without showing raw response', async (status) => {
  const ui = await accountsUi(); ui.state.status = status;
  ui.elements['account-username'].value = 'new_manager';
  ui.elements['account-password'].value = 'test-only-password';
  ui.elements['account-form'].events.submit({ preventDefault: jest.fn() }); await flush();
  expect(ui.elements['account-status'].textContent).not.toContain('SECRET');
  expect(ui.elements['account-password'].value).toBe(''); expect(ui.elements['create-account'].disabled).toBe(false);
});

it('POI_MANAGER does not fetch or invoke voucher/accounts operations from the frontend', async () => {
  const ui = await accountsUi('POI_MANAGER');
  ui.elements['account-form'].events.submit({ preventDefault: jest.fn() }); await flush();
  expect(ui.fetch).not.toHaveBeenCalled();
  vm.runInNewContext(read('js/vouchers.js'), ui.context); await flush();
  ui.elements['voucher-form'].events.submit({ preventDefault: jest.fn() }); await flush();
  expect(ui.fetch).not.toHaveBeenCalled();
});
