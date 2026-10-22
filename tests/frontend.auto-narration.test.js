const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const scripts = ['poi-languages.js', 'translations.js', 'app.js'].map((name) =>
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
    dataset: {}, attributes: {}, events: {}, listenerCount: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] || null; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, callback) { this.events[name] = callback; this.listenerCount[name] = (this.listenerCount[name] || 0) + 1; },
    replaceChildren: jest.fn(), focus: jest.fn(), scrollIntoView: jest.fn(),
    play: jest.fn().mockResolvedValue(), pause: jest.fn(), load: jest.fn(),
  };
}

async function setup({ language = 'vi', unsupported = false, secure = true, map } = {}) {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)]
    .map((match) => [match[1], element()]));
  const state = {
    nearby: outside,
    address: () => json({ streetAddress: '12 Đường A', ward: 'Phường A', city: 'Hồ Chí Minh' }),
    narration: (id, code) => metadata(id, code),
    generation: () => json({}),
  };
  const fetch = jest.fn(async (url) => {
    if (url.startsWith('/api/geocode/reverse?')) return state.address(url);
    if (url.startsWith('/audio/')) return { ok: true, blob: async () => ({ type: 'audio/wav', url }) };
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
  // Stage 6 transition tests run under an already valid Stage 8 session.
  // The real lifecycle and authorization headers are tested separately.
  window.TOUR_ACCESS = { active: () => true, headers: () => ({ Authorization: 'Bearer fixture' }), lose: jest.fn(), subscribe: (fn) => fn(true) };
  if (map) window.TOUR_MAP = map;
  vm.runInNewContext(scripts, {
    document: { getElementById: (id) => elements[id], createElement: element, documentElement: {}, querySelectorAll: () => [] },
    window, navigator: { geolocation: unsupported ? undefined : geolocation },
    localStorage: { getItem: () => language, setItem: jest.fn() },
    fetch, AbortController, URLSearchParams, URL: { createObjectURL: (blob) => `blob:${blob.url}`, revokeObjectURL: jest.fn() }, TypeError, Date, setTimeout, clearTimeout,
  });
  await flush();
  return { elements, state, fetch, geolocation, window, audio: elements['narration-audio'] };
}

function start(ui) {
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

describe('địa chỉ vị trí khách', () => {
  it('chưa bật GPS không truy vấn reverse và hiện trạng thái chờ', async () => {
    const ui = await setup();
    expect(ui.elements['current-street'].textContent).toBe('Chưa xác định vị trí');
    expect(ui.fetch.mock.calls.filter(([url]) => url.startsWith('/api/geocode/reverse?'))).toHaveLength(0);
  });

  it('GPS thật hiển thị địa chỉ, jitter không truy vấn liên tục', async () => {
    const ui = await setup();
    ui.elements['start-gps'].events.click();
    const receive = ui.geolocation.watchPosition.mock.calls[0][0];
    receive({ coords: { latitude: 10, longitude: 106, accuracy: 12 } });
    await flush();
    expect(ui.elements['current-street'].textContent).toBe('12 Đường A');
    expect(ui.elements['current-ward'].textContent).toBe('Phường A');
    expect(ui.elements['current-city'].textContent).toBe('Hồ Chí Minh');
    receive({ coords: { latitude: 10.0001, longitude: 106, accuracy: 12 } });
    await flush();
    expect(ui.fetch.mock.calls.filter(([url]) => url.startsWith('/api/geocode/reverse?'))).toHaveLength(1);
    expect(ui.geolocation.watchPosition).toHaveBeenCalledTimes(1);
  });

  it('giả lập dùng tọa độ riêng và bỏ qua kết quả GPS thật đến muộn', async () => {
    const ui = await setup();
    const old = deferred();
    ui.state.address = jest.fn().mockImplementationOnce(() => old.promise)
      .mockResolvedValue(json({ streetAddress: 'Đường giả lập', ward: 'Phường B', city: 'Đà Nẵng' }));
    ui.elements['start-gps'].events.click();
    ui.geolocation.watchPosition.mock.calls[0][0]({ coords: { latitude: 10, longitude: 106, accuracy: 10 } });
    await flush();
    await simulate(ui, outside, '11', '107');
    await jest.advanceTimersByTimeAsync(30000);
    old.resolve(json({ streetAddress: 'Đường GPS cũ' }));
    await flush();
    expect(ui.elements['current-street'].textContent).toBe('Đường giả lập');
    expect(ui.elements['current-ward'].textContent).toBe('Phường B');
    expect(ui.fetch.mock.calls.filter(([url]) => url.startsWith('/api/geocode/reverse?')).map(([url]) => url))
      .toEqual(['/api/geocode/reverse?lat=10&lng=106', '/api/geocode/reverse?lat=11&lng=107']);
  });

  it('không có kết quả hoặc dịch vụ lỗi vẫn giữ geofencing hoạt động', async () => {
    const ui = await setup();
    ui.state.address = jest.fn().mockResolvedValueOnce(json({ city: 'Huế' })).mockRejectedValueOnce(new Error('offline'));
    await simulate(ui, outside, '10', '106');
    expect(ui.elements['current-street'].textContent).toBe('Chưa xác định được số nhà, tên đường');
    expect(ui.elements['current-city'].textContent).toBe('Huế');
    await simulate(ui, outside, '11', '107');
    await jest.advanceTimersByTimeAsync(30000);
    expect(ui.elements['current-street'].textContent).toBe('Chưa lấy được địa chỉ, đang sử dụng tọa độ GPS');
    expect(ui.elements['geofence-panel'].dataset.state).toBe('outside');
  });

  it('thiếu khóa i18n không hiển thị addressUnknown hoặc undefined', async () => {
    const ui = await setup();
    for (const dictionary of Object.values(ui.window.TOUR_TRANSLATIONS)) {
      delete dictionary.addressUnknown;
      delete dictionary.locationUnknown;
    }
    ui.state.address = () => json({ streetAddress: null, ward: 'Phường An Lạc', city: 'Thành phố Hồ Chí Minh' });
    await simulate(ui, outside, '10', '106');
    expect(ui.elements['current-street'].textContent).toBe('Chưa xác định được số nhà, tên đường');
    expect(ui.elements['current-ward'].textContent).toBe('Phường An Lạc');
    expect(ui.elements['current-city'].textContent).toBe('Thành phố Hồ Chí Minh');
    expect(ui.elements['current-street'].textContent).not.toMatch(/addressUnknown|undefined/);
  });

  it('timeout dịch vụ địa chỉ không dừng GPS hoặc geofencing', async () => {
    const ui = await setup();
    ui.state.address = jest.fn((url) => new Promise((resolve, reject) => {
      const signal = ui.fetch.mock.calls.at(-1)[1].signal;
      signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })));
    }));
    ui.elements['start-gps'].events.click();
    ui.geolocation.watchPosition.mock.calls[0][0]({ coords: { latitude: 10, longitude: 106, accuracy: 10 } });
    await flush();
    await jest.advanceTimersByTimeAsync(8000);
    expect(ui.elements['current-street'].textContent).toBe('Chưa lấy được địa chỉ, đang sử dụng tọa độ GPS');
    expect(ui.elements['geofence-panel'].dataset.state).toBe('outside');
    expect(ui.geolocation.clearWatch).not.toHaveBeenCalled();
  });

  it('chuyển từ giả lập sang GPS thật không giữ địa chỉ giả lập', async () => {
    const ui = await setup();
    await simulate(ui, outside, '11', '107');
    expect(ui.elements['current-street'].textContent).toBe('12 Đường A');
    ui.elements['start-gps'].events.click();
    expect(ui.elements['current-street'].textContent).toBe('Chưa xác định vị trí');
    ui.geolocation.watchPosition.mock.calls[0][0]({ coords: { latitude: 10, longitude: 106, accuracy: 10 } });
    await jest.advanceTimersByTimeAsync(30000);
    expect(ui.elements['current-source'].textContent).toBe('GPS thật');
    expect(ui.elements['current-street'].textContent).toBe('12 Đường A');
  });

  it('tọa độ giả lập không ghi đè callback GPS thật cũ và marker được xóa khi khởi động lại GPS', async () => {
    const map = { init: jest.fn(), setPois: jest.fn(), setLocation: jest.fn(), clearLocation: jest.fn() };
    const ui = await setup({ map });
    ui.elements['start-gps'].events.click();
    const oldGps = ui.geolocation.watchPosition.mock.calls[0][0];
    oldGps({ coords: { latitude: 10, longitude: 106, accuracy: 10 } });
    await simulate(ui, outside, '11', '107');
    oldGps({ coords: { latitude: 12, longitude: 108, accuracy: 10 } });
    expect(map.setLocation.mock.calls.at(-1)[0]).toMatchObject({ latitude: 11, longitude: 107, source: 'GPS giả lập' });
    ui.elements['start-gps'].events.click();
    expect(map.clearLocation).toHaveBeenCalledTimes(1);
    expect(ui.elements['current-source'].textContent).toBe('Chưa có');
    ui.geolocation.watchPosition.mock.calls[1][0]({ coords: { latitude: 13, longitude: 109, accuracy: 10 } });
    expect(map.setLocation.mock.calls.at(-1)[0]).toMatchObject({ latitude: 13, longitude: 109, source: 'GPS thật' });
  });

  it('quyền GPS bị từ chối thoát trạng thái chờ và có thể thử lại', async () => {
    const ui = await setup();
    ui.elements['start-gps'].events.click();
    ui.geolocation.watchPosition.mock.calls[0][1]({ code: 1 });
    expect(ui.elements['gps-message'].textContent).toContain('Bạn chưa cấp quyền truy cập vị trí');
    expect(ui.elements['start-gps'].disabled).toBe(false);
    expect(ui.elements['geofence-panel'].dataset.state).toBe('idle');
    ui.elements['start-gps'].events.click();
    expect(ui.geolocation.watchPosition).toHaveBeenCalledTimes(2);
  });

  it('lần lấy GPS đầu tiên quá hạn không kẹt loading và dọn watcher', async () => {
    const ui = await setup();
    ui.elements['start-gps'].events.click();
    await jest.advanceTimersByTimeAsync(25000);
    expect(ui.elements['gps-message'].textContent).toContain('quá thời gian chờ');
    expect(ui.elements['geofence-panel'].dataset.state).toBe('idle');
    expect(ui.elements['start-gps'].disabled).toBe(false);
    expect(ui.geolocation.clearWatch).toHaveBeenCalledWith(0);
  });

  it.each([[2, 'GPS không khả dụng'], [3, 'GPS lỗi']])('lỗi GPS mã %i cho phép thử lại', async (code, status) => {
    const ui = await setup();
    ui.elements['start-gps'].events.click();
    ui.geolocation.watchPosition.mock.calls[0][1]({ code });
    expect(ui.elements['gps-status'].textContent).toBe(status);
    expect(ui.elements['start-gps'].disabled).toBe(false);
    expect(ui.elements['geofence-panel'].dataset.state).toBe('idle');
  });

  it('dừng khi đang chờ GPS hủy watcher và bỏ qua callback cũ', async () => {
    const ui = await setup();
    ui.elements['start-gps'].events.click();
    const receive = ui.geolocation.watchPosition.mock.calls[0][0];
    ui.elements['stop-gps'].events.click();
    receive({ coords: { latitude: 10, longitude: 106, accuracy: 10 } });
    await jest.advanceTimersByTimeAsync(25000);
    expect(ui.elements['gps-status'].textContent).toBe('GPS đã dừng');
    expect(ui.elements['current-street'].textContent).toBe('Chưa xác định vị trí');
    expect(ui.fetch.mock.calls.filter(([url]) => url.startsWith('/api/geocode/reverse?'))).toHaveLength(0);
  });
});

