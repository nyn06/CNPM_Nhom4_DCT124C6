const fs = require('fs');
const path = require('path');
const vm = require('vm');

const script = fs.readFileSync(path.join(__dirname, '../public/js/admin-poi-map.js'), 'utf8');

function setup(results = [], leafletAvailable = true) {
  const elements = new Map();
  const element = () => ({ value: '', textContent: '', children: [], events: {}, attributes: {}, hidden: true,
    addEventListener(name, callback) { this.events[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    scrollIntoView() {},
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; } });
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  let mapClick;
  let dragEnd;
  let marker;
  const map = { getZoom: () => 6, setView: jest.fn().mockReturnThis(), invalidateSize: jest.fn(),
    on: (name, callback) => { if (name === 'click') mapClick = callback; }, remove: jest.fn() };
  const circle = { addTo: () => circle, remove: jest.fn() };
  const L = { map: jest.fn(() => map), tileLayer: () => ({ addTo: jest.fn() }), circle: jest.fn(() => circle), marker: jest.fn((coords) => {
    marker = { coords, addTo: () => marker, on: (name, callback) => { if (name === 'dragend') dragEnd = callback; },
      setLatLng: (next) => { marker.coords = next; }, getLatLng: () => ({ lat: marker.coords[0], lng: marker.coords[1] }), remove: jest.fn() };
    return marker;
  }) };
  const fetch = jest.fn(async () => ({ ok: true, json: async () => ({ results }) }));
  const window = { L: leafletAvailable ? L : undefined, ADMIN_AUTH: { headers: () => ({ 'X-CSRF-Token': 'test' }), handle: jest.fn() }, addEventListener: jest.fn() };
  vm.runInNewContext(script, { document: { getElementById, createElement: () => element() }, window, fetch,
    setTimeout: (fn, delay) => delay === 0 ? fn() : setTimeout(fn, delay), clearTimeout, AbortController });
  return { api: window.ADMIN_POI_MAP, getElementById, fetch, map, L,
    clickMap: (lat, lng) => mapClick({ latlng: { lat, lng } }),
    drag: (lat, lng) => { marker.coords = [lat, lng]; dragEnd(); } };
}

test('không có Leaflet vẫn mở được form và giữ tọa độ POI đã lưu', () => {
  const ui = setup([], false);
  expect(() => ui.api.load({ latitude: 10, longitude: 106 })).not.toThrow();
  expect(ui.api.location()).toEqual({ latitude: 10, longitude: 106 });
  expect(() => ui.api.clear()).not.toThrow();
  expect(() => ui.api.load(null)).not.toThrow();
  expect(ui.api.location()).toBeNull();
  expect(ui.getElementById('poi-location-status').textContent).toContain('Bản đồ chưa sẵn sàng');
});

test('POI cũ mở tại tọa độ đã lưu; kéo ghim cần xác nhận lại', () => {
  const ui = setup();
  ui.api.load({ latitude: 10, longitude: 106 });
  expect(ui.api.location()).toEqual({ latitude: 10, longitude: 106 });
  expect(ui.getElementById('poi-coordinates').textContent).toContain('Latitude: 10.000000');
  ui.drag(11, 107);
  expect(ui.api.location()).toBeNull();
  ui.getElementById('poi-confirm-location').events.click();
  expect(ui.api.location()).toEqual({ latitude: 11, longitude: 107 });
  expect(ui.getElementById('poi-coordinates').textContent).toContain('Đã xác nhận');
});

test('đổi địa chỉ làm vị trí cũ chờ xác nhận lại', () => {
  const ui = setup();
  ui.api.load({ latitude: 10, longitude: 106 });
  ui.getElementById('poi-street-address').events.input();
  expect(ui.api.location()).toBeNull();
});

test('POI mới có thể đặt ghim thủ công và chỉ lưu sau khi xác nhận', () => {
  const ui = setup();
  ui.api.load(null);
  expect(ui.api.location()).toBeNull();
  ui.clickMap(10, 106);
  expect(ui.api.location()).toBeNull();
  ui.getElementById('poi-confirm-location').events.click();
  expect(ui.api.location()).toEqual({ latitude: 10, longitude: 106 });
  expect(ui.fetch).not.toHaveBeenCalled();
});

test('tìm địa chỉ hiển thị các kết quả; chọn kết quả vẫn cần xác nhận', async () => {
  const ui = setup([{ label: 'Địa chỉ A', latitude: 10, longitude: 106 }, { label: 'Địa chỉ B', latitude: 11, longitude: 107 }]);
  ui.api.load(null);
  ui.getElementById('poi-street-address').value = 'Đường A';
  ui.getElementById('poi-ward').value = 'Phường B';
  ui.getElementById('poi-city').value = 'Thành phố C';
  await ui.getElementById('poi-search-address').events.click();
  expect(ui.fetch).toHaveBeenCalledTimes(1);
  expect(ui.getElementById('poi-search-results').children).toHaveLength(2);
  ui.getElementById('poi-search-results').children[1].events.click();
  expect(ui.api.location()).toBeNull();
  ui.getElementById('poi-confirm-location').events.click();
  expect(ui.api.location()).toEqual({ latitude: 11, longitude: 107 });
});

test('không có kết quả và lỗi mạng vẫn cho phép đặt ghim', async () => {
  const ui = setup();
  ui.api.load(null);
  for (const id of ['poi-street-address', 'poi-ward', 'poi-city']) ui.getElementById(id).value = id;
  await ui.getElementById('poi-search-address').events.click();
  expect(ui.getElementById('poi-location-status').textContent).toContain('Không có kết quả');
  ui.fetch.mockRejectedValueOnce(new Error('network down'));
  await ui.getElementById('poi-search-address').events.click();
  expect(ui.getElementById('poi-location-status').textContent).toContain('Không tải được kết quả');
  ui.clickMap(10, 106);
  ui.getElementById('poi-confirm-location').events.click();
  expect(ui.api.location()).toEqual({ latitude: 10, longitude: 106 });
});

test('autocomplete chỉ tìm sau 400 ms và không tìm khi quá ngắn', async () => {
  jest.useFakeTimers();
  try {
    const ui = setup();
    ui.api.load(null);
    const input = ui.getElementById('poi-street-address');
    input.value = '12';
    input.events.input();
    await jest.advanceTimersByTimeAsync(500);
    expect(ui.fetch).not.toHaveBeenCalled();
    input.value = '123 Đường thử';
    input.events.input();
    await jest.advanceTimersByTimeAsync(399);
    expect(ui.fetch).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(ui.fetch.mock.calls[0][0]).toBe('/api/admin/geocode/suggest');
  } finally { jest.useRealTimers(); }
});

test('gợi ý hỗ trợ bàn phím, Place di chuyển bản đồ, tạo marker và vòng bán kính', async () => {
  jest.useFakeTimers();
  try {
    const ui = setup();
    ui.api.load(null);
    ui.getElementById('poi-radius').value = '75';
    ui.fetch.mockImplementation(async (url) => ({ ok: true, json: async () => url.endsWith('/suggest')
      ? { results: [{ id: 'a', name: 'A', address: 'Phường A', display: 'A, Phường A' },
        { id: 'b', name: 'B', address: 'Phường B', display: 'B, Phường B' }] }
      : { latitude: 11, longitude: 107, streetAddress: 'B', ward: 'Phường B', city: 'Hồ Chí Minh' } }));
    const input = ui.getElementById('poi-street-address');
    input.value = '123 Đường thử';
    input.events.input();
    await jest.advanceTimersByTimeAsync(400);
    expect(ui.getElementById('poi-suggestions').children).toHaveLength(2);
    expect(input.attributes['aria-expanded']).toBe('true');
    input.events.keydown({ key: 'ArrowDown', preventDefault: jest.fn() });
    input.events.keydown({ key: 'ArrowDown', preventDefault: jest.fn() });
    expect(input.attributes['aria-activedescendant']).toBe('poi-suggestion-1');
    input.events.keydown({ key: 'Enter', preventDefault: jest.fn() });
    await jest.advanceTimersByTimeAsync(0);
    expect(ui.fetch.mock.calls[1][0]).toBe('/api/admin/geocode/place');
    expect(ui.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/admin/geocode/suggest', '/api/admin/geocode/place']);
    expect(ui.map.setView).toHaveBeenCalledWith([11, 107], 16);
    expect(ui.L.marker).toHaveBeenCalledWith([11, 107], { draggable: true });
    expect(ui.L.circle).toHaveBeenCalledWith([11, 107], expect.objectContaining({ radius: 75 }));
    expect(ui.getElementById('poi-ward').value).toBe('Phường B');
    expect(ui.api.location()).toBeNull();
    ui.getElementById('poi-confirm-location').events.click();
    expect(ui.api.location()).toEqual({ latitude: 11, longitude: 107 });
  } finally { jest.useRealTimers(); }
});

test('chọn 23 Mạc Đĩnh Chi giữ số nhà/đường, điền riêng phường và thành phố', async () => {
  jest.useFakeTimers();
  try {
    const ui = setup();
    ui.api.load(null);
    ui.fetch.mockImplementation(async (url) => ({ ok: true, json: async () => url.endsWith('/suggest')
      ? { results: [{ id: 'm', name: '23 Đường Mạc Đĩnh Chi',
        address: 'Phường Sài Gòn, Thành phố Hồ Chí Minh',
        display: '23 Đường Mạc Đĩnh Chi, Phường Sài Gòn, Thành phố Hồ Chí Minh' }] }
      : { latitude: 10.78, longitude: 106.7, streetAddress: 'Phường Sài Gòn, Thành phố Hồ Chí Minh',
        ward: 'Phường Sài Gòn', city: 'Thành phố Hồ Chí Minh' } }));
    const street = ui.getElementById('poi-street-address');
    street.value = '23 Mạc Đĩnh Chi';
    street.events.input();
    await jest.advanceTimersByTimeAsync(400);
    ui.getElementById('poi-suggestions').children[0].events.click();
    await jest.advanceTimersByTimeAsync(0);
    expect(street.value).toBe('23 Đường Mạc Đĩnh Chi');
    expect(ui.getElementById('poi-ward').value).toBe('Phường Sài Gòn');
    expect(ui.getElementById('poi-city').value).toBe('Thành phố Hồ Chí Minh');
    expect(ui.map.setView).toHaveBeenCalledWith([10.78, 106.7], 16);
    expect(ui.api.location()).toBeNull();
    ui.getElementById('poi-confirm-location').events.click();
    expect(ui.api.location()).toEqual({ latitude: 10.78, longitude: 106.7 });
  } finally { jest.useRealTimers(); }
});

test('khi Place thiếu địa chỉ đường, giữ nội dung đã nhập thay vì dùng địa giới', async () => {
  jest.useFakeTimers();
  try {
    const ui = setup();
    ui.api.load(null);
    ui.fetch.mockImplementation(async (url) => ({ ok: true, json: async () => url.endsWith('/suggest')
      ? { results: [{ id: 'm', name: 'Phường Sài Gòn', display: 'Phường Sài Gòn, Thành phố Hồ Chí Minh' }] }
      : { latitude: 10, longitude: 106, streetAddress: 'Phường Sài Gòn, Thành phố Hồ Chí Minh',
        ward: 'Phường Sài Gòn', city: 'Thành phố Hồ Chí Minh' } }));
    const street = ui.getElementById('poi-street-address');
    street.value = '23 Mạc Đĩnh Chi';
    street.events.input();
    await jest.advanceTimersByTimeAsync(400);
    ui.getElementById('poi-suggestions').children[0].events.click();
    await jest.advanceTimersByTimeAsync(0);
    expect(street.value).toBe('23 Mạc Đĩnh Chi');
  } finally { jest.useRealTimers(); }
});

test('kéo ghim cập nhật địa chỉ có căn cứ, bỏ qua reverse cũ và cần xác nhận lại', async () => {
  const ui = setup();
  ui.api.load({ latitude: 10, longitude: 106 });
  ui.getElementById('poi-street-address').value = '23 Đường cũ';
  let finishOld;
  ui.fetch.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ streetAddress: 'Đường mới',
      ward: 'Phường Mới', city: 'Thành phố Đà Nẵng' }) });
  ui.drag(11, 107);
  expect(ui.api.location()).toBeNull();
  ui.drag(12, 108);
  await new Promise((resolve) => setTimeout(resolve, 0));
  finishOld({ ok: true, json: async () => ({ streetAddress: '99 Đường cũ', ward: 'Phường Cũ' }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ui.getElementById('poi-street-address').value).toBe('Đường mới');
  expect(ui.getElementById('poi-ward').value).toBe('Phường Mới');
  expect(ui.getElementById('poi-city').value).toBe('Thành phố Đà Nẵng');
  ui.getElementById('poi-confirm-location').events.click();
  expect(ui.api.location()).toEqual({ latitude: 12, longitude: 108 });
});

