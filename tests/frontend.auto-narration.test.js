const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const scripts = ['poi-languages.js', 'app.js'].map((name) =>
  fs.readFileSync(path.join(__dirname, '../public/js', name), 'utf8')).join('\n');
const json = (data) => ({ ok: true, json: async () => data });
const outside = { insideGeofence: false, nearestPoi: null, pois: [] };
const a = { id: 'poi-a', name: 'Điểm A', distance: 3, geofenceRadius: 50, updatedAt: 'v1' };
const b = { id: 'poi-b', name: 'Điểm B', distance: 1, geofenceRadius: 50, updatedAt: 'v1' };
const inside = (nearestPoi = a, pois = [nearestPoi]) => ({ insideGeofence: true, nearestPoi, pois });
const metadata = (id = a.id, language = 'vi', audioUrl = `/audio/saved_${id}_${language}.wav`) =>
  json({ poiId: id, language, text: `Text ${id} ${language}`, ...(audioUrl ? { audioUrl } : {}) });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const flush = () => jest.advanceTimersByTimeAsync(0);

function element() {
  return {
    value: '', checked: false, textContent: '', disabled: false, hidden: false,
    dataset: {}, attributes: {}, events: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] || null; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, callback) { this.events[name] = callback; },
    replaceChildren: jest.fn(), focus: jest.fn(), scrollIntoView: jest.fn(),
    play: jest.fn().mockResolvedValue(), pause: jest.fn(), load: jest.fn(),
  };
}

async function setup({ language = 'vi', unsupported = false, secure = true } = {}) {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)]
    .map((match) => [match[1], element()]));
  const state = {
    nearby: outside,
    narration: (id, code) => metadata(id, code),
    generation: () => json({}),
  };
  const fetch = jest.fn(async (url) => {
    if (url === '/api/pois') return json([]);
    if (url.startsWith('/api/pois/nearby?')) {
      if (state.nearby instanceof Error) throw state.nearby;
      return typeof state.nearby === 'function' ? state.nearby() : json(state.nearby);
    }
    const match = url.match(/^\/api\/pois\/([^/]+)\/narrations\/([^/]+)(\/audio)?$/);
    if (!match) throw new Error(`Unexpected request: ${url}`);
    return match[3] ? state.generation(match[1], match[2]) : state.narration(match[1], match[2]);
  });
  const geolocation = { watchPosition: jest.fn(() => 0), clearWatch: jest.fn() };
  const window = { isSecureContext: secure, addEventListener: jest.fn() };
  vm.runInNewContext(scripts, {
    document: { getElementById: (id) => elements[id], createElement: element },
    window, navigator: { geolocation: unsupported ? undefined : geolocation },
    localStorage: { getItem: () => language, setItem: jest.fn() },
    fetch, AbortController, URLSearchParams, TypeError, Date, setTimeout, clearTimeout,
  });
  await flush();
  return { elements, state, fetch, geolocation, window, audio: elements['narration-audio'] };
}

