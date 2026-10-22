const fs = require('fs');
const path = require('path');
const vm = require('vm');

const script = fs.readFileSync(path.join(__dirname, '../public/js/map.js'), 'utf8');
const translations = fs.readFileSync(path.join(__dirname, '../public/js/translations.js'), 'utf8');

function setup() {
  const elements = {};
  const element = () => ({
    textContent: '', dataset: {}, disabled: true, children: [], events: {},
    append(child) { this.children.push(child); },
    addEventListener(name, listener) { this.events[name] = listener; },
  });
  for (const id of ['poi-map', 'map-status', 'map-recenter', 'language']) elements[id] = element();
  elements.language.value = 'vi';
  const layers = { markers: [], circles: [], user: [], tiles: [] };
  const group = () => ({
    children: [], addTo: jest.fn().mockReturnThis(),
    addLayer(layer) { this.children.push(layer); },
    clearLayers() { this.children = []; },
  });
  const layer = (kind, point, options) => {
    const item = {
      kind, point, options,
      addTo(parent) { parent.addLayer?.(this); return this; },
      bindPopup(value) { this.popup = value; return this; },
      setPopupContent(value) { this.popup = value; return this; },
      setLatLng(value) { this.point = value; return this; },
      setStyle(value) { this.options = { ...this.options, ...value }; return this; },
      setRadius(value) { this.options.radius = value; return this; },
    };
    return item;
  };
  const map = {
    setView: jest.fn().mockReturnThis(), fitBounds: jest.fn().mockReturnThis(),
    getZoom: () => 12, removeLayer: jest.fn(), remove: jest.fn(),
    distance: jest.fn(() => 42),
  };
  const L = {
    map: jest.fn(() => map), layerGroup: jest.fn(group),
    marker: jest.fn((point) => { const item = layer('marker', point); layers.markers.push(item); return item; }),
    circle: jest.fn((point, options) => { const item = layer('circle', point, options); layers.circles.push(item); return item; }),
    circleMarker: jest.fn((point, options) => { const item = layer('user', point, options); layers.user.push(item); return item; }),
    latLngBounds: jest.fn(() => ({ pad: jest.fn(() => 'bounds') })),
    tileLayer: jest.fn((url, options) => {
      const tile = layer('tiles');
      tile.events = {};
      tile.on = (event, callback) => { tile.events[event] = callback; return tile; };
      layers.tiles.push({ url, options, tile });
      return tile;
    }),
  };
  const window = { L };
  vm.runInNewContext(translations + '\n' + script, {
    window,
    document: { getElementById: (id) => elements[id], createElement: element },
  });
  return { api: window.TOUR_MAP, elements, layers, map, L };
}

const poi = { id: 'p1', name: '<Bến Thành>', description: 'Ẩm thực', latitude: 10, longitude: 106,
  geofenceRadius: 75, isActive: true, narrations: { vi: { text: 'protected' } } };

