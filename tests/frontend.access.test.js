const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const scripts = ['poi-languages.js', 'access.js', 'app.js'].map((file) => fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8')).join('\n');
const token = 'b'.repeat(64);
const code = 'c'.repeat(64);
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const outside = { insideGeofence: false, nearestPoi: null, pois: [] };
const poi = { id: 'active-poi', name: 'POI', distance: 0, geofenceRadius: 50, updatedAt: 'v1' };
const inside = { insideGeofence: true, nearestPoi: poi, pois: [poi] };
const flush = () => jest.advanceTimersByTimeAsync(0);
const sessionData = (remaining = 15 * 60000) => ({
  accessToken: token, durationMinutes: 15, serverTime: new Date(Date.now()).toISOString(),
  startedAt: new Date(Date.now() - (15 * 60000 - remaining)).toISOString(),
  expiresAt: new Date(Date.now() + remaining).toISOString(),
});
const element = () => ({
  value: '', checked: false, textContent: '', disabled: false, hidden: false, dataset: {}, attributes: {}, events: {},
  setAttribute(name, value) { this.attributes[name] = value; },
  getAttribute(name) { return this.attributes[name] || null; },
  removeAttribute(name) { delete this.attributes[name]; },
  addEventListener(name, callback) { this.events[name] = callback; },
  replaceChildren: jest.fn(), append: jest.fn(), focus: jest.fn(), scrollIntoView: jest.fn(),
  pause: jest.fn(), load: jest.fn(), play: jest.fn().mockResolvedValue(),
});

async function setup({ href = 'http://localhost:3000/', savedToken, sessionResponse, storageBlocked = false } = {}) {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], element()]));
  const storage = new Map(savedToken ? [['tourist-access-token', savedToken]] : []);
  const sessionStorage = {
    getItem: jest.fn((key) => { if (storageBlocked) throw new Error('Blocked'); return storage.get(key); }),
    setItem: jest.fn((key, value) => { if (storageBlocked) throw new Error('Blocked'); storage.set(key, value); }),
    removeItem: jest.fn((key) => storage.delete(key)),
  };
  const state = { nearby: outside, overrides: new Map(), metadata: true, hasAudio: true, audioType: 'audio/wav' };
  if (sessionResponse) state.overrides.set('/api/access/session', sessionResponse);
  const fetch = jest.fn(async (url, options) => {
    if (state.overrides.has(url)) {
      const value = state.overrides.get(url);
      if (value instanceof Error) throw value;
      return typeof value === 'function' ? value(options) : value;
    }
    if (url === '/api/pois') return json([]);
    if (url === '/api/access/redeem' || url === '/api/access/session') return json(sessionData());
    if (url.startsWith('/api/pois/nearby?')) return json(state.nearby);
    if (url.startsWith('/api/pois/active-poi/narrations/')) {
      const language = url.split('/').at(-1);
      if (!state.metadata) return json({ error: 'Missing' }, 404);
      return json({ poiId: poi.id, language, text: `Text ${language}`, ...(state.hasAudio ? { audioUrl: `/audio/${language}.wav` } : {}) });
    }
    if (url.startsWith('/audio/')) return { ok: true, status: 200, blob: async () => ({ type: state.audioType }) };
    throw new Error('Unexpected request');
  });
  const events = {};
  const documentEvents = {};
  const window = {
    isSecureContext: true, location: { href },
    addEventListener: (name, callback) => { (events[name] ||= []).push(callback); },
    history: { replaceState: jest.fn((state, title, value) => { window.location.href = new URL(value, window.location.href).href; }) },
  };
  const document = { hidden: false, getElementById: (id) => elements[id], createElement: element, addEventListener: (name, callback) => { documentEvents[name] = callback; } };
  const geolocation = { watchPosition: jest.fn(() => 0), clearWatch: jest.fn() };
  class BrowserURL extends URL {}
  BrowserURL.createObjectURL = jest.fn(() => 'blob:protected-audio');
  BrowserURL.revokeObjectURL = jest.fn();
  const localStorage = { getItem: () => null, setItem: jest.fn() };
  vm.runInNewContext(scripts, {
    document, window, sessionStorage, localStorage, navigator: { geolocation },
    fetch, URL: BrowserURL, URLSearchParams, AbortController, Date, TypeError,
    performance, setTimeout, clearTimeout,
  });
  await flush();
  return { elements, state, fetch, window, document, events, documentEvents, storage, sessionStorage, localStorage, geolocation, URL: BrowserURL, audio: elements['narration-audio'] };
}
const requests = (ui, url) => ui.fetch.mock.calls.filter(([target]) => target === url);
async function activate(ui) {
  ui.elements['voucher-code'].value = code;
  ui.elements['access-form'].events.submit({ preventDefault: jest.fn() });
  await flush();
}
function start(ui, simulation = true) {
  ui.elements['tour-simulation'].checked = simulation;
  ui.elements['toggle-tour'].events.click();
}
async function simulate(ui, result = inside, latitude = '10') {
  ui.state.nearby = result;
  ui.elements['demo-lat'].value = latitude;
  ui.elements['demo-lng'].value = '106';
  ui.elements['simulation-form'].events.submit({ preventDefault: jest.fn() });
  await flush();
}

