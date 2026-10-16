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
  const voucher = { id: 'voucher-id', code, durationMinutes: 60, status: 'unused', activationUrl: `http://localhost:3000/?voucher=${code}`, mobileReady: false };
  voucher.qrSvg = await QRCode.toString(voucher.activationUrl, { type: 'svg' });
  const state = { voucher, status: 200, network: false, list: [{ id: 'voucher-id', durationMinutes: 60, status: 'unused' }] };
  const fetch = jest.fn(async (url, options) => {
    if (state.network) throw new TypeError('SECRET');
    return json(options.method === 'POST' ? state.voucher : state.list, state.status);
  });
  const clipboard = { writeText: jest.fn().mockResolvedValue() };
  vm.runInNewContext(script, { document: { getElementById: (id) => elements[id], createElement: element }, window: { addEventListener: jest.fn() }, navigator: { clipboard }, fetch, URL, Date, TypeError, SyntaxError, AbortController, encodeURIComponent, setTimeout, clearTimeout });
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
  expect(post[1].headers['X-Demo-Admin']).toBe('true');
  expect(ui.elements['activation-url'].value).toBe(ui.state.voucher.activationUrl);
  expect(decodeURIComponent(ui.elements['voucher-qr'].src.split(',')[1])).toBe(ui.state.voucher.qrSvg);
  expect(ui.elements['voucher-result'].hidden).toBe(false);
  expect(ui.elements['voucher-origin-note'].textContent).toContain('chưa sẵn sàng');
  expect(ui.fetch.mock.calls.every(([url]) => url === '/api/access/vouchers')).toBe(true);
});

it('copy URL uses clipboard with voucher only, no session token', async () => {
  const ui = await setup(); await create(ui);
  await ui.elements['copy-voucher-url'].events.click();
  expect(ui.clipboard.writeText).toHaveBeenCalledWith(ui.state.voucher.activationUrl);
  expect(ui.elements['activation-url'].value).not.toContain('accessToken');
});

it('reload shows redeemed/expired states without including secret codes in list', async () => {
  const ui = await setup();
  ui.state.list = [{ id: 'id', durationMinutes: 60, status: 'redeemed' }, { id: 'old', durationMinutes: 15, status: 'expired' }];
  ui.elements['reload-vouchers'].events.click(); await flush();
  expect(ui.elements['voucher-list'].children[0].textContent).toContain('Đã kích hoạt');
  expect(ui.elements['voucher-list'].children[1].textContent).toContain('hết hạn');
  expect(ui.elements['voucher-list'].children.some((row) => row.textContent.includes(code))).toBe(false);
});

it('HTTPS configured origin displays mobile readiness guidance', async () => {
  const ui = await setup();
  ui.state.voucher.mobileReady = true;
  ui.state.voucher.activationUrl = `https://tour.example.test/?voucher=${code}`;
  ui.state.voucher.qrSvg = await QRCode.toString(ui.state.voucher.activationUrl, { type: 'svg' });
  await create(ui);
  expect(ui.elements['voucher-origin-note'].textContent).toContain('HTTPS');
});

it.each([403, 500, 'network'])('management failure %s restores controls and hides internal errors', async (status) => {
  const ui = await setup();
  if (status === 'network') ui.state.network = true; else ui.state.status = status;
  await create(ui);
  expect(ui.elements['create-voucher'].disabled).toBe(false);
  expect(ui.elements['voucher-message'].textContent).not.toContain('SECRET');
  if (status === 403) expect(ui.elements['voucher-message'].textContent).toContain('demo local');
});
