const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/js/admin-dashboard.js'), 'utf8');
const data = {
  poi: { total: 16, active: 13 }, vouchers: { total: 4, unused: 1, active: 2, expired: 1 },
  accounts: { total: 3 }, generatedAt: '2026-10-27T03:00:00.000Z',
  recentActivations: [{ id: 'session-new', voucherId: 'voucher-new', startedAt: '2026-10-27T02:00:00.000Z',
    expiresAt: '2026-10-27T04:00:00.000Z', status: 'active' }],
};

function node() {
  return {
    textContent: '', hidden: false, disabled: false, dataset: {}, attributes: {}, style: {}, events: {}, children: [],
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.events[name] = handler; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  };
}

async function setup(role = 'ADMIN', response = { ok: true, json: async () => data }) {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], node()]));
  elements['dashboard-screen'].hidden = true;
  const fetch = jest.fn(async () => response);
  const callbacks = [];
  const auth = { ready: Promise.resolve({ role }), current: () => ({ role }), handle: jest.fn(), onLost: (fn) => callbacks.push(fn) };
  const window = { ADMIN_AUTH: auth, addEventListener: jest.fn() };
  const document = { getElementById: (id) => elements[id], createElement: node };
  vm.runInNewContext(script, { window, document, fetch, AbortController, Date, setTimeout, clearTimeout });
  await auth.ready;
  await Promise.resolve();
  return { elements, fetch, window, callbacks };
}

test('Dashboard lấy số liệu thật một lần, vẽ biểu đồ và phiên gần đây', async () => {
  const ui = await setup();
  await ui.window.ADMIN_DASHBOARD.onView();
  await Promise.resolve();
  expect(ui.fetch).toHaveBeenCalledTimes(1);
  expect(ui.fetch.mock.calls[0][0]).toBe('/api/admin/dashboard');
  expect(ui.fetch.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
  expect(ui.elements['stat-poi-total'].textContent).toBe('16');
  expect(ui.elements['stat-voucher-active'].textContent).toBe('2');
  expect(ui.elements['voucher-chart'].style.background).toContain('conic-gradient');
  expect(ui.elements['chart-expired'].textContent).toBe('1');
  expect(ui.elements['recent-activation-rows'].children).toHaveLength(1);
  expect(ui.elements['recent-activation-rows'].children[0].children[0].textContent).toBe('session-new');
  ui.window.ADMIN_DASHBOARD.onView();
  expect(ui.fetch).toHaveBeenCalledTimes(1);
});

test('lỗi API không hiển thị số 0 giả và cho phép làm mới', async () => {
  const ui = await setup('ADMIN', { ok: false, status: 503 });
  await ui.window.ADMIN_DASHBOARD.onView();
  expect(ui.elements['stat-poi-total'].textContent).toBe('—');
  expect(ui.elements['dashboard-status'].dataset.tone).toBe('error');
  await ui.elements['reload-dashboard'].events.click();
  expect(ui.fetch).toHaveBeenCalledTimes(2);
});

test('dữ liệu rỗng hiển thị 0 thật cùng thông báo không có vé và phiên', async () => {
  const empty = { poi: { total: 0, active: 0 }, vouchers: { total: 0, unused: 0, active: 0, expired: 0 },
    accounts: { total: 1 }, recentActivations: [], generatedAt: data.generatedAt };
  const ui = await setup('ADMIN', { ok: true, json: async () => empty });
  await ui.window.ADMIN_DASHBOARD.onView();
  expect(ui.elements['stat-poi-total'].textContent).toBe('0');
  expect(ui.elements['voucher-chart-empty'].hidden).toBe(false);
  expect(ui.elements['recent-empty'].hidden).toBe(false);
  expect(ui.elements['voucher-chart'].style.background).toBe('');
});

test('POI_MANAGER chỉ thấy lời chào và không gọi API Dashboard', async () => {
  const ui = await setup('POI_MANAGER');
  ui.window.ADMIN_DASHBOARD.onView();
  await Promise.resolve();
  expect(ui.fetch).not.toHaveBeenCalled();
  expect(ui.elements['dashboard-manager-intro'].hidden).toBe(false);
  expect(ui.elements['dashboard-admin-content'].hidden).toBe(true);
});