beforeEach(() => { jest.useFakeTimers({ now: Date.parse('2026-10-13T01:00:00Z') }); });
afterEach(() => { jest.useRealTimers(); });

it('opening QR prefills the code without redeem, storage writes, autoplay or GPS', async () => {
  const ui = await setup({ href: `http://localhost:3000/?voucher=${code}` });
  expect(ui.elements['voucher-code'].value).toBe(code);
  expect(requests(ui, '/api/access/redeem')).toHaveLength(0);
  expect(ui.sessionStorage.setItem).not.toHaveBeenCalled();
  expect(ui.localStorage.setItem).not.toHaveBeenCalledWith(expect.anything(), code);
  expect(ui.geolocation.watchPosition).not.toHaveBeenCalled();
  expect(ui.audio.play).not.toHaveBeenCalled();
  expect(ui.elements['toggle-tour'].disabled).toBe(true);
});

it('inactive session blocks tour, protected metadata/audio and manual media setup', async () => {
  const ui = await setup();
  start(ui);
  await simulate(ui);
  expect(ui.elements['tour-status'].textContent).toContain('Đang tắt');
  expect(ui.fetch.mock.calls.some(([url]) => url.includes('/narrations/') || url.startsWith('/audio/'))).toBe(false);
  expect(ui.audio.getAttribute('src')).toBeNull();
});

it('activation updates UI, stores only the session and removes voucher from URL preserving other parameters', async () => {
  const ui = await setup({ href: `http://localhost:3000/?voucher=${code}&lang=en#main` });
  await activate(ui);
  expect(ui.elements['access-status'].textContent).toContain('Đã kích hoạt');
  expect(ui.elements['access-countdown'].textContent).toBe('15:00');
  expect(ui.elements['access-expiry'].textContent).not.toBe('—');
  expect(ui.elements['toggle-tour'].disabled).toBe(false);
  expect(ui.storage.get('tourist-access-token')).toBe(token);
  expect(ui.elements['voucher-code'].value).toBe('');
  expect(ui.window.history.replaceState).toHaveBeenCalledWith(null, '', '/?lang=en#main');
  expect(ui.window.location.href).not.toContain(token);
  expect(ui.geolocation.watchPosition).not.toHaveBeenCalled();
  expect(JSON.parse(requests(ui, '/api/access/redeem')[0][1].body)).toEqual({ code });
});

it('refresh verifies stored token with backend and does not redeem', async () => {
  const ui = await setup({ savedToken: token });
  expect(requests(ui, '/api/access/session')[0][1].headers.Authorization).toBe(`Bearer ${token}`);
  expect(requests(ui, '/api/access/session')).toHaveLength(1);
  expect(requests(ui, '/api/access/redeem')).toHaveLength(0);
  expect(ui.elements['toggle-tour'].disabled).toBe(false);
});

