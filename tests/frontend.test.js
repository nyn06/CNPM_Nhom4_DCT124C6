const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const languageScript = fs.readFileSync(path.join(__dirname, '../public/js/poi-languages.js'), 'utf8');
const translationScript = fs.readFileSync(path.join(__dirname, '../public/js/translations.js'), 'utf8');
const jsonResponse = (data) => ({ ok: true, json: async () => data });
const outside = { insideGeofence: false, nearestPoi: null, pois: [] };

// DOM tối thiểu để kiểm tra điều phối GPS/request; không mô phỏng CSS hay trình duyệt.
function createElement() {
  return {
    value: '', textContent: '', disabled: false, hidden: false,
    dataset: {}, attributes: {}, events: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] || null; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, listener) { this.events[name] = listener; },
    replaceChildren: jest.fn(), focus: jest.fn(), scrollIntoView: jest.fn(),
    play: jest.fn(), pause: jest.fn(), load: jest.fn(),
  };
}

async function setup(options = {}) {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)]
    .map((match) => [match[1], createElement()]));
  elements.language.value = 'vi';
  const geolocation = { watchPosition: jest.fn(() => 0), clearWatch: jest.fn() };
  const fetch = jest.fn().mockResolvedValue(jsonResponse([]));
  const localStorage = {
    getItem: jest.fn(() => options.language || null), setItem: jest.fn(),
  };
  if (options.blockStorage) {
    localStorage.getItem.mockImplementation(() => { throw new Error('Storage blocked'); });
    localStorage.setItem.mockImplementation(() => { throw new Error('Storage blocked'); });
  }
  const window = { isSecureContext: options.secure !== false, addEventListener: jest.fn() };
  window.TOUR_ACCESS = { active: () => true, headers: () => ({ Authorization: 'Bearer fixture' }), lose: jest.fn(), subscribe: (fn) => fn(true) };
  if (options.map) window.TOUR_MAP = options.map;
  const mediaFetch = (url, requestOptions) => url.startsWith('/audio/')
    ? Promise.resolve({ ok: true, blob: async () => ({ type: 'audio/wav', url }) })
    : url.startsWith('/api/geocode/reverse?') ? Promise.resolve(jsonResponse({})) : fetch(url, requestOptions);
  vm.runInNewContext(languageScript + '\n' + translationScript + '\n' + script, {
    document: { getElementById: (id) => elements[id], createElement, documentElement: {}, querySelectorAll: () => [] },
    window, navigator: { geolocation: options.unsupported ? undefined : geolocation },
    localStorage, fetch: mediaFetch, AbortController, URLSearchParams, URL: { createObjectURL: (blob) => `blob:${blob.url}`, revokeObjectURL: jest.fn() }, TypeError,
    Date, setTimeout, clearTimeout,
  });
  await jest.advanceTimersByTimeAsync(0);
  return { elements, geolocation, fetch, localStorage, window };
}