test('gợi ý cũ đến muộn bị bỏ qua; Escape/Tab đóng listbox', async () => {
  jest.useFakeTimers();
  try {
    const ui = setup();
    ui.api.load(null);
    let finish;
    ui.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const input = ui.getElementById('poi-street-address');
    input.value = 'Đường cũ'; input.events.input();
    await jest.advanceTimersByTimeAsync(400);
    input.value = 'Đường mới'; input.events.input();
    await jest.advanceTimersByTimeAsync(400);
    finish({ ok: true, json: async () => ({ results: [{ id: 'old', display: 'Sai' }] }) });
    await Promise.resolve(); await Promise.resolve();
    expect(ui.getElementById('poi-suggestions').children).toHaveLength(0);
    input.events.keydown({ key: 'Escape', preventDefault: jest.fn() });
    expect(input.attributes['aria-expanded']).toBe('false');
    input.events.keydown({ key: 'Tab', preventDefault: jest.fn() });
    expect(input.attributes['aria-expanded']).toBe('false');
  } finally { jest.useRealTimers(); }
});

test('thiếu key báo rõ và vẫn đặt ghim thủ công', async () => {
  jest.useFakeTimers();
  try {
    const ui = setup();
    ui.api.load(null);
    ui.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'GEOCODE_NOT_CONFIGURED' }) });
    const input = ui.getElementById('poi-street-address');
    input.value = 'Đường thử'; input.events.input();
    await jest.advanceTimersByTimeAsync(400);
    expect(ui.getElementById('poi-suggestion-status').textContent).toContain('Chưa cấu hình VIETMAP');
    ui.clickMap(10, 106);
    ui.getElementById('poi-confirm-location').events.click();
    expect(ui.api.location()).toEqual({ latitude: 10, longitude: 106 });
  } finally { jest.useRealTimers(); }
});