it.each([401, 500])('refresh rejects stored session when backend returns HTTP %i', async (status) => {
  const ui = await setup({ savedToken: token, sessionResponse: json({ error: 'SECRET internal path' }, status) });
  expect(ui.elements['toggle-tour'].disabled).toBe(true);
  expect(ui.storage.has('tourist-access-token')).toBe(false);
  expect(ui.elements['access-message'].textContent).not.toContain('SECRET');
});

it('storage blocked uses memory-only session without crashing', async () => {
  const ui = await setup({ storageBlocked: true });
  await activate(ui);
  start(ui); await simulate(ui);
  expect(ui.audio.play).toHaveBeenCalledTimes(1);
});

it.each([400, 409, 500])('redeem HTTP %i keeps UI inactive and safely allows retry', async (status) => {
  const ui = await setup();
  ui.state.overrides.set('/api/access/redeem', json({ error: `SECRET ${token}` }, status));
  await activate(ui);
  expect(ui.elements['toggle-tour'].disabled).toBe(true);
  expect(ui.elements['activate-voucher'].disabled).toBe(false);
  expect(ui.elements['access-message'].textContent).not.toMatch(/SECRET|bbbb/);
  expect(ui.storage.has('tourist-access-token')).toBe(false);
});

it('network error is handled, retains entered voucher for explicit retry and never auto retries', async () => {
  const ui = await setup();
  ui.state.overrides.set('/api/access/redeem', new TypeError(`SECRET ${token}`));
  await activate(ui);
  await jest.advanceTimersByTimeAsync(60000);
  expect(requests(ui, '/api/access/redeem')).toHaveLength(1);
  expect(ui.elements['voucher-code'].value).toBe(code);
  expect(ui.elements['access-message'].textContent).toContain('Kiểm tra mạng');
});

it('redeem timeout clears loading, with no unhandled rejection or automatic retry', async () => {
  const ui = await setup();
  ui.state.overrides.set('/api/access/redeem', ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('Timeout'), { name: 'AbortError' })));
  }));
  ui.elements['voucher-code'].value = code;
  ui.elements['access-form'].events.submit({ preventDefault: jest.fn() });
  await jest.advanceTimersByTimeAsync(10000);
  expect(ui.elements['activate-voucher'].disabled).toBe(false);
  expect(requests(ui, '/api/access/redeem')).toHaveLength(1);
});

it('double activation submits exactly one request', async () => {
  const ui = await setup();
  let finish;
  ui.state.overrides.set('/api/access/redeem', () => new Promise((resolve) => { finish = resolve; }));
  ui.elements['voucher-code'].value = code;
  for (let i = 0; i < 2; i++) ui.elements['access-form'].events.submit({ preventDefault: jest.fn() });
  expect(requests(ui, '/api/access/redeem')).toHaveLength(1);
  finish(json(sessionData())); await flush();
  expect(ui.elements['toggle-tour'].disabled).toBe(false);
});

it('countdown uses server-relative monotonic time even if frontend wall clock changes', async () => {
  const ui = await setup();
  await activate(ui);
  jest.setSystemTime(Date.parse('2099-01-01T00:00:00Z'));
  await jest.advanceTimersByTimeAsync(1000);
  expect(ui.elements['access-countdown'].textContent).toBe('14:59');
  expect(ui.elements['toggle-tour'].disabled).toBe(false);
});

it('slow redeem response does not extend the server supplied remaining duration', async () => {
  const ui = await setup();
  const issued = sessionData();
  let finish;
  ui.state.overrides.set('/api/access/redeem', () => new Promise((resolve) => { finish = resolve; }));
  ui.elements['voucher-code'].value = code;
  ui.elements['access-form'].events.submit({ preventDefault: jest.fn() });
  await jest.advanceTimersByTimeAsync(3000);
  finish(json(issued)); await flush();
  expect(ui.elements['access-countdown'].textContent).toBe('14:57');
});