function start(ui, simulation = true) {
  ui.elements['tour-simulation'].checked = simulation;
  ui.elements['toggle-tour'].events.click();
}
async function simulate(ui, result, latitude = '10', longitude = '106') {
  ui.state.nearby = result;
  ui.elements['demo-lat'].value = latitude;
  ui.elements['demo-lng'].value = longitude;
  ui.elements['simulation-form'].events.submit({ preventDefault: jest.fn() });
  await flush();
}
async function choose(ui, language) {
  ui.elements.language.value = language;
  ui.elements.language.events.change();
  await flush();
}
const nearbyCalls = (ui) => ui.fetch.mock.calls.filter(([url]) => url.includes('/nearby?'));
const narrationCalls = (ui) => ui.fetch.mock.calls.filter(([url]) => /\/narrations\/[^/]+$/.test(url));
const postCalls = (ui) => ui.fetch.mock.calls.filter(([, options]) => options.method === 'POST');

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('Stage 6: chế độ tham quan và transition geofence', () => {
  it('mở trang chưa bật auto hoặc GPS; nút và manual controls vẫn có', async () => {
    const ui = await setup();
    expect(ui.audio.play).not.toHaveBeenCalled();
    expect(ui.geolocation.watchPosition).not.toHaveBeenCalled();
    expect(html).toMatch(/id="tour-status"[^>]*>Tự động thuyết minh: Đang tắt/);
    expect(html).toContain('Bắt đầu tham quan');
    expect(html).toMatch(/<audio[^>]*controls[^>]*preload="none"/);
    expect(html).not.toMatch(/<audio[^>]*autoplay/);
  });

  it('bắt đầu tham quan dùng GPS thật và giữ một watcher đang chạy', async () => {
    const ui = await setup();
    ui.elements['start-gps'].events.click();
    start(ui, false);
    expect(ui.geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(ui.elements['tour-status'].textContent).toContain('Đang bật');
    expect(ui.elements['toggle-tour'].getAttribute('aria-pressed')).toBe('true');
    expect(ui.elements['tour-button-label'].textContent).toBe('Dừng tham quan');
  });

  it('GPS giả lập không xin quyền vị trí thật', async () => {
    const ui = await setup();
    start(ui);
    await simulate(ui, outside);
    expect(ui.geolocation.watchPosition).not.toHaveBeenCalled();
    expect(ui.elements['current-source'].textContent).toBe('GPS giả lập');
  });

  it('outside -> inside chỉ play một lần và chỉ GET metadata, không POST TTS', async () => {
    const ui = await setup();
    start(ui);
    await simulate(ui, outside, '0', '0');
    expect(ui.audio.play).not.toHaveBeenCalled();
    await simulate(ui, inside());
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    expect(ui.audio.getAttribute('src')).toBe('/audio/saved_poi-a_vi.wav');
    expect(narrationCalls(ui).map(([url]) => url)).toEqual(['/api/pois/poi-a/narrations/vi']);
    expect(postCalls(ui)).toEqual([]);
    expect(ui.elements['auto-status'].textContent).toContain('Đã phát điểm');
  });

  it('inside -> inside dù tọa độ thay đổi vẫn giữ audio, không pause hoặc play lại', async () => {
    const ui = await setup();
    start(ui);
    await simulate(ui, inside());
    const pauses = ui.audio.pause.mock.calls.length;
    for (const latitude of ['10', '10.00001', '10.00002']) {
      await simulate(ui, inside({ ...a, distance: 5 }), latitude);
    }
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    expect(ui.audio.pause).toHaveBeenCalledTimes(pauses);
    expect(narrationCalls(ui)).toHaveLength(1);
  });

  it('inside -> outside dừng audio, vào lại mới play lần hai', async () => {
    const ui = await setup();
    start(ui);
    await simulate(ui, inside());
    const pauses = ui.audio.pause.mock.calls.length;
    await simulate(ui, outside, '0', '0');
    expect(ui.audio.pause.mock.calls.length).toBeGreaterThan(pauses);
    expect(ui.audio.getAttribute('src')).toBeNull();
    expect(ui.elements['auto-status'].textContent).toContain('lần vào tiếp theo');
    await simulate(ui, inside());
    expect(ui.audio.play).toHaveBeenCalledTimes(2);
    expect(narrationCalls(ui)).toHaveLength(2);
  });

  it('auto disabled vẫn tải audio cho manual Play', async () => {
    const ui = await setup();
    await simulate(ui, inside());
    expect(ui.audio.hidden).toBe(false);
    expect(ui.audio.play).not.toHaveBeenCalled();
    expect(ui.elements['generate-audio'].hidden).toBe(false);
    await ui.audio.play(); // Người dùng bấm native Play.
    await simulate(ui, inside());
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    expect(postCalls(ui)).toEqual([]);
  });

  it('dừng tham quan hủy watch ID 0 và audio, giả lập/manual vẫn dùng được', async () => {
    const ui = await setup();
    start(ui, false);
    ui.state.nearby = inside();
    ui.geolocation.watchPosition.mock.calls[0][0]({ coords: { latitude: 10, longitude: 106 } });
    await flush();
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    ui.elements['toggle-tour'].events.click();
    expect(ui.geolocation.clearWatch).toHaveBeenCalledWith(0);
    expect(ui.audio.getAttribute('src')).toBeNull();
    expect(ui.elements['tour-simulation'].disabled).toBe(false);
    expect(ui.elements['tour-status'].textContent).toContain('Đang tắt');
    await simulate(ui, inside());
    expect(ui.audio.hidden).toBe(false);
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
  });

  it('dừng định vị cũng tắt tham quan; bật lại bắt đầu một phiên mới', async () => {
    const ui = await setup();
    start(ui);
    await simulate(ui, inside());
    ui.elements['stop-gps'].events.click();
    expect(ui.elements['tour-status'].textContent).toContain('Đang tắt');
    start(ui);
    await simulate(ui, inside());
    expect(ui.audio.play).toHaveBeenCalledTimes(2);
  });

  it('GPS thật đi qua cùng transition với throttle, không phát lại khi di chuyển bên trong', async () => {
    const ui = await setup();
    start(ui, false);
    const position = ui.geolocation.watchPosition.mock.calls[0][0];
    position({ coords: { latitude: 0, longitude: 0 } });
    await flush();
    ui.state.nearby = inside();
    position({ coords: { latitude: 10, longitude: 106 } });
    await jest.advanceTimersByTimeAsync(3000);
    const pauses = ui.audio.pause.mock.calls.length;
    position({ coords: { latitude: 10.00001, longitude: 106 } });
    await jest.advanceTimersByTimeAsync(3000);
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    expect(ui.audio.pause).toHaveBeenCalledTimes(pauses);
    ui.state.nearby = outside;
    position({ coords: { latitude: 0, longitude: 0 } });
    await jest.advanceTimersByTimeAsync(3000);
    ui.state.nearby = inside();
    position({ coords: { latitude: 10, longitude: 106 } });
    await jest.advanceTimersByTimeAsync(3000);
    expect(ui.audio.play).toHaveBeenCalledTimes(2);
  });

  it('chuyển từ GPS thật sang giả lập vẫn inside không tạo entry giả', async () => {
    const ui = await setup();
    start(ui, false);
    ui.state.nearby = inside();
    ui.geolocation.watchPosition.mock.calls[0][0]({ coords: { latitude: 10, longitude: 106 } });
    await flush();
    const pauses = ui.audio.pause.mock.calls.length;
    await simulate(ui, inside(), '10.00001');
    expect(ui.geolocation.clearWatch).toHaveBeenCalledWith(0);
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    expect(ui.audio.pause).toHaveBeenCalledTimes(pauses);
  });

  it.each([{ unsupported: true }, { secure: false }])('GPS thật không khả dụng %j vẫn tham quan qua giả lập được', async (options) => {
    const ui = await setup(options);
    start(ui, false);
    expect(ui.elements['gps-status'].textContent).toContain('không khả dụng');
    await simulate(ui, inside());
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
  });
});

describe('Stage 6: ngôn ngữ, nhiều POI và fallback', () => {
  it.each(['vi', 'en', 'ja', 'ko'])('trigger dùng đúng metadata %s và URL trả về', async (language) => {
    const ui = await setup({ language });
    ui.state.narration = (id, code) => metadata(id, code, '/audio/opaque_server_filename.wav');
    start(ui);
    await simulate(ui, inside());
    expect(narrationCalls(ui)[0][0]).toBe(`/api/pois/poi-a/narrations/${language}`);
    expect(ui.audio.getAttribute('src')).toBe('/audio/opaque_server_filename.wav');
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
  });

  it('đổi language ở inside không query nearby/watch hoặc play; re-entry dùng language mới', async () => {
    const ui = await setup();
    start(ui);
    await simulate(ui, inside());
    await choose(ui, 'en');
    expect(ui.audio.getAttribute('src')).toBe('/audio/saved_poi-a_en.wav');
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    expect(nearbyCalls(ui)).toHaveLength(1);
    expect(ui.geolocation.watchPosition).not.toHaveBeenCalled();
    await simulate(ui, inside(), '10.00001');
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    await simulate(ui, outside, '0', '0');
    await simulate(ui, inside());
    expect(ui.audio.play).toHaveBeenCalledTimes(2);
    expect(narrationCalls(ui).at(-1)[0]).toBe('/api/pois/poi-a/narrations/en');
  });

  it('thiếu audioUrl giữ text/nút tạo, không tự POST hay retry mỗi GPS update', async () => {
    const ui = await setup();
    ui.state.narration = (id, code) => metadata(id, code, null);
    start(ui);
    await simulate(ui, inside());
    await simulate(ui, inside(), '10.00001');
    expect(ui.audio.play).not.toHaveBeenCalled();
    expect(ui.elements['auto-status'].textContent).toContain('chưa có audio');
    expect(ui.elements['narration-text'].hidden).toBe(false);
    expect(ui.elements['generate-audio'].hidden).toBe(false);
    expect(postCalls(ui)).toEqual([]);
    expect(narrationCalls(ui)).toHaveLength(1);
  });

  it('Tạo audio thủ công vẫn POST/refresh GET, không tạo auto entry', async () => {
    const ui = await setup();
    ui.state.narration = (id, code) => metadata(id, code, null);
    start(ui);
    await simulate(ui, inside());
    ui.state.narration = (id, code) => metadata(id, code);
    ui.elements['generate-audio'].events.click();
    await flush();
    expect(postCalls(ui)).toHaveLength(1);
    expect(postCalls(ui)[0][0]).toBe('/api/pois/poi-a/narrations/vi/audio');
    expect(ui.audio.hidden).toBe(false);
    expect(ui.audio.play).not.toHaveBeenCalled();
    await ui.audio.play();
    await simulate(ui, inside());
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
  });

  it('play rejection được catch, giữ manual fallback và không retry khi inside', async () => {
    const ui = await setup();
    ui.audio.play.mockRejectedValueOnce(new Error('NotAllowedError'));
    start(ui);
    await simulate(ui, inside());
    expect(ui.elements['auto-status'].textContent).toContain('Trình duyệt đã chặn');
    expect(ui.elements['audio-status'].textContent).toContain('Hãy bấm Play');
    expect(ui.audio.hidden).toBe(false);
    await simulate(ui, inside(), '10.00001');
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    await ui.audio.play();
    await simulate(ui, inside());
    expect(ui.audio.play).toHaveBeenCalledTimes(2);
  });

  it('play ném lỗi đồng bộ cũng có fallback', async () => {
    const ui = await setup();
    ui.audio.play.mockImplementationOnce(() => { throw new Error('Blocked'); });
    start(ui);
    await simulate(ui, inside());
    expect(ui.elements['auto-status'].textContent).toContain('Hãy bấm Play');
  });

  it('nhiều inside dùng nearestPoi Backend, kể cả thứ tự mảng khác', async () => {
    const ui = await setup();
    start(ui);
    await simulate(ui, inside(b, [a, b]));
    expect(narrationCalls(ui).map(([url]) => url)).toEqual(['/api/pois/poi-b/narrations/vi']);
    expect(ui.audio.getAttribute('src')).toBe('/audio/saved_poi-b_vi.wav');
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
  });

  it('thực sự đi vào B: pause A trước đổi source và play B trên cùng player', async () => {
    const ui = await setup();
    const playback = [];
    ui.audio.pause.mockImplementation(() => playback.push(`pause:${ui.audio.getAttribute('src')}`));
    ui.audio.play.mockImplementation(async () => playback.push(`play:${ui.audio.getAttribute('src')}`));
    start(ui);
    await simulate(ui, inside());
    playback.length = 0;
    await simulate(ui, inside(b, [b, a]), '10.00001');
    expect(playback).toEqual(['pause:/audio/saved_poi-a_vi.wav', 'play:/audio/saved_poi-b_vi.wav']);
    expect(ui.audio.play).toHaveBeenCalledTimes(2);
  });

  it('nearest dao động giữa hai POI vẫn inside không tạo lần entry mới', async () => {
    const ui = await setup();
    start(ui);
    await simulate(ui, inside(a, [a, b]));
    await simulate(ui, inside(b, [b, a]), '10.00001');
    await simulate(ui, inside(a, [a, b]), '10.00002');
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    expect(ui.audio.getAttribute('src')).toBe('/audio/saved_poi-a_vi.wav');
  });

  it('ra khỏi A trong khi còn inside B cũng re-arm riêng A', async () => {
    const ui = await setup();
    start(ui);
    await simulate(ui, inside(a, [a, b]));
    await simulate(ui, inside(b), '10.00001');
    await simulate(ui, inside(a, [a, b]));
    expect(ui.audio.play).toHaveBeenCalledTimes(2);
  });

  it.each([null, '/audio/../unsafe.wav', 'https://example.test/file.wav'])(
    'metadata thiếu/URL sai %s không tự phát', async (audioUrl) => {
      const ui = await setup();
      ui.state.narration = (id, code) => metadata(id, code, audioUrl);
      start(ui);
      await simulate(ui, inside());
      expect(ui.audio.getAttribute('src')).toBeNull();
      expect(ui.audio.play).not.toHaveBeenCalled();
    }
  );

  it('404 narration giữ retry manual, không fallback VI hay gọi TTS', async () => {
    const ui = await setup({ language: 'ja' });
    ui.state.narration = () => ({ ok: false, status: 404, json: async () => ({ error: 'Missing' }) });
    start(ui);
    await simulate(ui, inside());
    expect(ui.elements['auto-status'].textContent).toContain('Chưa có nội dung');
    expect(ui.elements['retry-narration'].hidden).toBe(false);
    expect(ui.elements['generate-audio'].hidden).toBe(true);
    expect(ui.audio.play).not.toHaveBeenCalled();
    expect(postCalls(ui)).toEqual([]);
  });
});

describe('Stage 6: request và play đến muộn', () => {
  it.each(['outside', 'stop', 'language', 'switch'])('hủy entry đang tải khi %s', async (action) => {
    const ui = await setup();
    const pending = deferred();
    ui.state.narration = () => pending.promise;
    start(ui);
    await simulate(ui, inside());
    const signal = narrationCalls(ui)[0][1].signal;
    ui.state.narration = (id, code) => metadata(id, code);
    if (action === 'outside') await simulate(ui, outside, '0', '0');
    if (action === 'stop') ui.elements['toggle-tour'].events.click();
    if (action === 'language') await choose(ui, 'en');
    if (action === 'switch') await simulate(ui, inside(b), '11');
    pending.resolve(metadata());
    await flush();
    expect(signal.aborted).toBe(true);
    expect(ui.audio.play).toHaveBeenCalledTimes(action === 'switch' ? 1 : 0);
    if (action === 'switch') expect(ui.audio.getAttribute('src')).toBe('/audio/saved_poi-b_vi.wav');
    if (action === 'language') expect(ui.audio.getAttribute('src')).toBe('/audio/saved_poi-a_en.wav');
  });

  it('GPS inside lặp lúc đang tải metadata không hủy entry hoặc tạo GET mới', async () => {
    const ui = await setup();
    const pending = deferred();
    ui.state.narration = () => pending.promise;
    start(ui);
    await simulate(ui, inside());
    await simulate(ui, inside(), '10.00001');
    pending.resolve(metadata());
    await flush();
    expect(narrationCalls(ui)).toHaveLength(1);
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
  });

  it('metadata tới khi vị trí mới chưa được kiểm tra phải chờ kết quả nearby mới', async () => {
    const ui = await setup();
    const narration = deferred();
    const nearby = deferred();
    ui.state.narration = () => narration.promise;
    start(ui);
    await simulate(ui, inside());
    ui.state.nearby = () => nearby.promise;
    ui.elements['demo-lat'].value = '0';
    ui.elements['demo-lng'].value = '0';
    ui.elements['simulation-form'].events.submit({ preventDefault: jest.fn() });
    narration.resolve(metadata());
    await flush();
    expect(ui.audio.play).not.toHaveBeenCalled();
    nearby.resolve(json(outside));
    await flush();
    expect(ui.audio.play).not.toHaveBeenCalled();
    expect(ui.audio.getAttribute('src')).toBeNull();
  });

  it('play rejection cũ không ghi đè language vừa chọn', async () => {
    const ui = await setup();
    const pending = deferred();
    ui.audio.play.mockReturnValueOnce(pending.promise);
    start(ui);
    await simulate(ui, inside());
    await choose(ui, 'ko');
    pending.reject(new Error('Old blocked play'));
    await flush();
    expect(ui.audio.getAttribute('src')).toBe('/audio/saved_poi-a_ko.wav');
    expect(ui.elements['audio-status'].textContent).toContain('sẵn sàng');
    expect(ui.elements['auto-status'].textContent).toContain('Đã đổi ngôn ngữ');
  });

  it('nearby lỗi tạm thời không giả lập outside/re-entry khi phục hồi', async () => {
    const ui = await setup();
    start(ui);
    await simulate(ui, inside());
    await simulate(ui, new TypeError('Offline'), '10.00001');
    expect(ui.elements['auto-status'].textContent).toContain('Chưa xác định');
    await simulate(ui, inside(), '10.00002');
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    expect(ui.audio.hidden).toBe(false);
  });

  it('nearby cũ tới sau khi chuyển vị trí không đổi membership hoặc phát audio cũ', async () => {
    const ui = await setup();
    const pending = deferred();
    start(ui, false);
    ui.state.nearby = () => pending.promise;
    ui.geolocation.watchPosition.mock.calls[0][0]({ coords: { latitude: 10, longitude: 106 } });
    await flush();
    await simulate(ui, inside(b), '11');
    pending.resolve(json(inside()));
    await flush();
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    expect(ui.audio.getAttribute('src')).toBe('/audio/saved_poi-b_vi.wav');
    expect(narrationCalls(ui).map(([url]) => url)).toEqual(['/api/pois/poi-b/narrations/vi']);
  });

  it('pagehide hủy watcher, metadata và auto pending', async () => {
    const ui = await setup();
    const pending = deferred();
    ui.state.narration = () => pending.promise;
    start(ui, false);
    ui.state.nearby = inside();
    ui.geolocation.watchPosition.mock.calls[0][0]({ coords: { latitude: 10, longitude: 106 } });
    await flush();
    ui.window.addEventListener.mock.calls.find(([event]) => event === 'pagehide')[1]();
    pending.resolve(metadata());
    await flush();
    expect(ui.audio.play).not.toHaveBeenCalled();
    expect(ui.geolocation.clearWatch).toHaveBeenCalledWith(0);
    expect(ui.elements['tour-status'].textContent).toContain('Đang tắt');
  });
});
