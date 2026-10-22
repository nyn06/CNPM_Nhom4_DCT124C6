const fs = require('fs');
const path = require('path');
const vm = require('vm');
const QRCode = require('qrcode');
const html = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/js/vouchers.js'), 'utf8');
const code = 'a'.repeat(64);
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const flush = () => jest.advanceTimersByTimeAsync(0);
const element = () => ({
  value: '', textContent: '', disabled: false, hidden: false, dataset: {}, events: {}, children: [],
  setAttribute: jest.fn(), addEventListener(name, fn) { this.events[name] = fn; },
  replaceChildren(...children) { this.children = children; },
});
async function setup() {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], element()]));
  elements['voucher-duration'].value = '60';
  elements['voucher-result'].hidden = true;
  const voucher = { id: 'voucher-id', code, activationCode: 'aB7kP2x', durationMinutes: 60, status: 'unused', activationUrl: `http://localhost:3000/?voucher=${code}`, mobileReady: false };
  voucher.qrSvg = await QRCode.toString(voucher.activationUrl, { type: 'svg' });
  const state = { voucher, status: 200, network: false, list: [{ id: 'voucher-id', durationMinutes: 60, status: 'unused' }] };
  const fetch = jest.fn(async (url, options) => {
    if (state.network) throw new TypeError('SECRET');
    return json(options.method === 'POST' ? state.voucher : state.list, state.status);
  });
  const clipboard = { writeText: jest.fn().mockResolvedValue() };
  const auth = { ready: Promise.resolve({ role: 'ADMIN' }), current: () => ({ role: 'ADMIN' }), headers: () => ({ 'X-CSRF-Token': 'fixture' }), handle: jest.fn(), onLost: jest.fn() };
  vm.runInNewContext(script, { document: { getElementById: (id) => elements[id], createElement: element }, window: { addEventListener: jest.fn(), ADMIN_AUTH: auth }, navigator: { clipboard }, fetch, URL, Date, TypeError, SyntaxError, AbortController, encodeURIComponent, setTimeout, clearTimeout });
  await flush();
  return { elements, state, fetch, clipboard };
}
async function create(ui) { ui.elements['voucher-form'].events.submit({ preventDefault: jest.fn() }); await flush(); }
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('creates chosen duration and renders locally generated QR with the exact activation URL', async () => {
  const ui = await setup();
  await create(ui);
  const post = ui.fetch.mock.calls.find(([, options]) => options.method === 'POST');
  expect(JSON.parse(post[1].body)).toEqual({ durationMinutes: 60 });
  expect(post[1].headers['X-CSRF-Token']).toBe('fixture');
  expect(ui.elements['activation-url'].value).toBe(ui.state.voucher.activationUrl);
  expect(ui.elements['activation-code'].value).toBe(ui.state.voucher.activationCode);
  expect(decodeURIComponent(ui.elements['voucher-qr'].src.split(',')[1])).toBe(ui.state.voucher.qrSvg);
  expect(ui.elements['voucher-result'].hidden).toBe(false);
  expect(ui.elements['created-voucher-status'].textContent).toBe('Vé 60 phút · Chưa kích hoạt.');
  expect(html).not.toContain('voucher-origin-note');
  expect(html).toContain('>URL kích hoạt</label>');
  expect(html).toContain('>Mã kích hoạt</label>');
  expect(html).toContain('Mỗi vé mới sẽ có một mã riêng.');
  expect(html).not.toContain('Mã kích hoạt (7 ký tự)');
  expect(html).toMatch(/id="activation-code"[^>]*readonly/);
  expect(ui.fetch.mock.calls.every(([url]) => url === '/api/access/vouchers')).toBe(true);
});

it('copy URL uses clipboard with voucher only, no session token', async () => {
  const ui = await setup(); await create(ui);
  await ui.elements['copy-voucher-url'].events.click();
  expect(ui.clipboard.writeText).toHaveBeenCalledWith(ui.state.voucher.activationUrl);
  expect(ui.elements['activation-url'].value).not.toContain('accessToken');
});

it('copies exactly the seven-character activation code and updates it with a new voucher', async () => {
  const ui = await setup(); await create(ui);
  await ui.elements['copy-activation-code'].events.click();
  expect(ui.clipboard.writeText).toHaveBeenCalledWith('aB7kP2x');
  expect(ui.elements['voucher-message'].textContent).toBe('Đã sao chép mã kích hoạt.');
  ui.state.voucher = { ...ui.state.voucher, id: 'second', activationCode: 'Z9mN2qR' };
  await create(ui);
  expect(ui.elements['activation-code'].value).toBe('Z9mN2qR');
  expect(ui.elements['activation-url'].value).toBe(ui.state.voucher.activationUrl);
});

it('reload shows redeemed/expired states without including secret codes in list', async () => {
  const ui = await setup(); await create(ui);
  ui.state.list = [{ id: 'id', durationMinutes: 60, status: 'redeemed' }, { id: 'old', durationMinutes: 15, status: 'expired' }];
  ui.elements['reload-vouchers'].events.click(); await flush();
  expect(ui.elements['voucher-list'].children[0].textContent).toContain('Đã kích hoạt');
  expect(ui.elements['voucher-list'].children[1].textContent).toContain('hết hạn');
  expect(ui.elements['voucher-list'].children.some((row) => row.textContent.includes(code))).toBe(false);
});

it('created voucher status updates from the current list after activation', async () => {
  const ui = await setup(); await create(ui);
  ui.state.list = [{ id: 'voucher-id', durationMinutes: 60, status: 'redeemed' }];
  ui.elements['reload-vouchers'].events.click(); await flush();
  expect(ui.elements['created-voucher-status'].textContent).toBe('Vé 60 phút · Đã kích hoạt.');
});

it('HTTPS configured origin keeps the activation URL and QR intact', async () => {
  const ui = await setup();
  ui.state.voucher.mobileReady = true;
  ui.state.voucher.activationUrl = `https://tour.example.test/?voucher=${code}`;
  ui.state.voucher.qrSvg = await QRCode.toString(ui.state.voucher.activationUrl, { type: 'svg' });
  await create(ui);
  expect(ui.elements['activation-url'].value).toBe(ui.state.voucher.activationUrl);
  expect(ui.elements['voucher-qr'].src).toContain('data:image/svg+xml');
});

it.each([15, 60, 120])('created voucher shows actual duration %i minutes', async (minutes) => {
  const ui = await setup();
  ui.elements['voucher-duration'].value = String(minutes);
  ui.state.voucher.durationMinutes = minutes;
  ui.state.list[0].durationMinutes = minutes;
  await create(ui);
  expect(ui.elements['created-voucher-status'].textContent).toBe(`Vé ${minutes} phút · Chưa kích hoạt.`);
});

it.each([403, 500, 'network'])('management failure %s restores controls and hides internal errors', async (status) => {
  const ui = await setup();
  if (status === 'network') ui.state.network = true; else ui.state.status = status;
  await create(ui);
  expect(ui.elements['create-voucher'].disabled).toBe(false);
  expect(ui.elements['voucher-message'].textContent).not.toContain('SECRET');
  if (status === 403) expect(ui.elements['voucher-message'].textContent).toContain('ADMIN');
});
