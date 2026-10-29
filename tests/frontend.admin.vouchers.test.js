const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/js/admin-vouchers.js'), 'utf8');
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const now = '2026-10-27T10:00:00.000Z';
const element = () => ({
  value: '', textContent: '', hidden: false, disabled: false, dataset: {}, style: {}, children: [], events: {},
  addEventListener(name, fn) { this.events[name] = fn; },
  setAttribute(name, value) { this[name] = value; },
  removeAttribute(name) { delete this[name]; },
  replaceChildren(...children) { this.children = children; },
  append(child) { this.children.push(child); },
  scrollIntoView() {},
  focus() {},
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function setup(withI18n = false) {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], element()]));
  elements['voucher-duration'].value = '60';
  elements['voucher-search-duration'].value = 'all';
  elements['voucher-filter'].value = 'all';
  elements['voucher-result'].hidden = true;
  const voucher = { id, durationMinutes: 60, createdAt: now, redeemedAt: null, expiresAt: null, status: 'unused' };
  const state = { voucher, fail: false, requests: [], pageTotal: null };
  const fetch = jest.fn(async (url, options) => {
    state.requests.push({ url, options });
    if (state.fail) return { ok: false, status: 500 };
    if (options.method === 'POST') return { ok: true, status: 201, json: async () => ({ ...voucher,
      code: 'a'.repeat(64), activationCode: 'aB7kP2x', activationUrl: `http://localhost:3000/?voucher=${'a'.repeat(64)}`, qrSvg: '<svg></svg>' }) };
    const query = new URL(url, 'http://localhost').searchParams;
    const item = state.voucher;
    const durationMatches = query.get('duration') === 'all' || Number(query.get('duration')) === item.durationMinutes;
    const dateMatches = !query.get('createdDate') || query.get('createdDate') === item.createdAt.slice(0, 10);
    const items = durationMatches && dateMatches && (query.get('status') === 'all' || query.get('status') === item.status) ? [item] : [];
    const paged = state.pageTotal !== null ? Array.from({ length: Math.max(0, Math.min(10, state.pageTotal - (Number(query.get('page')) - 1) * 10)) }, () => voucher) : items;
    const total = state.pageTotal !== null ? state.pageTotal : items.length;
    return { ok: true, status: 200, json: async () => ({ page: Number(query.get('page')), total,
      totalPages: Math.ceil(total / 10), items: paged, generatedAt: now,
      stats: { total: state.pageTotal === null ? 1 : state.pageTotal, unused: item.status === 'unused' ? (state.pageTotal === null ? 1 : state.pageTotal) : 0,
        active: item.status === 'active' ? 1 : 0, expired: item.status === 'expired' ? 1 : 0 } }) };
  });
  const auth = { ready: Promise.resolve({ role: 'ADMIN' }), current: () => ({ role: 'ADMIN' }),
    headers: () => ({ 'X-CSRF-Token': 'fixture' }), handle: jest.fn(), onLost: jest.fn() };
  const window = { ADMIN_AUTH: auth, addEventListener: jest.fn() };
  if (withI18n) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/admin-translations.js'), 'utf8'), { window });
    let language = 'vi';
    let listener;
    window.ADMIN_I18N = { t: (key, params = []) => (window.ADMIN_TRANSLATIONS[language][key] || key)
      .replace(/\{(\d+)\}/g, (_, index) => String(params[index])), language: () => language,
    onChange: (callback) => { listener = callback; }, setLanguage: (next) => { language = next; listener(next); } };
  }
  vm.runInNewContext(script, { document: { getElementById: (name) => elements[name], createElement: element },
    window, fetch, navigator: { clipboard: { writeText: jest.fn() } },
    URL, URLSearchParams, Date, Number, AbortController, encodeURIComponent, setTimeout, clearTimeout });
  await tick();
  return { elements, state, fetch, window };
}

test('malformed voucher date shows localized inline feedback without searching', async () => {
  const ui = await setup(true);
  const before = ui.state.requests.length;
  ui.elements['voucher-search-date'].validity = { badInput: true };
  ui.elements['voucher-search-form'].events.submit({ preventDefault: jest.fn() });
  expect(ui.state.requests).toHaveLength(before);
  expect(ui.elements['voucher-search-date-error'].textContent).toBe(ui.window.ADMIN_TRANSLATIONS.vi['js.admin_vouchers.027']);
  ui.window.ADMIN_I18N.setLanguage('ja');
  expect(ui.elements['voucher-search-date-error'].textContent).toBe(ui.window.ADMIN_TRANSLATIONS.ja['js.admin_vouchers.027']);
  expect(html).toMatch(/<form id="voucher-search-form"[^>]*novalidate/);
});

test('một giao diện vé hiển thị thống kê và bảng, không gọi lịch sử kích hoạt', async () => {
  const ui = await setup();
  expect(ui.state.requests.map(({ url }) => url)).toEqual([expect.stringContaining('/overview?')]);
  expect(ui.elements['voucher-stat-total'].textContent).toBe('1');
  expect(ui.elements['voucher-rows'].children).toHaveLength(1);
  expect(ui.elements['voucher-rows'].children[0].children[1].textContent).toBe(id);
  expect(ui.elements['voucher-rows'].children[0].children[4].textContent).toBe('—');
  expect(ui.elements['voucher-rows'].children[0].children[5].textContent).toBe('—');
  expect(html).not.toContain('id="voucher-tab-list"');
  expect(html).not.toContain('id="voucher-tab-history"');
  expect(html).not.toContain('id="voucher-history-panel"');
  expect(html).not.toContain('id="activation-rows"');
  expect(ui.state.requests.every(({ url }) => !url.includes('/activations'))).toBe(true);
  expect(html).toContain('href="#vouchers"');
});

