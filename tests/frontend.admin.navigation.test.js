const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/js/admin-navigation.js'), 'utf8');

function node() {
  const classes = new Set();
  return {
    hidden: false, dataset: {}, attributes: {}, events: {},
    classList: {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !classes.has(name) : force;
        if (enabled) classes.add(name); else classes.delete(name);
        return enabled;
      },
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, handler) { this.events[name] = handler; },
    querySelector() { return this.firstLink; },
    focus: jest.fn(),
  };
}

async function setup(role = 'ADMIN', hash = '') {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], node()]));
  const links = [...html.matchAll(/<a\b[^>]*data-admin-view="([^"]+)"[^>]*>/g)].map((match) => {
    const link = node();
    link.dataset.adminView = match[1];
    if (match[0].includes('data-admin-role="ADMIN"')) link.dataset.adminRole = 'ADMIN';
    return link;
  });
  elements['admin-sidebar'].firstLink = links[0];
  const events = {};
  const window = {
    location: { hash },
    history: { replaceState: jest.fn((_, __, value) => { window.location.hash = value; }) },
    addEventListener: (name, handler) => { events[name] = handler; },
    ADMIN_POI_MAP: { refresh: jest.fn() },
    ADMIN_AUTH: { ready: Promise.resolve({ role }), onLost: jest.fn() },
  };
  const document = { getElementById: (id) => elements[id], querySelectorAll: () => links, title: '' };
  vm.runInNewContext(script, { document, window });
  await window.ADMIN_AUTH.ready;
  await Promise.resolve();
  return { elements, links, events, window, document };
}

const visible = (ui) => ['dashboard-screen', 'voucher-management', 'pois-screen', 'account-management']
  .filter((id) => !ui.elements[id].hidden);

test('Admin mở tổng quan mặc định và chuyển từng màn hình bằng hash, không gọi API', async () => {
  const ui = await setup();
  expect(visible(ui)).toEqual(['dashboard-screen']);
  for (const [hash, id] of [['#vouchers', 'voucher-management'], ['#pois', 'pois-screen'],
    ['#accounts', 'account-management'], ['#dashboard', 'dashboard-screen']]) {
    ui.window.location.hash = hash;
    ui.events.hashchange();
    expect(visible(ui)).toEqual([id]);
    expect(ui.links.find((link) => link.dataset.adminView === hash.slice(1)).attributes['aria-current']).toBe('page');
    expect(ui.elements['admin-header-title'].textContent).toBe({
      '#vouchers': 'Quản lý vé QR', '#pois': 'Quản lý POI',
      '#accounts': 'Quản lý tài khoản', '#dashboard': 'Tổng quan hệ thống',
    }[hash]);
  }
  ui.window.location.hash = '#pois';
  ui.events.popstate();
  expect(visible(ui)).toEqual(['pois-screen']);
  expect(ui.window.ADMIN_POI_MAP.refresh).toHaveBeenCalled();
  expect(html).toContain('src="/js/admin-navigation.js"');
  expect(html).toMatch(/href="#vouchers" data-admin-view="vouchers" data-admin-role="ADMIN"[^>]*>/);
  expect(html).toMatch(/href="#pois" data-admin-view="pois"[^>]*>/);
  expect(html).toMatch(/href="#accounts" data-admin-view="accounts" data-admin-role="ADMIN"[^>]*>/);
});

test('refresh giữ màn hình đã chọn; POI_MANAGER không thấy hoặc mở được mục ADMIN', async () => {
  const admin = await setup('ADMIN', '#accounts');
  expect(visible(admin)).toEqual(['account-management']);
  const manager = await setup('POI_MANAGER', '#vouchers');
  expect(visible(manager)).toEqual(['pois-screen']);
  expect(manager.window.history.replaceState).toHaveBeenCalledWith(null, '', '#pois');
  expect(manager.links.filter((link) => link.dataset.adminRole === 'ADMIN').every((link) => link.hidden)).toBe(true);
  manager.window.location.hash = '#accounts';
  manager.events.hashchange();
  expect(visible(manager)).toEqual(['pois-screen']);
});

test('thu gọn, mở rộng và menu mobile vẫn giữ điều hướng', async () => {
  const ui = await setup();
  ui.elements['admin-sidebar-toggle'].events.click();
  expect(ui.elements['admin-shell'].classList.contains('sidebar-collapsed')).toBe(true);
  expect(ui.elements['admin-sidebar-toggle'].attributes['aria-expanded']).toBe('false');
  ui.elements['admin-sidebar-toggle'].events.click();
  expect(ui.elements['admin-shell'].classList.contains('sidebar-collapsed')).toBe(false);
  ui.elements['admin-mobile-menu'].events.click();
  expect(ui.elements['admin-shell'].classList.contains('sidebar-mobile-open')).toBe(true);
  expect(ui.elements['admin-sidebar-backdrop'].hidden).toBe(false);
  ui.links[2].events.click();
  expect(ui.elements['admin-shell'].classList.contains('sidebar-mobile-open')).toBe(false);
  expect(ui.elements['admin-mobile-menu'].attributes['aria-expanded']).toBe('false');
});