describe('giao diện bốn ngôn ngữ', () => {
  it('HTML có ID duy nhất, một nút tham quan và mọi data-i18n có đủ bốn bản dịch', async () => {
    const ui = await setup();
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(html.match(/id="toggle-tour"/g)).toHaveLength(1);
    const keys = [...html.matchAll(/data-i18n(?:-placeholder|-aria-label)?="([^"]+)"/g)]
      .map((match) => match[1]);
    for (const language of ['vi', 'en', 'ja', 'ko']) {
      for (const key of keys) expect(ui.window.TOUR_TRANSLATIONS[language][key]).toEqual(expect.any(String));
    }
  });

  it('đổi vi → en → ja → ko → vi nhiều lần giữ một listener và đúng nhãn nút đang bật', async () => {
    const ui = await setup();
    start(ui);
    for (const language of ['en', 'ja', 'ko', 'vi', 'en', 'vi']) {
      await choose(ui, language);
      expect(ui.elements['tour-button-label'].textContent).toBe(ui.window.TOUR_TRANSLATIONS[language].stopTour);
      expect(ui.elements['tour-status'].textContent).toBe(ui.window.TOUR_TRANSLATIONS[language].tourOn);
      expect(ui.elements['toggle-tour'].getAttribute('aria-pressed')).toBe('true');
    }
    expect(ui.elements.language.listenerCount.change).toBe(1);
    expect(ui.elements['toggle-tour'].listenerCount.click).toBe(1);
    ui.elements['toggle-tour'].events.click();
    expect(ui.elements['tour-button-label'].textContent).toBe(ui.window.TOUR_TRANSLATIONS.vi.startTour);
  });

  it('GPS và geofence render mới theo ngôn ngữ được chọn', async () => {
    const ui = await setup();
    await choose(ui, 'en');
    ui.elements['start-gps'].events.click();
    expect(ui.elements['gps-status'].textContent).toBe(ui.window.TOUR_TRANSLATIONS.en.gettingLocation);
    ui.geolocation.watchPosition.mock.calls[0][0]({ coords: { latitude: 10, longitude: 106, accuracy: 12 } });
    await flush();
    expect(ui.elements['gps-status'].textContent).toBe(ui.window.TOUR_TRANSLATIONS.en.gpsActive);
    expect(ui.elements['geofence-badge'].textContent).toBe(ui.window.TOUR_TRANSLATIONS.en.gpsOutside);
    await choose(ui, 'ja');
    expect(ui.elements['gps-status'].textContent).toBe(ui.window.TOUR_TRANSLATIONS.ja.gpsActive);
    expect(ui.elements['geofence-badge'].textContent).toBe(ui.window.TOUR_TRANSLATIONS.ja.gpsOutside);
  });
});

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
    start(ui);
    expect(ui.geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(ui.elements['tour-status'].textContent).toContain('Đang bật');
    expect(ui.elements['toggle-tour'].getAttribute('aria-pressed')).toBe('true');
    expect(ui.elements['tour-button-label'].textContent).toBe('Dừng tham quan');
  });

  it('form giả lập dùng tọa độ nhập và dừng watcher thật trước khi kiểm tra', async () => {
    const ui = await setup();
    start(ui);
    await simulate(ui, outside);
    expect(ui.geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(ui.geolocation.clearWatch).toHaveBeenCalledWith(0);
    expect(ui.elements['current-source'].textContent).toBe('GPS giả lập');
  });

  it('outside -> inside chỉ play một lần và chỉ GET metadata, không POST TTS', async () => {
    const ui = await setup();
    start(ui);
    await simulate(ui, outside, '0', '0');
    expect(ui.audio.play).not.toHaveBeenCalled();
    await simulate(ui, inside());
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    expect(ui.audio.getAttribute('src')).toBe('blob:/audio/saved_poi-a_vi.wav');
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
    expect(ui.elements['generate-audio'].hidden).toBe(true);
    await ui.audio.play(); // Người dùng bấm native Play.
    await simulate(ui, inside());
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    expect(postCalls(ui)).toEqual([]);
  });

  it('dừng tham quan hủy watch ID 0 và audio, giả lập/manual vẫn dùng được', async () => {
    const ui = await setup();
    start(ui);
    ui.state.nearby = inside();
    ui.geolocation.watchPosition.mock.calls[0][0]({ coords: { latitude: 10, longitude: 106 } });
    await flush();
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    ui.elements['toggle-tour'].events.click();
    expect(ui.geolocation.clearWatch).toHaveBeenCalledWith(0);
    expect(ui.audio.getAttribute('src')).toBeNull();
    expect(html).not.toContain('id="tour-simulation"');
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
    start(ui);
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
    start(ui);
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
    start(ui);
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
    expect(ui.audio.getAttribute('src')).toBe('blob:/audio/opaque_server_filename.wav');
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
  });

  it('đổi language ở inside không query nearby/watch hoặc play; re-entry dùng language mới', async () => {
    const ui = await setup();
    start(ui);
    await simulate(ui, inside());
    await choose(ui, 'en');
    expect(ui.audio.getAttribute('src')).toBe('blob:/audio/saved_poi-a_en.wav');
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    expect(nearbyCalls(ui)).toHaveLength(1);
    expect(ui.geolocation.watchPosition).toHaveBeenCalledTimes(1);
    await simulate(ui, inside(), '10.00001');
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    await simulate(ui, outside, '0', '0');
    await simulate(ui, inside());
    expect(ui.audio.play).toHaveBeenCalledTimes(2);
    expect(narrationCalls(ui).at(-1)[0]).toBe('/api/pois/poi-a/narrations/en');
  });

  it('thiếu audioUrl giữ text, không tự POST hay retry mỗi GPS update', async () => {
    const ui = await setup();
    ui.state.narration = (id, code) => metadata(id, code, null);
    start(ui);
    await simulate(ui, inside());
    await simulate(ui, inside(), '10.00001');
    expect(ui.audio.play).not.toHaveBeenCalled();
    expect(ui.elements['auto-status'].textContent).toContain('chưa có audio');
    expect(ui.elements['narration-text'].hidden).toBe(false);
    expect(ui.elements['generate-audio'].hidden).toBe(true);
    expect(postCalls(ui)).toEqual([]);
    expect(narrationCalls(ui)).toHaveLength(1);
  });

  it('TTS dành cho Admin; Tourist không POST hoặc tạo auto entry', async () => {
    const ui = await setup();
    ui.state.narration = (id, code) => metadata(id, code, null);
    start(ui);
    await simulate(ui, inside());
    ui.state.narration = (id, code) => metadata(id, code);
    ui.elements['generate-audio'].events.click();
    await flush();
    expect(postCalls(ui)).toHaveLength(0);
    expect(ui.elements['generate-audio'].hidden).toBe(true);
    expect(ui.audio.hidden).toBe(true);
    expect(ui.audio.play).not.toHaveBeenCalled();
    await simulate(ui, inside());
    expect(ui.audio.play).not.toHaveBeenCalled();
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
    expect(ui.audio.getAttribute('src')).toBe('blob:/audio/saved_poi-b_vi.wav');
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
    expect(playback).toEqual(['pause:blob:/audio/saved_poi-a_vi.wav', 'play:blob:/audio/saved_poi-b_vi.wav']);
    expect(ui.audio.play).toHaveBeenCalledTimes(2);
  });

  it('nearest dao động giữa hai POI vẫn inside không tạo lần entry mới', async () => {
    const ui = await setup();
    start(ui);
    await simulate(ui, inside(a, [a, b]));
    await simulate(ui, inside(b, [b, a]), '10.00001');
    await simulate(ui, inside(a, [a, b]), '10.00002');
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    expect(ui.audio.getAttribute('src')).toBe('blob:/audio/saved_poi-a_vi.wav');
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
    expect(ui.elements['auto-status'].textContent).toBe(ui.window.TOUR_TRANSLATIONS.ja.autoNarrationMissing);
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
    if (action === 'switch') expect(ui.audio.getAttribute('src')).toBe('blob:/audio/saved_poi-b_vi.wav');
    if (action === 'language') expect(ui.audio.getAttribute('src')).toBe('blob:/audio/saved_poi-a_en.wav');
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
    expect(ui.audio.getAttribute('src')).toBe('blob:/audio/saved_poi-a_ko.wav');
    expect(ui.elements['audio-status'].textContent).toBe(ui.window.TOUR_TRANSLATIONS.ko.audioReadyPlay);
    expect(ui.elements['auto-status'].textContent).toBe(ui.window.TOUR_TRANSLATIONS.ko.autoPlayReady);
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
    start(ui);
    ui.state.nearby = () => pending.promise;
    ui.geolocation.watchPosition.mock.calls[0][0]({ coords: { latitude: 10, longitude: 106 } });
    await flush();
    await simulate(ui, inside(b), '11');
    pending.resolve(json(inside()));
    await flush();
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
    expect(ui.audio.getAttribute('src')).toBe('blob:/audio/saved_poi-b_vi.wav');
    expect(narrationCalls(ui).map(([url]) => url)).toEqual(['/api/pois/poi-b/narrations/vi']);
  });

  it('pagehide hủy watcher, metadata và auto pending', async () => {
    const ui = await setup();
    const pending = deferred();
    ui.state.narration = () => pending.promise;
    start(ui);
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