it('khởi tạo một bản đồ, tile OSM và attribution; không yêu cầu GPS', () => {
  const ui = setup();
  expect(ui.api.init()).toBe(true);
  expect(ui.api.init()).toBe(true);
  expect(ui.L.map).toHaveBeenCalledTimes(1);
  expect(ui.layers.tiles[0].url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  expect(ui.layers.tiles[0].options.attribution).toContain('OpenStreetMap contributors');
  expect(ui.elements['map-recenter'].disabled).toBe(true);
});

it('đổi ngôn ngữ cập nhật trạng thái và popup trên cùng bản đồ', () => {
  const ui = setup();
  ui.api.init();
  ui.api.setPois([poi]);
  ui.api.setLocation({ latitude: 10, longitude: 106, source: 'GPS thật' });
  ui.elements.language.value = 'en';
  ui.api.refreshLanguage();
  expect(ui.elements['map-status'].textContent).toContain('ready');
  expect(ui.layers.user[0].popup).toBe('Actual GPS location');
  expect(ui.layers.markers[0].popup.children.at(-1).textContent).toContain('About 42 m');
  expect(ui.L.map).toHaveBeenCalledTimes(1);
});

it('chỉ vẽ POI hoạt động, marker và vòng tròn theo bán kính; popup không chứa nội dung bảo vệ', () => {
  const ui = setup();
  ui.api.init();
  ui.api.setPois([poi, { ...poi, id: 'p2', isActive: false }, { ...poi, id: 'p3', latitude: 100 }]);
  expect(ui.layers.markers).toHaveLength(1);
  expect(ui.layers.circles).toHaveLength(1);
  expect(ui.layers.circles[0].options.radius).toBe(75);
  expect(ui.layers.markers[0].popup.children[0].textContent).toBe('<Bến Thành>');
  expect(JSON.stringify(ui.layers.markers[0].popup)).not.toContain('protected');
  ui.api.setPois([]);
  expect(ui.elements['map-status'].textContent).toContain('Chưa có địa điểm');
});

it('cập nhật GPS thật và giả lập trên cùng marker, bỏ vòng chính xác khi giả lập', () => {
  const ui = setup();
  ui.api.init();
  ui.api.setPois([poi]);
  ui.api.setLocation({ latitude: 10, longitude: 106, accuracy: 25, source: 'GPS thật' });
  expect(ui.layers.user).toHaveLength(1);
  expect(ui.layers.circles.at(-1).options.radius).toBe(25);
  expect(ui.elements['map-recenter'].disabled).toBe(false);
  expect(ui.layers.markers[0].popup.children.at(-1).textContent).toContain('42 m');
  ui.api.setLocation({ latitude: 11, longitude: 107, accuracy: 10, source: 'GPS thật' });
  expect(ui.layers.user).toHaveLength(1);
  expect(ui.layers.user[0].point).toEqual([11, 107]);
  ui.api.setLocation({ latitude: 12, longitude: 108, source: 'GPS giả lập' });
  expect(ui.layers.user).toHaveLength(1);
  expect(ui.layers.user[0].popup).toContain('giả lập');
  expect(ui.map.removeLayer).toHaveBeenCalledTimes(1);
  ui.elements['map-recenter'].events.click();
  expect(ui.map.setView).toHaveBeenLastCalledWith([12, 108], 15);
});

it('xóa marker giả lập trước khi chờ GPS thật mà vẫn giữ POI trên bản đồ', () => {
  const ui = setup();
  ui.api.init();
  ui.api.setPois([poi]);
  ui.api.setLocation({ latitude: 11, longitude: 107, source: 'GPS giả lập' });
  ui.api.clearLocation();
  expect(ui.map.removeLayer).toHaveBeenCalledWith(ui.layers.user[0]);
  expect(ui.elements['map-recenter'].disabled).toBe(true);
  expect(ui.layers.markers).toHaveLength(1);
  ui.api.setLocation({ latitude: 10, longitude: 106, accuracy: 12, source: 'GPS thật' });
  expect(ui.layers.user).toHaveLength(2);
  expect(ui.layers.user[1].point).toEqual([10, 106]);
});

it('lỗi toàn bộ tile có cảnh báo, tải lại thành công sẽ xóa cảnh báo', () => {
  const ui = setup();
  ui.api.init();
  ui.api.setPois([poi]);
  expect(ui.layers.markers[0].events).toBeUndefined();
  const events = ui.layers.tiles[0].tile.events;
  events.loading();
  events.tileerror();
  events.load();
  expect(ui.elements['map-status'].textContent).toContain('Không tải được nền bản đồ');
  events.loading();
  events.tileload();
  events.load();
  expect(ui.elements['map-status'].dataset.tone).not.toBe('error');
  ui.api.destroy();
  expect(ui.map.remove).toHaveBeenCalledTimes(1);
});

it('một tile lỗi nhưng tile khác thành công không báo hỏng toàn bộ nền', () => {
  const ui = setup();
  ui.api.init();
  const events = ui.layers.tiles[0].tile.events;
  events.loading();
  events.tileerror();
  events.tileload();
  events.load();
  expect(ui.elements['map-status'].dataset.tone).not.toBe('error');
});

it('thiếu Leaflet vẫn hiển thị thông báo và không chặn phần Tourist khác', () => {
  const ui = setup();
  delete ui.L.map;
  ui.api.destroy();
  ui.api.setPois([poi]);
  expect(ui.api.init()).toBe(false);
  expect(ui.elements['map-status'].dataset.tone).toBe('error');
});