test.each([
  ['GEOCODE_HTTP_504', 'phản hồi quá chậm'],
  ['GEOCODE_HTTP_503', 'VietMap tạm thời không khả dụng'],
  ['GEOCODE_NETWORK', 'Không kết nối'],
  ['GEOCODE_INVALID_RESPONSE', 'dữ liệu không hợp lệ'],
  ['GEOCODE_AUTH', 'chưa hợp lệ'],
])('gợi ý báo đúng nguyên nhân %s và vẫn cho đặt ghim', async (code, message) => {
  jest.useFakeTimers();
  try {
    const ui = setup();
    ui.api.load(null);
    ui.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ code }) });
    const input = ui.getElementById('poi-street-address');
    input.value = '40 Tú Xương'; input.events.input();
    await jest.advanceTimersByTimeAsync(400);
    expect(ui.getElementById('poi-suggestion-status').textContent).toContain(message);
    ui.clickMap(10, 106);
    ui.getElementById('poi-confirm-location').events.click();
    expect(ui.api.location()).toEqual({ latitude: 10, longitude: 106 });
  } finally { jest.useRealTimers(); }
});

test('timeout gợi ý không làm form treo', async () => {
  jest.useFakeTimers();
  try {
    const ui = setup();
    ui.api.load(null);
    ui.fetch.mockImplementation((url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })));
    }));
    const input = ui.getElementById('poi-street-address');
    input.value = 'Đường thử'; input.events.input();
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(15000);
    expect(ui.getElementById('poi-suggestion-status').textContent).toContain('phản hồi quá chậm');
    ui.clickMap(10, 106);
    ui.getElementById('poi-confirm-location').events.click();
    expect(ui.api.location()).toEqual({ latitude: 10, longitude: 106 });
  } finally { jest.useRealTimers(); }
});