it('late audio blob after expiration is discarded without playback or leaked object URL', async () => {
  const ui = await setup();
  ui.state.overrides.set('/api/access/redeem', () => json(sessionData(2000)));
  await activate(ui);
  let finish;
  ui.state.overrides.set('/audio/vi.wav', () => new Promise((resolve) => { finish = resolve; }));
  start(ui); await simulate(ui);
  await jest.advanceTimersByTimeAsync(2000);
  finish({ ok: true, status: 200, blob: async () => ({ type: 'audio/wav' }) }); await flush();
  expect(ui.URL.createObjectURL).not.toHaveBeenCalled();
  expect(ui.audio.play).not.toHaveBeenCalled();
});

it('expiration stops playback, revokes blob, clears access/autoplay, and reactivation permits a new entry', async () => {
  const ui = await setup();
  ui.state.overrides.set('/api/access/redeem', () => json(sessionData(2000)));
  await activate(ui); start(ui); await simulate(ui);
  expect(ui.audio.play).toHaveBeenCalledTimes(1);
  const pauses = ui.audio.pause.mock.calls.length;
  await jest.advanceTimersByTimeAsync(2000);
  expect(ui.audio.pause.mock.calls.length).toBeGreaterThan(pauses);
  expect(ui.audio.getAttribute('src')).toBeNull();
  expect(ui.URL.revokeObjectURL).toHaveBeenCalledWith('blob:protected-audio');
  expect(ui.elements['toggle-tour'].disabled).toBe(true);
  await simulate(ui);
  expect(ui.audio.play).toHaveBeenCalledTimes(1);
  await activate(ui); start(ui); await simulate(ui);
  expect(ui.audio.play).toHaveBeenCalledTimes(2);
});

