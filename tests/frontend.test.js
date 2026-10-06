const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const languageScript = fs.readFileSync(path.join(__dirname, '../public/js/poi-languages.js'), 'utf8');
const jsonResponse = (data) => ({ ok: true, json: async () => data });
const outside = { insideGeofence: false, nearestPoi: null, pois: [] };

// DOM tối thiểu để kiểm tra điều phối GPS/request; không mô phỏng CSS hay trình duyệt.
function createElement() {
  return {
    value: '', textContent: '', disabled: false, hidden: false,
    dataset: {}, attributes: {}, events: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, listener) { this.events[name] = listener; },
    replaceChildren: jest.fn(), focus: jest.fn(), scrollIntoView: jest.fn(),
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
  vm.runInNewContext(languageScript + '\n' + script, {
    document: { getElementById: (id) => elements[id], createElement },
    window, navigator: { geolocation: options.unsupported ? undefined : geolocation },
    localStorage, fetch, AbortController, URLSearchParams, TypeError,
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
      expect(elements['narration-title'].textContent).toBe(`Thuyết minh – ${name}`);
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
    expect(elements['narration-status'].textContent).toBe('Chưa có nội dung thuyết minh cho ngôn ngữ này.');
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
    expect(elements['narration-status'].textContent).toContain('Không kết nối được Backend');
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
    expect(elements['narration-status'].textContent).toContain('không hợp lệ');
  });
});