function submit(elements, lat, lng) {
  elements['demo-lat'].value = lat;
  elements['demo-lng'].value = lng;
  elements['simulation-form'].events.submit({ preventDefault: jest.fn() });
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('Frontend: GPS và request', () => {
  it('cập nhật khoảng cách và thứ tự theo GPS thật, giữ thứ tự gốc khi dừng', async () => {
    const { elements, fetch, geolocation } = await setup();
    const cards = [];
    elements['poi-template'].content = { firstElementChild: { cloneNode: () => {
      const parts = {};
      const card = { dataset: {}, querySelector: (selector) => (parts[selector] ||= createElement()), parts };
      cards.push(card);
      return card;
    } } };
    elements['poi-list'].append = jest.fn();
    fetch.mockResolvedValueOnce(jsonResponse([
      { id: 'far', name: 'Far', latitude: 0, longitude: 0.02, isActive: true },
      { id: 'near', name: 'Near', latitude: 0, longitude: 0.001, isActive: true },
      { id: 'missing', name: 'Missing', latitude: null, longitude: 0, isActive: true },
      { id: 'tie', name: 'Tie', latitude: 0, longitude: -0.001, isActive: true },
    ]));
    elements['reload-pois'].events.click();
    await jest.advanceTimersByTimeAsync(0);
    expect(cards[0].parts['.poi-distance-text'].textContent).toContain('Bật GPS');
    expect(cards[2].parts['.poi-use'].disabled).toBe(true);
    elements['start-gps'].events.click();
    const position = geolocation.watchPosition.mock.calls[0][0];
    position({ coords: { latitude: 0, longitude: 0 } });
    expect(cards[1].parts['.poi-distance-text'].textContent).toContain('111 m');
    expect(cards[0].parts['.poi-distance-text'].textContent).toContain('2,2 km');
    expect(cards[2].parts['.poi-distance-text'].textContent).toContain('Chưa xác định');
    expect(elements['poi-list'].append.mock.lastCall).toEqual([cards[1], cards[3], cards[0], cards[2]]);
    position({ coords: { latitude: 0, longitude: 0.02 } });
    expect(elements['poi-list'].append.mock.lastCall).toEqual([cards[0], cards[1], cards[3], cards[2]]);
    elements['stop-gps'].events.click();
    expect(elements['poi-list'].append.mock.lastCall).toEqual(cards);
    expect(cards[0].parts['.poi-distance-text'].textContent).toContain('Bật GPS');
  });

  it('GPS giả lập cập nhật danh sách qua luồng vị trí sẵn có', async () => {
    const { elements, fetch, geolocation } = await setup();
    const cards = [];
    elements['poi-template'].content = { firstElementChild: { cloneNode: () => {
      const parts = {};
      const card = { dataset: {}, querySelector: (selector) => (parts[selector] ||= createElement()), parts };
      cards.push(card);
      return card;
    } } };
    elements['poi-list'].append = jest.fn();
    fetch.mockResolvedValueOnce(jsonResponse([
      { id: 'a', name: 'A', latitude: 10, longitude: 106, isActive: true },
      { id: 'b', name: 'B', latitude: 11, longitude: 106, isActive: true },
    ]));
    elements['reload-pois'].events.click();
    await jest.advanceTimersByTimeAsync(0);
    submit(elements, '11', '106');
    await jest.advanceTimersByTimeAsync(0);
    expect(cards[1].parts['.poi-distance-text'].textContent).toContain('0 m');
    expect(elements['poi-list'].append.mock.lastCall).toEqual([cards[1], cards[0]]);
    submit(elements, '10', '106');
    expect(elements['poi-list'].append.mock.lastCall).toEqual([cards[0], cards[1]]);
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it('thẻ POI ưu tiên các phần địa chỉ Admin đã lưu', async () => {
    const { elements, fetch } = await setup();
    const parts = {};
    elements['poi-template'].content = { firstElementChild: { cloneNode: () => ({
      dataset: {}, querySelector: (selector) => (parts[selector] ||= createElement()),
    }) } };
    elements['poi-list'].append = jest.fn();
    fetch.mockResolvedValueOnce(jsonResponse([{ id: 'p1', name: 'POI', category: 'food',
      address: 'Địa chỉ cũ', streetAddress: '12 Đường A', ward: 'Phường B', city: 'Đà Nẵng',
      latitude: 10, longitude: 106, geofenceRadius: 50, isActive: true }]));
    elements['reload-pois'].events.click();
    await jest.advanceTimersByTimeAsync(0);
    expect(parts['.poi-address'].textContent).toBe('12 Đường A, Phường B, Đà Nẵng');
    expect(fetch.mock.calls.filter(([url]) => url.startsWith('/api/geocode/reverse?'))).toHaveLength(0);
  });

  it('chọn tọa độ POI chỉ điền form, GPS thật tiếp tục chạy đến khi gửi giả lập', async () => {
    const { elements, fetch, geolocation } = await setup();
    const parts = {};
    elements['poi-template'].content = { firstElementChild: { cloneNode: () => ({
      dataset: {}, querySelector: (selector) => (parts[selector] ||= createElement()),
    }) } };
    elements['poi-list'].append = jest.fn();
    elements['start-gps'].events.click();
    geolocation.watchPosition.mock.calls[0][0]({ coords: { latitude: 10, longitude: 106, accuracy: 8 } });
    await jest.advanceTimersByTimeAsync(0);
    fetch.mockResolvedValueOnce(jsonResponse([{ id: 'p1', name: 'POI', category: 'food',
      latitude: 11, longitude: 107, geofenceRadius: 50, isActive: true }]));
    elements['reload-pois'].events.click();
    await jest.advanceTimersByTimeAsync(0);
    parts['.poi-use'].events.click();
    expect(elements['demo-lat'].value).toBe('11');
    expect(elements['current-source'].textContent).toBe('GPS thật');
    expect(geolocation.clearWatch).not.toHaveBeenCalled();
    submit(elements, '11', '107');
    expect(geolocation.clearWatch).toHaveBeenCalledWith(0);
    expect(elements['current-source'].textContent).toBe('GPS giả lập');
  });

  it('chuyển danh sách POI và cả vị trí GPS giả lập sang bản đồ, không tạo watcher khác', async () => {
    const map = { init: jest.fn(), setPois: jest.fn(), setLocation: jest.fn(), setStatus: jest.fn(), destroy: jest.fn() };
    const { elements, geolocation, fetch } = await setup({ map });
    expect(map.init).toHaveBeenCalledTimes(1);
    elements['poi-list'].append = jest.fn();
    elements['poi-template'].content = { firstElementChild: {
      cloneNode: () => ({ dataset: {}, querySelector: () => createElement() }),
    } };
    fetch.mockResolvedValueOnce(jsonResponse([{ id: 'p1', name: 'POI', latitude: 10, longitude: 106,
      geofenceRadius: 50, isActive: true }]));
    elements['reload-pois'].events.click();
    await jest.advanceTimersByTimeAsync(0);
    expect(map.setPois).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'p1' })]);
    fetch.mockResolvedValueOnce(jsonResponse(outside));
    submit(elements, '10', '106');
    await jest.advanceTimersByTimeAsync(0);
    expect(map.setLocation).toHaveBeenLastCalledWith(expect.objectContaining({
      latitude: 10, longitude: 106, source: 'GPS giả lập',
    }));
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it('GPS thật dùng watcher hiện có để cập nhật bản đồ và dừng watcher như trước', async () => {
    const map = { init: jest.fn(), setPois: jest.fn(), setLocation: jest.fn(), setStatus: jest.fn(), destroy: jest.fn() };
    const { elements, geolocation } = await setup({ map });
    elements['start-gps'].events.click();
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);
    geolocation.watchPosition.mock.calls[0][0]({ coords: { latitude: 10, longitude: 106, accuracy: 20 } });
    expect(map.setLocation).toHaveBeenLastCalledWith(expect.objectContaining({
      latitude: 10, longitude: 106, accuracy: 20, source: 'GPS thật',
    }));
    elements['stop-gps'].events.click();
    expect(geolocation.clearWatch).toHaveBeenCalledWith(0);
  });

  it('lỗi tải POI xóa marker cũ và báo lỗi bản đồ', async () => {
    const map = { init: jest.fn(), setPois: jest.fn(), setLocation: jest.fn(), setStatus: jest.fn(), destroy: jest.fn() };
    const { elements, fetch } = await setup({ map });
    fetch.mockRejectedValueOnce(new TypeError('Network error'));
    elements['reload-pois'].events.click();
    await jest.advanceTimersByTimeAsync(0);
    expect(map.setPois).toHaveBeenLastCalledWith([]);
    expect(map.setStatus).toHaveBeenCalledWith(expect.stringContaining('Không tải được địa điểm'), 'error');
  });

  it('chỉ tải POI khi mở trang, chưa yêu cầu GPS', async () => {
    const { geolocation, fetch, elements } = await setup();

    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/pois');
    expect(elements['poi-message'].textContent).toContain('Chưa có POI');
  });

  it('khôi phục và lưu lựa chọn ngôn ngữ, không gọi Translation/TTS', async () => {
    const { elements, localStorage, fetch } = await setup({ language: 'en' });

    expect(elements.language.value).toBe('en');
    elements.language.value = 'ja';
    elements.language.events.change();
    expect(localStorage.setItem).toHaveBeenLastCalledWith('poi-demo-language', 'ja');
    expect(elements['language-note'].textContent).toContain('日本語');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('vẫn khởi động được khi localStorage bị chặn', async () => {
    const { elements } = await setup({ blockStorage: true });

    expect(elements['language-note'].textContent).toContain('Tiếng Việt');
    expect(elements['reload-pois'].disabled).toBe(false);
  });

  it('GPS giả lập sai không gọi nearby, giá trị 0 được gửi đến Backend', async () => {
    const { elements, fetch, geolocation } = await setup();
    submit(elements, '91', 'abc');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(elements['demo-lat'].attributes['aria-invalid']).toBe('true');
    expect(elements['simulation-message'].dataset.tone).toBe('error');

    fetch.mockResolvedValueOnce(jsonResponse(outside));
    submit(elements, '0', '0');
    await jest.advanceTimersByTimeAsync(0);
    expect(fetch.mock.calls[1][0]).toBe('/api/pois/nearby?lat=0&lng=0');
    expect(elements['geofence-panel'].dataset.state).toBe('outside');
    expect(elements['result-title'].textContent).toContain('Chưa có địa điểm');
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it('chỉ có một watcher, throttle 3 giây dùng tọa độ mới nhất, clearWatch cả ID 0', async () => {
    const { elements, fetch, geolocation } = await setup();
    fetch.mockResolvedValue(jsonResponse(outside));
    elements['start-gps'].events.click();
    elements['start-gps'].events.click();
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);
    const onPosition = geolocation.watchPosition.mock.calls[0][0];
    onPosition({ coords: { latitude: 10, longitude: 106, accuracy: 25 } });
    await jest.advanceTimersByTimeAsync(0);
    for (const latitude of [11, 12, 13]) {
      onPosition({ coords: { latitude, longitude: 106, accuracy: 20 } });
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(3000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2][0]).toBe('/api/pois/nearby?lat=13&lng=106');
    expect(elements['current-accuracy'].textContent).toBe('±20 m');

    onPosition({ coords: { latitude: 14, longitude: 106, accuracy: 20 } });
    elements['stop-gps'].events.click();
    onPosition({ coords: { latitude: 15, longitude: 106, accuracy: 20 } });
    await jest.advanceTimersByTimeAsync(3000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(geolocation.clearWatch).toHaveBeenCalledWith(0);
    expect(elements['gps-status'].textContent).toBe('GPS đã dừng');
  });

  it('chuyển sang giả lập dừng GPS, kết quả GPS cũ không ghi đè kết quả mới', async () => {
    const { elements, fetch, geolocation } = await setup();
    let finishOldRequest;
    fetch.mockReturnValueOnce(new Promise((resolve) => { finishOldRequest = resolve; }));
    elements['start-gps'].events.click();
    geolocation.watchPosition.mock.calls[0][0]({ coords: { latitude: 10, longitude: 106, accuracy: 25 } });

    const poi = { id: 'poi-demo', name: '<img src=x onerror=alert(1)>', distance: 0, geofenceRadius: 50, description: 'Demo' };
    fetch.mockResolvedValueOnce(jsonResponse({ insideGeofence: true, nearestPoi: poi, pois: [poi] }));
    fetch.mockResolvedValueOnce(jsonResponse({ poiId: poi.id, language: 'vi', text: 'Nội dung' }));
    submit(elements, '11', '107');
    await jest.advanceTimersByTimeAsync(0);
    finishOldRequest(jsonResponse(outside));
    await jest.advanceTimersByTimeAsync(3000);

    expect(geolocation.clearWatch).toHaveBeenCalledWith(0);
    expect(elements['current-source'].textContent).toBe('GPS giả lập');
    expect(elements['geofence-panel'].dataset.state).toBe('inside');
    expect(elements['nearest-name'].textContent).toBe(`Đã đến ${poi.name}`);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[3][0]).toBe('/api/pois/poi-demo/narrations/vi');
  });

  it.each([[1, 'GPS bị từ chối'], [2, 'GPS không khả dụng'], [3, 'GPS lỗi']])(
    'xử lý lỗi GPS mã %s và cho phép thử lại', async (code, status) => {
      const { elements, geolocation } = await setup();
      elements['start-gps'].events.click();
      geolocation.watchPosition.mock.calls[0][1]({ code });

      expect(elements['gps-status'].textContent).toBe(status);
      expect(elements['start-gps'].disabled).toBe(false);
      expect(geolocation.clearWatch).toHaveBeenCalledWith(0);
    }
  );

  it.each([{ unsupported: true }, { secure: false }])('GPS không khả dụng: %j', async (options) => {
    const { elements, geolocation } = await setup(options);
    elements['start-gps'].events.click();

    expect(elements['gps-status'].textContent).toBe('GPS không khả dụng');
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it('hiển thị lỗi kết nối và mở lại nút kiểm tra', async () => {
    const { elements, fetch } = await setup();
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    submit(elements, '10', '106');
    await jest.advanceTimersByTimeAsync(0);

    expect(elements['geofence-panel'].dataset.state).toBe('error');
    expect(elements['result-message'].textContent).toContain('Không kết nối được Backend');
    expect(elements['check-simulation'].disabled).toBe(false);
  });

  it('hủy request quá 10 giây để giao diện không treo loading', async () => {
    const { elements, fetch } = await setup();
    fetch.mockImplementationOnce((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));
    submit(elements, '10', '106');
    await jest.advanceTimersByTimeAsync(10000);

    expect(elements['result-message'].textContent).toContain('quá thời gian chờ');
    expect(elements['check-simulation'].disabled).toBe(false);
  });
});

describe('Frontend Stage 5: nghe audio thủ công', () => {
  const poi = { id: 'audio-poi', name: 'Phở Việt Nam', distance: 0, geofenceRadius: 50, updatedAt: 'v1' };
  const inside = { insideGeofence: true, nearestPoi: poi, pois: [poi] };
  const content = (language, audioUrl) => jsonResponse({ poiId: poi.id, language, text: `Text ${language}`, ...(audioUrl ? { audioUrl } : {}) });
  const choose = (elements, language) => {
    elements.language.value = language;
    elements.language.events.change();
  };
  async function arrive(audioUrl) {
    const ui = await setup();
    ui.fetch.mockResolvedValueOnce(jsonResponse(inside));
    ui.fetch.mockResolvedValueOnce(content('vi', audioUrl));
    submit(ui.elements, '10', '106');
    await jest.advanceTimersByTimeAsync(0);
    return ui;
  }

  it('controls có preload none, không autoplay; đến POI có audio không tự play hoặc POST TTS', async () => {
    expect(html).toMatch(/<audio[^>]*controls[^>]*preload="none"/);
    expect(html).not.toMatch(/<audio[^>]*autoplay/);
    const { elements, fetch } = await arrive('/audio/narration_vi.wav');
    expect(elements['narration-audio'].hidden).toBe(false);
    expect(elements['narration-audio'].attributes.src).toBe('blob:/audio/narration_vi.wav');
    expect(elements['narration-audio'].play).not.toHaveBeenCalled();
    expect(elements['audio-status'].textContent).toContain('Bấm Play');
    expect(fetch.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
  });

  it('đổi language dừng audio cũ và chọn đúng URL của language mới', async () => {
    const { elements, fetch } = await arrive('/audio/narration_vi.wav');
    const pauseCount = elements['narration-audio'].pause.mock.calls.length;
    fetch.mockResolvedValueOnce(content('ja', '/audio/narration_ja.wav'));
    choose(elements, 'ja');
    expect(elements['narration-audio'].hidden).toBe(true);
    expect(elements['narration-audio'].getAttribute('src')).toBeNull();
    await jest.advanceTimersByTimeAsync(0);
    expect(elements['narration-audio'].attributes.src).toBe('blob:/audio/narration_ja.wav');
    expect(elements['audio-title'].textContent).toContain('日本語');
    expect(elements['narration-audio'].pause.mock.calls.length).toBeGreaterThan(pauseCount);
    expect(elements['narration-audio'].play).not.toHaveBeenCalled();
    expect(fetch.mock.calls.filter(([url]) => url.includes('/nearby'))).toHaveLength(1);
  });

  it('chưa có audio giữ text, hướng dẫn Admin và không giữ src của language cũ', async () => {
    const { elements, fetch } = await arrive('/audio/narration_vi.wav');
    fetch.mockResolvedValueOnce(content('ko'));
    choose(elements, 'ko');
    await jest.advanceTimersByTimeAsync(0);
    expect(elements['narration-text'].textContent).toBe('Text ko');
    expect(elements['narration-audio'].hidden).toBe(true);
    expect(elements['narration-audio'].getAttribute('src')).toBeNull();
    expect(elements['generate-audio'].hidden).toBe(true);
    expect(elements['audio-status'].textContent).toContain('오디오가 없습니다');
  });

  it('thiếu narration không cho tạo audio', async () => {
    const { elements, fetch } = await arrive();
    fetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: 'Missing' }) });
    choose(elements, 'en');
    await jest.advanceTimersByTimeAsync(0);
    expect(elements['generate-audio'].hidden).toBe(true);
    expect(elements['narration-audio'].hidden).toBe(true);
    expect(elements['audio-status'].textContent).toContain('no narration');
  });

  it.each(['https://evil.test/file.wav', '//evil.test/file.wav', '/audio/../outside.wav', '/audio/file.wav?secret=key', '/audio/nested/file.wav'])(
    'từ chối URL ngoài/path traversal %s', async (audioUrl) => {
      const { elements } = await arrive(audioUrl);
      expect(elements['narration-audio'].hidden).toBe(true);
      expect(elements['narration-audio'].getAttribute('src')).toBeNull();
      expect(elements['audio-status'].textContent).toContain('không hợp lệ');
      expect(elements['narration-text'].textContent).toBe('Text vi');
    }
  );

  it('Tourist không gọi endpoint tạo TTS, kể cả kích hoạt control bằng script', async () => {
    const { elements, fetch } = await arrive();
    elements['generate-audio'].events.click();
    elements['generate-audio'].events.click();
    expect(elements['generate-audio'].hidden).toBe(true);
    expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
    expect(elements['audio-status'].textContent).toContain('Admin demo local');
    expect(elements['narration-audio'].play).not.toHaveBeenCalled();
  });

  it('Tourist giữ nội dung khi yêu cầu chuẩn bị audio tại Admin', async () => {
    const { elements, fetch } = await arrive();
    fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'Không tạo được audio' }) });
    elements['generate-audio'].events.click();
    await jest.advanceTimersByTimeAsync(0);
    expect(elements['audio-status'].textContent).toContain('Admin demo local');
    expect(elements['narration-text'].textContent).toBe('Text vi');
    expect(elements['generate-audio'].disabled).toBe(false);
    expect(elements['narration-audio'].play).not.toHaveBeenCalled();
  });

  it('đổi language sau hướng dẫn tạo audio dùng metadata mới, không POST', async () => {
    const { elements, fetch } = await arrive();
    elements['generate-audio'].events.click();
    fetch.mockResolvedValueOnce(content('en', '/audio/narration_en.wav'));
    choose(elements, 'en');
    await jest.advanceTimersByTimeAsync(0);
    expect(elements['narration-audio'].attributes.src).toBe('blob:/audio/narration_en.wav');
    expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/narrations/vi'))).toHaveLength(1);
    expect(elements['generate-audio'].disabled).toBe(false);
  });

  it('rời geofence dừng và gỡ audio hiện có', async () => {
    const { elements, fetch } = await arrive('/audio/narration_vi.wav');
    const pauses = elements['narration-audio'].pause.mock.calls.length;
    fetch.mockResolvedValueOnce(jsonResponse(outside));
    submit(elements, '20', '106');
    await jest.advanceTimersByTimeAsync(0);
    expect(elements['narration-audio'].hidden).toBe(true);
    expect(elements['narration-audio'].getAttribute('src')).toBeNull();
    expect(elements['narration-audio'].pause.mock.calls.length).toBeGreaterThan(pauses);
    expect(elements['generate-audio'].hidden).toBe(true);
  });

  it('cùng tọa độ và POI ở callback tiếp theo không tự tạo/khởi động lại audio', async () => {
    const { elements, fetch } = await arrive('/audio/narration_vi.wav');
    const pauses = elements['narration-audio'].pause.mock.calls.length;
    fetch.mockResolvedValueOnce(jsonResponse(inside));
    submit(elements, '10', '106');
    await jest.advanceTimersByTimeAsync(0);
    expect(elements['narration-audio'].pause.mock.calls.length).toBe(pauses);
    expect(elements['narration-audio'].play).not.toHaveBeenCalled();
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/narrations/vi'))).toHaveLength(1);
    expect(fetch.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
  });

  it('lỗi tải WAV thông báo rõ, không tự gọi TTS', async () => {
    const { elements, fetch } = await arrive('/audio/narration_vi.wav');
    const calls = fetch.mock.calls.length;
    elements['narration-audio'].events.error();
    expect(elements['audio-status'].textContent).toContain('Không tải được âm thanh');
    expect(fetch).toHaveBeenCalledTimes(calls);
  });
});