test('tạo vé giữ QR/mã chỉ trong kết quả tạo và cập nhật thống kê, danh sách', async () => {
  const ui = await setup();
  ui.elements['voucher-form'].events.submit({ preventDefault: jest.fn() });
  await tick(); await tick();
  expect(ui.state.requests.find(({ options }) => options.method === 'POST').options.headers['X-CSRF-Token']).toBe('fixture');
  expect(ui.elements['activation-code'].value).toBe('aB7kP2x');
  expect(ui.elements['voucher-result'].hidden).toBe(false);
  expect(ui.elements['voucher-rows'].children[0].children[1].textContent).toBe(id);
  expect(JSON.stringify(ui.elements['voucher-rows'].children)).not.toContain('aB7kP2x');
  expect(ui.state.requests.filter(({ url }) => url.includes('/overview?'))).toHaveLength(2);
});

test('lọc, tìm kiếm, trạng thái rỗng và lỗi API không hiển thị số 0 giả', async () => {
  const ui = await setup();
  ui.elements['voucher-filter'].value = 'expired';
  ui.elements['voucher-search-form'].events.submit({ preventDefault: jest.fn() });
  await tick();
  expect(ui.elements['voucher-rows'].children).toHaveLength(0);
  expect(ui.elements['voucher-list-status'].textContent).toContain('Không có kết quả');
  ui.state.fail = true;
  ui.elements['reload-vouchers'].events.click();
  await tick();
  expect(ui.elements['voucher-stat-total'].textContent).toBe('—');
  expect(ui.elements['voucher-list-status'].dataset.tone).toBe('error');
});

test('phân trang chuyển đúng trang và giới hạn nút ở trang cuối', async () => {
  const ui = await setup();
  ui.state.pageTotal = 21;
  ui.elements['reload-vouchers'].events.click();
  await tick();
  expect(ui.elements['voucher-rows'].children).toHaveLength(10);
  ui.elements['voucher-next'].events.click();
  await tick();
  expect(ui.elements['voucher-page'].textContent).toContain('Trang 2/3');
  ui.elements['voucher-next'].events.click();
  await tick();
  expect(ui.elements['voucher-rows'].children).toHaveLength(1);
  expect(ui.elements['voucher-next'].disabled).toBe(true);
  expect(ui.elements['voucher-prev'].disabled).toBe(false);
});

test('lọc vé theo thời hạn và ngày tạo, đặt lại bộ lọc', async () => {
  const ui = await setup();
  ui.elements['voucher-search-duration'].value = '60';
  ui.elements['voucher-search-date'].value = '2026-10-27';
  ui.elements['voucher-search-form'].events.submit({ preventDefault: jest.fn() });
  await tick();
  expect(ui.state.requests.at(-1).url).toContain('duration=60');
  expect(ui.state.requests.at(-1).url).toContain('createdDate=2026-10-27');
  expect(ui.elements['voucher-rows'].children).toHaveLength(1);
  ui.elements['voucher-search-date'].value = '2026-10-28';
  ui.elements['voucher-search-form'].events.submit({ preventDefault: jest.fn() });
  await tick();
  expect(ui.elements['voucher-rows'].children).toHaveLength(0);
  ui.elements['voucher-search-reset'].events.click();
  await tick();
  expect(ui.elements['voucher-search-date'].value).toBe('');
  expect(ui.elements['voucher-rows'].children).toHaveLength(1);
});

test('làm mới phản ánh vé chuyển từ chưa kích hoạt sang đang sử dụng rồi hết hạn', async () => {
  const ui = await setup();
  const badge = () => ui.elements['voucher-rows'].children[0].children[6].children[0];
  expect(badge().textContent).toBe('Chưa kích hoạt');
  expect(ui.elements['voucher-rows'].children[0].children[4].textContent).toBe('—');
  ui.state.voucher.status = 'active';
  ui.state.voucher.redeemedAt = now;
  ui.state.voucher.expiresAt = '2026-10-27T11:00:00.000Z';
  ui.elements['reload-vouchers'].events.click();
  await tick();
  expect(badge().textContent).toBe('Đang sử dụng');
  expect(ui.elements['voucher-stat-active'].textContent).toBe('1');
  expect(ui.elements['voucher-rows'].children[0].children[4].textContent).not.toBe('—');
  expect(ui.elements['voucher-rows'].children[0].children[5].textContent).not.toBe('—');
  ui.state.voucher.status = 'expired';
  ui.elements['reload-vouchers'].events.click();
  await tick();
  expect(badge().textContent).toBe('Đã hết hạn');
  expect(ui.elements['voucher-stat-expired'].textContent).toBe('1');
  expect(ui.elements['voucher-rows'].children).toHaveLength(1);
  expect(ui.state.requests.every(({ url }) => !url.includes('/activations'))).toBe(true);
});

test('bốn ngôn ngữ dịch trạng thái vé từ dữ liệu đang có mà không gọi API', async () => {
  const ui = await setup(true);
  const requests = ui.state.requests.length;
  for (const language of ['vi', 'en', 'ja', 'ko']) {
    ui.window.ADMIN_I18N.setLanguage(language);
    expect(ui.elements['voucher-rows'].children[0].children[6].children[0].textContent)
      .toBe(ui.window.ADMIN_TRANSLATIONS[language]['js.admin_vouchers.001']);
    expect(ui.elements['voucher-search-duration'].value).toBe('all');
  }
  expect(ui.state.requests).toHaveLength(requests);
});