it('valid session sends Authorization only in headers and plays a managed blob', async () => {
  const ui = await setup();
  await activate(ui); start(ui); await simulate(ui);
  for (const [url, options] of ui.fetch.mock.calls.filter(([url]) => url.includes('/narrations/') || url.startsWith('/audio/'))) {
    expect(options.headers.Authorization).toBe(`Bearer ${token}`);
    expect(url).not.toContain(token);
  }
  expect(ui.audio.getAttribute('src')).toBe('blob:protected-audio');
  expect(ui.URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(ui.audio.play).toHaveBeenCalledTimes(1);
});

it('outside/inside/inside/outside/inside transitions still play exactly twice', async () => {
  const ui = await setup();
  await activate(ui); start(ui);
  for (const result of [outside, inside, inside, outside, inside]) await simulate(ui, result);
  expect(ui.audio.play).toHaveBeenCalledTimes(2);
  expect(requests(ui, '/api/access/session')).toHaveLength(0);
  expect(requests(ui, '/api/access/redeem')).toHaveLength(1);
});

it('switching language cancels old media and keeps inside entry consumed', async () => {
  const ui = await setup();
  await activate(ui); start(ui); await simulate(ui);
  ui.elements.language.value = 'ja'; ui.elements.language.events.change(); await flush();
  await simulate(ui);
  expect(ui.audio.play).toHaveBeenCalledTimes(1);
  expect(ui.URL.revokeObjectURL).toHaveBeenCalled();
  expect(requests(ui, '/audio/ja.wav')).toHaveLength(1);
});

it('manual Play loads protected audio without enabling GPS or autoplay', async () => {
  const ui = await setup();
  await activate(ui); await simulate(ui);
  expect(ui.audio.hidden).toBe(false);
  expect(ui.audio.play).not.toHaveBeenCalled();
  await ui.audio.play();
  expect(ui.geolocation.watchPosition).not.toHaveBeenCalled();
});

it('real GPS uses the same narration path and no per-location session polling', async () => {
  const ui = await setup();
  await activate(ui); start(ui, false);
  ui.state.nearby = inside;
  const onPosition = ui.geolocation.watchPosition.mock.calls[0][0];
  onPosition({ coords: { latitude: 10, longitude: 106, accuracy: 5 } }); await flush();
  for (let i = 0; i < 5; i++) onPosition({ coords: { latitude: 10, longitude: 106, accuracy: 5 } });
  await jest.advanceTimersByTimeAsync(3000);
  expect(ui.audio.play).toHaveBeenCalledTimes(1);
  expect(requests(ui, '/api/access/session')).toHaveLength(0);
});

it.each([false, true])('missing narration/audio is handled without TTS, crash or retry loops (%s)', async (metadata) => {
  const ui = await setup();
  ui.state.metadata = metadata; ui.state.hasAudio = false;
  await activate(ui); start(ui); await simulate(ui); await simulate(ui);
  expect(ui.audio.play).not.toHaveBeenCalled();
  expect(ui.elements['audio-status'].textContent).toContain(metadata ? 'Chưa có audio' : 'Chưa có nội dung');
  expect(requests(ui, '/api/pois/active-poi/narrations/vi')).toHaveLength(1);
});

it.each(['/api/pois/active-poi/narrations/vi', '/audio/vi.wav'])('backend 401 on %s immediately stops and clears access', async (url) => {
  const ui = await setup();
  await activate(ui);
  ui.state.overrides.set(url, json({ error: 'Expired' }, 401));
  start(ui); await simulate(ui);
  expect(ui.audio.getAttribute('src')).toBeNull();
  expect(ui.elements['toggle-tour'].disabled).toBe(true);
  expect(ui.storage.has('tourist-access-token')).toBe(false);
});

it.each([500, 'network', 'wrong-type'])('audio fetch failure %s does not leak errors or cause unhandled rejection', async (kind) => {
  const ui = await setup();
  await activate(ui);
  if (kind === 'wrong-type') ui.state.audioType = 'text/html';
  else ui.state.overrides.set('/audio/vi.wav', kind === 'network' ? new TypeError('SECRET') : json({ error: 'SECRET' }, 500));
  start(ui); await simulate(ui);
  expect(ui.audio.getAttribute('src')).toBeNull();
  expect(ui.elements['audio-status'].textContent).not.toContain('SECRET');
  expect(ui.audio.play).not.toHaveBeenCalled();
});

it('stopping tour cancels media and object URL while retaining the valid ticket', async () => {
  const ui = await setup();
  await activate(ui); start(ui); await simulate(ui); start(ui);
  expect(ui.audio.getAttribute('src')).toBeNull();
  expect(ui.URL.revokeObjectURL).toHaveBeenCalled();
  expect(ui.storage.get('tourist-access-token')).toBe(token);
});

it('visibility restore checks once while a request is in flight; timers do not make network requests', async () => {
  const ui = await setup();
  await activate(ui);
  let finish;
  ui.state.overrides.set('/api/access/session', () => new Promise((resolve) => { finish = resolve; }));
  for (let i = 0; i < 10; i++) ui.documentEvents.visibilitychange();
  expect(requests(ui, '/api/access/session')).toHaveLength(1);
  finish(json(sessionData())); await flush();
  await jest.advanceTimersByTimeAsync(60000);
  expect(requests(ui, '/api/access/session')).toHaveLength(1);
});

it('pagehide cancels playback, timers and fetch, and ignores a late redeem response', async () => {
  const ui = await setup();
  let finish;
  ui.state.overrides.set('/api/access/redeem', () => new Promise((resolve) => { finish = resolve; }));
  ui.elements['voucher-code'].value = code;
  ui.elements['access-form'].events.submit({ preventDefault: jest.fn() });
  const signal = requests(ui, '/api/access/redeem')[0][1].signal;
  ui.events.pagehide.forEach((fn) => fn());
  finish(json(sessionData())); await flush();
  expect(signal.aborted).toBe(true);
  expect(ui.storage.has('tourist-access-token')).toBe(false);
  expect(ui.elements['toggle-tour'].disabled).toBe(true);
});