describe('Frontend: narration theo ngôn ngữ', () => {
  const poi = { id: 'food-1', name: 'Phở Việt Nam', distance: 0, geofenceRadius: 50, updatedAt: 'v1' };
  const inside = { insideGeofence: true, nearestPoi: poi, pois: [poi] };
  const narration = (language, text) => jsonResponse({ poiId: poi.id, language, text });

  async function arrive(options) {
    const ui = await setup(options);
    ui.fetch.mockResolvedValueOnce(jsonResponse(inside));
    ui.fetch.mockResolvedValueOnce(narration(options?.language || 'vi', 'Nội dung đã lưu'));
    submit(ui.elements, '10', '106');
    await jest.advanceTimersByTimeAsync(0);
    return ui;
  }

  it('đến POI tải VI; đổi EN/JA/KO chỉ GET narration, không gọi lại GPS/geofence', async () => {
    const { elements, fetch, geolocation } = await arrive();
    expect(fetch.mock.calls[2][0]).toBe('/api/pois/food-1/narrations/vi');
    expect(elements['narration-text'].textContent).toBe('Nội dung đã lưu');
    expect(elements['narration-text'].hidden).toBe(false);
    for (const [language, name] of [['en', 'English'], ['ja', '日本語'], ['ko', '한국어']]) {
      fetch.mockResolvedValueOnce(narration(language, `Fixture ${language}`));
      elements.language.value = language;
      elements.language.events.change();
      expect(elements['narration-text'].hidden).toBe(true);
      await jest.advanceTimersByTimeAsync(0);
      expect(fetch.mock.calls.at(-1)[0]).toBe(`/api/pois/food-1/narrations/${language}`);
      const titles = { en: 'Narration', ja: 'ガイド', ko: '해설' };
      expect(elements['narration-title'].textContent).toBe(`${titles[language]} – ${name}`);
      expect(elements['narration-text'].textContent).toBe(`Fixture ${language}`);
      expect(elements['narration-text'].attributes.lang).toBe(language);
    }
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(fetch.mock.calls.filter(([url]) => url.includes('/nearby'))).toHaveLength(1);
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    expect(fetch.mock.calls.every(([url]) => url.startsWith('/api/pois'))).toBe(true);
  });

  it('ngôn ngữ đã lưu được dùng ngay khi đến POI', async () => {
    const { fetch, elements } = await arrive({ language: 'ja' });
    expect(fetch.mock.calls[2][0]).toBe('/api/pois/food-1/narrations/ja');
    expect(elements['narration-title'].textContent).toContain('日本語');
  });

  it('404 không fallback VI hoặc giữ nội dung cũ; có thể thử tải lại', async () => {
    const { elements, fetch } = await arrive();
    fetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) });
    elements.language.value = 'ja';
    elements.language.events.change();
    await jest.advanceTimersByTimeAsync(0);
    expect(elements['narration-status'].textContent).toBe('この言語の音声ガイドはありません。');
    expect(elements['narration-text'].hidden).toBe(true);
    expect(elements['narration-text'].textContent).toBe('');
    expect(elements['retry-narration'].hidden).toBe(false);
    fetch.mockResolvedValueOnce(narration('ja', '新しい内容'));
    elements['retry-narration'].events.click();
    await jest.advanceTimersByTimeAsync(0);
    expect(elements['narration-text'].textContent).toBe('新しい内容');
    expect(elements['narration-text'].hidden).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('phản hồi EN đến muộn không ghi đè JA vừa chọn', async () => {
    const { elements, fetch } = await arrive();
    let finishEnglish;
    fetch.mockReturnValueOnce(new Promise((resolve) => { finishEnglish = resolve; }));
    elements.language.value = 'en';
    elements.language.events.change();
    const oldSignal = fetch.mock.calls.at(-1)[1].signal;
    fetch.mockResolvedValueOnce(narration('ja', '日本語'));
    elements.language.value = 'ja';
    elements.language.events.change();
    await jest.advanceTimersByTimeAsync(0);
    expect(oldSignal.aborted).toBe(true);
    finishEnglish(narration('en', 'Old English'));
    await jest.advanceTimersByTimeAsync(0);
    expect(elements['narration-text'].textContent).toBe('日本語');
    expect(elements['narration-title'].textContent).toContain('日本語');
    expect(elements['narration-panel'].attributes['aria-busy']).toBe('false');
  });

  it('rời POI xóa text và bỏ qua narration đang tải của vị trí cũ', async () => {
    const { elements, fetch } = await arrive();
    let finishOld;
    fetch.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }));
    elements.language.value = 'en';
    elements.language.events.change();
    fetch.mockResolvedValueOnce(jsonResponse(outside));
    submit(elements, '20', '106');
    await jest.advanceTimersByTimeAsync(0);
    finishOld(narration('en', 'Old location'));
    await jest.advanceTimersByTimeAsync(0);
    expect(elements['narration-text'].hidden).toBe(true);
    expect(elements['narration-text'].textContent).toBe('');
    expect(elements['geofence-panel'].dataset.state).toBe('outside');
    elements.language.value = 'ko';
    elements.language.events.change();
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('dừng GPS hủy narration đang tải và không tiếp tục tải khi đổi language', async () => {
    const { elements, fetch, geolocation } = await setup();
    fetch.mockResolvedValueOnce(jsonResponse(inside));
    let finish;
    fetch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    elements['start-gps'].events.click();
    geolocation.watchPosition.mock.calls[0][0]({ coords: { latitude: 10, longitude: 106, accuracy: 10 } });
    await jest.advanceTimersByTimeAsync(0);
    const signal = fetch.mock.calls.at(-1)[1].signal;
    elements['stop-gps'].events.click();
    finish(narration('vi', 'Late text'));
    await jest.advanceTimersByTimeAsync(0);
    expect(signal.aborted).toBe(true);
    expect(elements['narration-text'].hidden).toBe(true);
    elements.language.value = 'en';
    elements.language.events.change();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('kết nối lỗi có thể thử lại; text từ API dùng textContent', async () => {
    const { elements, fetch } = await arrive();
    fetch.mockRejectedValueOnce(new TypeError('Network failed'));
    elements.language.value = 'en';
    elements.language.events.change();
    await jest.advanceTimersByTimeAsync(0);
    expect(elements['narration-status'].textContent).toContain('Could not connect to the backend');
    expect(elements['narration-panel'].attributes['aria-busy']).toBe('false');
    const text = '<img src=x onerror=alert(1)>\nText';
    fetch.mockResolvedValueOnce(narration('en', text));
    elements['retry-narration'].events.click();
    await jest.advanceTimersByTimeAsync(0);
    expect(elements['narration-text'].textContent).toBe(text);
    expect(elements['narration-text'].innerHTML).toBeUndefined();
  });

  it.each([
    { poiId: 'wrong', language: 'en', text: 'Text' },
    { poiId: 'food-1', language: 'vi', text: 'Wrong language' },
    { poiId: 'food-1', language: 'en', text: ' ' },
  ])('không hiển thị response sai POI/language/text: %j', async (response) => {
    const { elements, fetch } = await arrive();
    fetch.mockResolvedValueOnce(jsonResponse(response));
    elements.language.value = 'en';
    elements.language.events.change();
    await jest.advanceTimersByTimeAsync(0);
    expect(elements['narration-text'].hidden).toBe(true);
    expect(elements['narration-status'].textContent).toContain('invalid');
  });
});
