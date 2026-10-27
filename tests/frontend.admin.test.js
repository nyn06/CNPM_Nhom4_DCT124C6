const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
const scripts = ['poi-languages.js', 'admin.js'].map((file) => fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8')).join('\n');
const mapScript = fs.readFileSync(path.join(__dirname, '../public/js/admin-poi-map.js'), 'utf8');
const codes = ['vi', 'en', 'ja', 'ko'];
const texts = { vi: 'Phở Việt Nam.', en: 'English fixture.', ja: '日本語のテスト。', ko: '한국어 테스트.' };
const basePoi = { id: 'poi-a', name: 'Phở Việt Nam', description: 'Mô tả địa điểm', category: 'food', address: 'TP. Hồ Chí Minh', latitude: 10, longitude: 106, geofenceRadius: 50, isActive: true, createdAt: 'v1', updatedAt: 'v1' };
const copy = (value) => JSON.parse(JSON.stringify(value));
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: jest.fn(async () => copy(body)) });
const content = (audio = false) => Object.fromEntries(codes.map((code) => [code, { text: texts[code], ...(audio ? { audioFile: `server_${code}.wav` } : {}) }]));
const flush = () => jest.advanceTimersByTimeAsync(0);
const pending = () => {
  let resolve;
  const promise = new Promise((finish) => { resolve = finish; });
  return { promise, resolve };
};

// DOM nhỏ để test luồng quản lý; media/fetch được mock, không có provider thật.
function element() {
  return {
    value: '', checked: false, disabled: false, hidden: false, textContent: '', dataset: {}, attributes: {}, events: {}, children: [],
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] || null; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(event, callback) { this.events[event] = callback; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    focus: jest.fn(), pause: jest.fn(), play: jest.fn().mockResolvedValue(), load: jest.fn(),
  };
}
function template(selectors) {
  return { content: { firstElementChild: { cloneNode() {
    const node = element();
    node.parts = Object.fromEntries(selectors.map((selector) => [selector, element()]));
    node.querySelector = (selector) => node.parts[selector];
    return node;
  } } } };
}

async function setup({ pois = [{ ...basePoi, narrations: content() }] } = {}) {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], element()]));
  elements['poi-row-template'] = template(['.row-name', '.row-category', '.row-active', '.row-manage', '.row-delete']);
  elements['language-template'] = template(['.language-name', '.language-text', '.text-status', '.audio-status', '.listen-audio']);
  elements['poi-panel'].hidden = true;
  elements['content-panel'].hidden = true;
  const state = { pois: copy(pois), overrides: new Map(), audioVersion: 0 };
  const fetch = jest.fn(async (url, options) => {
    // Existing content tests exercise transport under an established session.
    url = url.replace('/api/admin/pois', '/api/pois');
    const key = `${options.method} ${url}`;
    if (state.overrides.has(key)) {
      const value = state.overrides.get(key);
      if (value instanceof Error) throw value;
      return typeof value === 'function' ? value(url, options) : value;
    }
    const body = options.body ? JSON.parse(options.body) : undefined;
    if (url === '/api/pois') {
      if (options.method === 'POST') {
        const poi = { ...copy(basePoi), ...body, id: 'created-poi', narrations: {} };
        state.pois.push(poi);
        return json(poi, 201);
      }
      return json(state.pois);
    }
    const match = url.match(/^\/api\/pois\/([^/]+)(.*)$/);
    const poi = state.pois.find((item) => item.id === decodeURIComponent(match?.[1]));
    if (!poi) return json({ error: 'Missing' }, 404);
    const suffix = match[2];
    if (!suffix) {
      if (options.method === 'DELETE') { state.pois = state.pois.filter((item) => item !== poi); return json(null, 204); }
      if (options.method === 'PUT') Object.assign(poi, body, { updatedAt: 'v2' });
      return json(poi);
    }
    if (suffix === '/narrations') return json({ poiId: poi.id, narrations: poi.narrations || {} });
    if (suffix === '/translations') {
      for (const code of body.targetLanguages) poi.narrations[code] = { text: `Translated ${code}` };
      return json({ poiId: poi.id, sourceLanguage: 'vi', translations: Object.fromEntries(body.targetLanguages.map((code) => [code, poi.narrations[code]])) });
    }
    const language = suffix.split('/')[2];
    if (options.method === 'PUT') {
      poi.narrations = poi.narrations?.vi?.text === body.text ? poi.narrations : {};
      poi.narrations.vi = { ...poi.narrations.vi, text: body.text };
      return json({ poiId: poi.id, language: 'vi', text: body.text });
    }
    const narration = poi.narrations?.[language];
    if (!narration) return json({ error: 'Missing text' }, 404);
    if (options.method === 'POST') narration.audioFile = `generated_${language}_${++state.audioVersion}.wav`;
    return json({ poiId: poi.id, language, text: narration.text, ...(narration.audioFile ? { audioFile: narration.audioFile, audioUrl: `/audio/${narration.audioFile}` } : {}) });
  });
  const mapState = { point: null };
  const window = { confirm: jest.fn(() => true), addEventListener: jest.fn(), ADMIN_POI_MAP: {
    clear: () => { mapState.point = null; },
    load: (poi) => { mapState.point = poi ? { latitude: poi.latitude, longitude: poi.longitude } : null; },
    location: () => mapState.point,
    confirm: (latitude, longitude) => { mapState.point = { latitude, longitude }; },
  } };
  window.ADMIN_AUTH = { ready: Promise.resolve({ id: 'admin', role: 'ADMIN' }), headers: () => ({ 'X-CSRF-Token': 'fixture' }), handle: jest.fn(), onLost: jest.fn() };
  vm.runInNewContext(scripts, { document: { getElementById: (id) => elements[id] }, window, fetch, AbortController, setTimeout, clearTimeout });
  await flush();
  const cards = Object.fromEntries(codes.map((code, index) => [code, elements['language-cards'].children[index].parts]));
  return { elements, state, fetch, window, cards, audio: elements['preview-audio'], map: window.ADMIN_POI_MAP };
}
const requests = (ui, method, url) => ui.fetch.mock.calls.filter(([actualUrl, options]) => options.method === method && (!url || actualUrl === url));
const click = (node) => node.events.click();
const submit = (node) => node.events.submit({ preventDefault: jest.fn() });
async function select(ui, index = 0) { click(ui.elements['poi-rows'].children[index].parts['.row-manage']); await flush(); }
function fill(ui, changes = {}) {
  const values = { name: 'Tên mới', description: 'Mô tả mới', category: 'cafe', 'street-address': '', ward: '', city: '', radius: '75', ...changes };
  for (const [field, value] of Object.entries(values)) ui.elements[`poi-${field}`].value = value;
  ui.elements['poi-active'].checked = false;
}
function editVi(ui, text) { ui.elements['vi-text'].value = text; ui.elements['vi-text'].events.input(); }

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

test('Admin HTML nạp bản đồ trước handler và có đầy đủ điều khiển POI', () => {
  const order = ['/js/admin-auth.js', '/leaflet/leaflet.js', '/js/admin-poi-map.js', '/js/admin.js'];
  expect(order.every((script) => html.includes(`src="${script}"`))).toBe(true);
  expect(order.map((script) => html.indexOf(`src="${script}"`))).toEqual([...order.map((script) => html.indexOf(`src="${script}"`))].sort((a, b) => a - b));
  for (const id of ['poi-legacy-address', 'poi-street-address', 'poi-ward', 'poi-city', 'poi-radius',
    'poi-active', 'poi-suggestions', 'poi-suggestion-status', 'poi-search-address',
    'poi-confirm-location', 'poi-search-results', 'poi-location-status', 'poi-admin-map']) {
    expect(html).toContain(`id="${id}"`);
  }
  expect(html).toContain('/leaflet/leaflet.css');
  expect(mapScript).toContain('window.ADMIN_POI_MAP =');
});

test('nút thêm địa điểm xuất hiện một lần, ngay trên danh sách', () => {
  expect(html.match(/id="new-poi"/g)).toHaveLength(1);
  expect(html.indexOf('class="admin-list-actions"')).toBeGreaterThan(html.indexOf('id="action-status"'));
  expect(html.indexOf('id="new-poi"')).toBeGreaterThan(html.indexOf('class="admin-list-actions"'));
  expect(html.indexOf('id="new-poi"')).toBeLessThan(html.indexOf('class="admin-workspace"'));
  expect(html).not.toContain('Nhập địa chỉ, đặt ghim và xác nhận vị trí của địa điểm mới.');
});

test('khung thông báo POI ẩn khi chưa có nội dung và hiện khi thao tác', async () => {
  expect(html).not.toContain('Chọn một địa điểm hoặc thêm địa điểm mới để bắt đầu.');
  expect(html).toMatch(/id="action-status"[^>]*hidden/);
  const ui = await setup();
  click(ui.elements['new-poi']);
  expect(ui.elements['action-status'].hidden).toBe(false);
  expect(ui.elements['action-status'].textContent).toContain('Đang thêm địa điểm');
});

test('một nút tạo audio đứng sau nút dịch; card chỉ còn nút nghe', () => {
  expect(html.match(/id="generate-all-audio"/g)).toHaveLength(1);
  expect(html.indexOf('id="save-vi"')).toBeLessThan(html.indexOf('id="translate"'));
  expect(html.indexOf('id="translate"')).toBeLessThan(html.indexOf('id="generate-all-audio"'));
  expect(html).not.toContain('class="generate-audio');
});

test('thông báo nội dung nằm sau hàng nút và trước các thẻ ngôn ngữ', () => {
  expect(html.indexOf('id="generate-all-audio"')).toBeLessThan(html.indexOf('id="content-action-notice"'));
  expect(html.indexOf('id="content-action-notice"')).toBeLessThan(html.indexOf('id="language-cards"'));
  expect(html).toMatch(/id="content-action-notice"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/);
});

test('lưu VI báo thành công tại chỗ, tự ẩn sau 5 giây và không báo ở đầu trang', async () => {
  const ui = await setup(); await select(ui);
  editVi(ui, 'Nội dung VI mới');
  submit(ui.elements['vi-form']);
  await flush();
  expect(ui.elements['content-action-text'].textContent).toBe('Đã lưu nội dung tiếng Việt thành công.');
  expect(ui.elements['content-action-notice'].hidden).toBe(false);
  expect(ui.elements['content-action-notice'].attributes.role).toBe('status');
  expect(ui.elements['action-status'].textContent).toBe('');
  await jest.advanceTimersByTimeAsync(4999);
  expect(ui.elements['content-action-notice'].hidden).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  expect(ui.elements['content-action-notice'].hidden).toBe(true);
});

test('dịch và audio chỉ báo thành công sau phản hồi backend đầy đủ', async () => {
  const ui = await setup(); await select(ui);
  click(ui.elements.translate); await flush();
  expect(ui.elements['content-action-text'].textContent).toBe('Đã dịch và tải nội dung EN/JA/KO thành công.');
  expect(ui.elements['action-status'].textContent).toBe('');
  click(ui.elements['generate-all-audio']); await flush();
  expect(ui.elements['content-action-text'].textContent).toBe('Đã tạo audio 4 ngôn ngữ thành công.');
  expect(ui.elements['action-status'].textContent).toBe('');
});

test('phản hồi dịch thiếu ngôn ngữ không báo thành công toàn bộ', async () => {
  const ui = await setup(); await select(ui);
  ui.state.overrides.set('POST /api/pois/poi-a/translations', json({ poiId: 'poi-a', translations: { en: { text: texts.en } } }));
  click(ui.elements.translate); await flush();
  expect(ui.elements['content-action-text'].textContent).toContain('1/3');
  expect(ui.elements['content-action-notice'].dataset.tone).toBe('error');
  expect(ui.elements['content-action-text'].textContent).not.toContain('thành công.');
});

test('lỗi lưu VI ở lại đến khi đóng; thao tác mới hủy timer cũ', async () => {
  const ui = await setup(); await select(ui);
  ui.state.overrides.set('PUT /api/pois/poi-a/narrations/vi', json({ error: 'SECRET' }, 500));
  editVi(ui, 'Nội dung VI mới');
  submit(ui.elements['vi-form']); await flush();
  expect(ui.elements['content-action-text'].textContent).toContain('Không thể lưu nội dung tiếng Việt. Vui lòng thử lại.');
  expect(ui.elements['content-action-notice'].attributes.role).toBe('alert');
  expect(ui.elements['dismiss-content-action'].hidden).toBe(false);
  await jest.advanceTimersByTimeAsync(5001);
  expect(ui.elements['content-action-notice'].hidden).toBe(false);
  click(ui.elements['dismiss-content-action']);
  expect(ui.elements['content-action-notice'].hidden).toBe(true);
  ui.state.overrides.delete('PUT /api/pois/poi-a/narrations/vi');
  submit(ui.elements['vi-form']); await flush();
  await jest.advanceTimersByTimeAsync(3000);
  click(ui.elements.translate); await flush();
  await jest.advanceTimersByTimeAsync(2001);
  expect(ui.elements['content-action-text'].textContent).toBe('Đã dịch và tải nội dung EN/JA/KO thành công.');
  expect(ui.elements['content-action-notice'].hidden).toBe(false);
});

describe('Stage 7: danh sách và CRUD POI', () => {
  it('load danh sách API, render tên/loại/trạng thái, chưa gọi narration/TTS', async () => {
    const ui = await setup({ pois: [basePoi, { ...basePoi, id: 'poi-b', name: 'Điểm B', isActive: false }] });
    expect(ui.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/admin/pois']);
    const rows = ui.elements['poi-rows'].children;
    expect(rows).toHaveLength(2);
    expect(rows[0].parts['.row-name'].textContent).toBe(basePoi.name);
    expect(rows[0].parts['.row-category'].textContent).toBe('food');
    expect(rows[1].parts['.row-active'].textContent).toBe('Tạm dừng');
    expect(ui.elements['poi-count'].textContent).toContain('2 địa điểm');
    expect(ui.audio.play).not.toHaveBeenCalled();
  });

  it('danh sách rỗng vẫn thêm POI được', async () => {
    const ui = await setup({ pois: [] });
    expect(ui.elements['list-status'].textContent).toContain('Chưa có địa điểm');
    click(ui.elements['new-poi']);
    expect(ui.elements['poi-panel'].hidden).toBe(false);
    expect(ui.elements['content-panel'].hidden).toBe(true);
    expect(ui.elements['poi-category'].value).toBe('food');
    expect(ui.elements['poi-radius'].value).toBe('50');
    expect(ui.elements['poi-active'].checked).toBe(true);
  });

  it('chuyển giữa tạo mới và quản lý POI không giữ dữ liệu form cũ', async () => {
    const ui = await setup();
    await select(ui);
    expect(ui.elements['poi-name'].value).toBe(basePoi.name);
    click(ui.elements['new-poi']);
    expect(ui.elements['poi-panel'].hidden).toBe(false);
    expect(ui.elements['poi-name'].value).toBe('');
    expect(ui.map.location()).toBeNull();
    await select(ui);
    expect(ui.elements['poi-name'].value).toBe(basePoi.name);
    expect(ui.map.location()).toEqual({ latitude: 10, longitude: 106 });
    expect(ui.elements['selected-id'].textContent).toContain('poi-a');
  });

  it('chọn POI GET dữ liệu và narration, hiện đúng bốn ngôn ngữ', async () => {
    const ui = await setup();
    await select(ui);
    expect(requests(ui, 'GET', '/api/admin/pois/poi-a')).toHaveLength(1);
    expect(requests(ui, 'GET', '/api/pois/poi-a/narrations')).toHaveLength(1);
    expect(ui.elements['poi-name'].value).toBe(basePoi.name);
    expect(ui.elements['poi-legacy-address'].textContent).toContain(basePoi.address);
    expect(ui.elements['poi-legacy-address'].hidden).toBe(false);
    expect(ui.map.location()).toEqual({ latitude: 10, longitude: 106 });
    expect(ui.elements['poi-panel'].hidden).toBe(false);
    expect(ui.elements['content-panel'].hidden).toBe(false);
    for (const code of codes) {
      expect(ui.cards[code]['.language-name'].textContent).toContain(code.toUpperCase());
      expect(ui.cards[code]['.language-text'].textContent).toBe(texts[code]);
      expect(ui.cards[code]['.language-text'].attributes.lang).toBe(code);
      expect(requests(ui, 'GET', `/api/pois/poi-a/narrations/${code}`)).toHaveLength(1);
    }
  });

  it('create gửi đúng schema numeric/boolean, refresh danh sách và chọn POI mới', async () => {
    const ui = await setup({ pois: [] });
    click(ui.elements['new-poi']);
    fill(ui, { name: '  Điểm mới  ' });
    ui.map.confirm(0, 0);
    submit(ui.elements['poi-form']);
    await flush();
    expect(JSON.parse(requests(ui, 'POST', '/api/pois')[0][1].body)).toEqual({ name: 'Điểm mới', description: 'Mô tả mới', category: 'cafe', address: '', streetAddress: '', ward: '', city: '', latitude: 0, longitude: 0, geofenceRadius: 75, isActive: false });
    expect(ui.elements['poi-rows'].children).toHaveLength(1);
    expect(ui.elements['selected-id'].textContent).toContain('created-poi');
    expect(ui.elements['action-status'].textContent).toContain('Đã tạo địa điểm');
    expect(requests(ui, 'POST')).toHaveLength(1);
  });

  it('edit gửi PUT đúng ID và refresh thông tin từ backend', async () => {
    const ui = await setup();
    await select(ui);
    fill(ui);
    submit(ui.elements['poi-form']);
    await flush();
    expect(requests(ui, 'PUT', '/api/pois/poi-a')).toHaveLength(1);
    expect(JSON.parse(requests(ui, 'PUT')[0][1].body).isActive).toBe(false);
    expect(ui.elements['poi-name'].value).toBe('Tên mới');
    expect(ui.elements['poi-rows'].children[0].parts['.row-name'].textContent).toBe('Tên mới');
    expect(ui.elements['action-status'].textContent).toContain('Đã lưu thay đổi');
  });

  it.each([['name', ' '], ['description', ''], ['category', ''], ['radius', '0'], ['radius', '12abc']])(
    'validation %s=%s không gửi request ghi', async (field, value) => {
      const ui = await setup();
      click(ui.elements['new-poi']);
      fill(ui, { [field]: value });
      ui.map.confirm(10, 106);
      submit(ui.elements['poi-form']);
      expect(requests(ui, 'POST')).toEqual([]);
      expect(ui.elements[`poi-${field}`].attributes['aria-invalid']).toBe('true');
      expect(ui.elements['action-status'].dataset.tone).toBe('error');
    }
  );

  it('không lưu POI mới khi vị trí chưa được xác nhận', async () => {
    const ui = await setup({ pois: [] });
    click(ui.elements['new-poi']);
    fill(ui);
    submit(ui.elements['poi-form']);
    expect(requests(ui, 'POST')).toHaveLength(0);
    expect(ui.elements['action-status'].textContent).toContain('xác nhận vị trí');
  });

  it('chỉ tạo POI sau khi đã xác nhận vị trí trên bản đồ', async () => {
    const ui = await setup({ pois: [] });
    click(ui.elements['new-poi']);
    fill(ui);
    expect(ui.map.location()).toBeNull();
    submit(ui.elements['poi-form']);
    expect(requests(ui, 'POST', '/api/pois')).toHaveLength(0);
    expect(ui.elements['action-status'].textContent).toBe('Đặt ghim và xác nhận vị trí trước khi lưu.');
    expect(ui.elements['action-status'].dataset.tone).toBe('error');

    ui.map.confirm(10, 106);
    expect(ui.map.location()).toEqual({ latitude: 10, longitude: 106 });
    submit(ui.elements['poi-form']);
    await flush();
    expect(requests(ui, 'POST', '/api/pois')).toHaveLength(1);
    expect(JSON.parse(requests(ui, 'POST', '/api/pois')[0][1].body)).toMatchObject({ latitude: 10, longitude: 106 });
    expect(ui.elements['action-status'].textContent).toContain('Đã tạo địa điểm');
    expect(ui.elements['action-status'].dataset.tone).toBe('success');
  });

  it('sửa thông tin POI cũ giữ nguyên tọa độ và địa chỉ chung', async () => {
    const ui = await setup();
    await select(ui);
    ui.elements['poi-name'].value = 'Tên mới';
    submit(ui.elements['poi-form']);
    await flush();
    expect(JSON.parse(requests(ui, 'PUT', '/api/pois/poi-a')[0][1].body)).toMatchObject({
      name: 'Tên mới', address: basePoi.address, latitude: basePoi.latitude, longitude: basePoi.longitude,
    });
  });

  it('lưu các phần địa chỉ và tọa độ đã xác nhận từ bản đồ', async () => {
    const ui = await setup({ pois: [] });
    click(ui.elements['new-poi']);
    fill(ui, { 'street-address': '23 Đường Mạc Đĩnh Chi', ward: 'Phường Sài Gòn', city: 'Thành phố Hồ Chí Minh' });
    ui.map.confirm(10, 106);
    submit(ui.elements['poi-form']);
    await flush();
    expect(JSON.parse(requests(ui, 'POST', '/api/pois')[0][1].body)).toMatchObject({
      streetAddress: '23 Đường Mạc Đĩnh Chi', ward: 'Phường Sài Gòn', city: 'Thành phố Hồ Chí Minh',
      address: '23 Đường Mạc Đĩnh Chi, Phường Sài Gòn, Thành phố Hồ Chí Minh', latitude: 10, longitude: 106,
    });
    click(ui.elements['new-poi']);
    await select(ui);
    expect(ui.elements['poi-street-address'].value).toBe('23 Đường Mạc Đĩnh Chi');
    expect(ui.elements['poi-ward'].value).toBe('Phường Sài Gòn');
    expect(ui.elements['poi-city'].value).toBe('Thành phố Hồ Chí Minh');
  });

  it('delete cancel không gọi API; confirm gọi DELETE 204 và clear POI đang chọn', async () => {
    const ui = await setup();
    await select(ui);
    ui.window.confirm.mockReturnValueOnce(false);
    click(ui.elements['delete-selected']);
    expect(requests(ui, 'DELETE')).toEqual([]);
    expect(ui.window.confirm).toHaveBeenCalledWith(expect.stringContaining(basePoi.name));
    click(ui.elements['delete-selected']);
    await flush();
    expect(requests(ui, 'DELETE', '/api/pois/poi-a')).toHaveLength(1);
    expect(requests(ui, 'DELETE', '/api/pois/poi-a')[0][1].headers).toMatchObject({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'fixture' });
    expect(ui.elements['poi-rows'].children).toHaveLength(0);
    expect(ui.elements['poi-panel'].hidden).toBe(true);
    expect(ui.elements['content-panel'].hidden).toBe(true);
    expect(ui.elements['action-status'].textContent).toContain('Đã xóa POI');
  });

  it('xóa một POI khác không đóng panel đang chọn', async () => {
    const ui = await setup({ pois: [{ ...basePoi, narrations: content() }, { ...basePoi, id: 'poi-b', name: 'B' }] });
    await select(ui);
    click(ui.elements['poi-rows'].children[1].parts['.row-delete']);
    await flush();
    expect(ui.elements['poi-panel'].hidden).toBe(false);
    expect(ui.elements['selected-id'].textContent).toContain('poi-a');
    expect(ui.elements['poi-rows'].children).toHaveLength(1);
  });

  it('chuỗi từ backend được render bằng textContent, không innerHTML', async () => {
    const name = '<img src=x onerror=alert(1)>';
    const ui = await setup({ pois: [{ ...basePoi, name, narrations: { vi: { text: name } } }] });
    await select(ui);
    expect(ui.elements['poi-rows'].children[0].parts['.row-name'].textContent).toBe(name);
    expect(ui.cards.vi['.language-text'].textContent).toBe(name);
    expect(ui.cards.vi['.language-text'].innerHTML).toBeUndefined();
    expect(ui.cards.vi['.language-text'].hidden).toBe(false);
  });
});

describe('Stage 7: VI, translation và audio', () => {
  it('Save VI đúng PUT/body, invalidation bỏ toàn bộ audio và bản dịch cũ', async () => {
    const ui = await setup({ pois: [{ ...basePoi, narrations: content(true) }] });
    await select(ui);
    click(ui.cards.vi['.listen-audio']);
    await flush();
    editVi(ui, '  Nguồn VI mới.  ');
    submit(ui.elements['vi-form']);
    await flush();
    expect(JSON.parse(requests(ui, 'PUT', '/api/pois/poi-a/narrations/vi')[0][1].body)).toEqual({ text: 'Nguồn VI mới.' });
    expect(ui.cards.vi['.audio-status'].textContent).toBe('Chưa có audio');
    expect(ui.cards.vi['.listen-audio'].hidden).toBe(true);
    expect(ui.audio.getAttribute('src')).toBeNull();
    for (const code of ['en', 'ja', 'ko']) {
      expect(ui.cards[code]['.language-text'].hidden).toBe(true);
      expect(ui.cards[code]['.listen-audio'].hidden).toBe(true);
    }
    expect(requests(ui, 'POST')).toEqual([]);
  });

  it('VI cùng text giữ audio theo backend, không tự gọi TTS hoặc Play', async () => {
    const ui = await setup({ pois: [{ ...basePoi, narrations: content(true) }] });
    await select(ui);
    editVi(ui, `  ${texts.vi}  `);
    submit(ui.elements['vi-form']);
    await flush();
    expect(ui.cards.vi['.listen-audio'].hidden).toBe(false);
    expect(ui.cards.en['.listen-audio'].hidden).toBe(false);
    expect(requests(ui, 'POST')).toEqual([]);
    expect(ui.audio.play).not.toHaveBeenCalled();
  });

  it('chưa có VI/VI chưa lưu không gọi translation/TTS', async () => {
    const ui = await setup({ pois: [{ ...basePoi, narrations: {} }] });
    await select(ui);
    click(ui.elements['translate']);
    click(ui.elements['generate-all-audio']);
    expect(requests(ui, 'POST')).toEqual([]);
    editVi(ui, 'Nháp chưa lưu');
    expect(ui.elements['translate'].disabled).toBe(true);
    expect(ui.elements['generate-all-audio'].disabled).toBe(true);
    expect(ui.elements['draft-status'].textContent).toContain('chưa lưu');
    click(ui.elements['translate']);
    expect(requests(ui, 'POST')).toEqual([]);
  });

  it('VI rỗng không được lưu', async () => {
    const ui = await setup();
    await select(ui);
    editVi(ui, ' ');
    submit(ui.elements['vi-form']);
    expect(requests(ui, 'PUT')).toEqual([]);
    expect(ui.elements['vi-text'].attributes['aria-invalid']).toBe('true');
  });

  it('lưu thông tin POI giữ bản VI đang nhập, không tự lưu/dịch/tạo audio', async () => {
    const ui = await setup();
    await select(ui);
    editVi(ui, 'Bản VI đang viết, chưa lưu');
    fill(ui);
    submit(ui.elements['poi-form']);
    await flush();
    expect(ui.elements['vi-text'].value).toBe('Bản VI đang viết, chưa lưu');
    expect(ui.elements['translate'].disabled).toBe(true);
    expect(requests(ui, 'PUT', '/api/pois/poi-a/narrations/vi')).toEqual([]);
    expect(requests(ui, 'POST')).toEqual([]);
  });

  it('dịch gọi Node API đúng targets, refresh bốn ngôn ngữ và bỏ audio target bị invalidate', async () => {
    const ui = await setup({ pois: [{ ...basePoi, narrations: content(true) }] });
    await select(ui);
    click(ui.elements['translate']);
    await flush();
    expect(JSON.parse(requests(ui, 'POST', '/api/pois/poi-a/translations')[0][1].body)).toEqual({ targetLanguages: ['en', 'ja', 'ko'] });
    for (const code of ['en', 'ja', 'ko']) {
      expect(ui.cards[code]['.language-text'].textContent).toBe(`Translated ${code}`);
      expect(ui.cards[code]['.listen-audio'].hidden).toBe(true);
      expect(requests(ui, 'GET', `/api/pois/poi-a/narrations/${code}`)).toHaveLength(2);
    }
    expect(ui.cards.vi['.listen-audio'].hidden).toBe(false);
    expect(ui.fetch.mock.calls.every(([url]) => url.startsWith('/api/pois') || url.startsWith('/api/admin/pois'))).toBe(true);
    expect(ui.audio.play).not.toHaveBeenCalled();
  });

  it('tạo tuần tự 4 audio từ các nội dung đã lưu và nghe đúng từng ngôn ngữ', async () => {
    const ui = await setup();
    await select(ui);
    click(ui.elements['generate-all-audio']);
    await flush();
    expect(requests(ui, 'POST').map(([url]) => url)).toEqual(codes.map((code) => `/api/pois/poi-a/narrations/${code}/audio`));
    for (const code of codes) {
      expect(requests(ui, 'POST', `/api/pois/poi-a/narrations/${code}/audio`)[0][1].headers)
        .toMatchObject({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'fixture' });
      expect(ui.cards[code]['.listen-audio'].hidden).toBe(false);
      expect(ui.cards[code]['.audio-status'].textContent).toContain('Có audio');
    }
    expect(ui.audio.play).not.toHaveBeenCalled();
    click(ui.cards.ja['.listen-audio']);
    await flush();
    expect(ui.audio.getAttribute('src')).toBe('/api/admin/audio/generated_ja_3.wav');
    expect(ui.audio.play).toHaveBeenCalledTimes(1);
  });

  it('thiếu bản dịch thì báo ngôn ngữ thiếu và không tạo audio', async () => {
    const narrations = content();
    delete narrations.ja;
    const ui = await setup({ pois: [{ ...basePoi, narrations }] });
    await select(ui);
    click(ui.elements['generate-all-audio']);
    await flush();
    expect(ui.elements['content-action-text'].textContent).toContain('JA');
    expect(ui.elements['content-action-text'].textContent).toContain('dịch');
    expect(requests(ui, 'POST')).toEqual([]);
  });

  it('audio có sẵn được giữ, một ngôn ngữ lỗi không ngăn các ngôn ngữ còn lại', async () => {
    const narrations = content();
    narrations.vi.audioFile = 'server_vi.wav';
    const ui = await setup({ pois: [{ ...basePoi, narrations }] });
    await select(ui);
    ui.state.overrides.set('POST /api/pois/poi-a/narrations/ja/audio', json({ error: 'Piper failed' }, 500));
    click(ui.elements['generate-all-audio']);
    await flush();
    expect(requests(ui, 'POST').map(([url]) => url)).toEqual(['en', 'ja', 'ko'].map((code) => `/api/pois/poi-a/narrations/${code}/audio`));
    expect(ui.cards.vi['.listen-audio'].hidden).toBe(false);
    expect(ui.cards.en['.listen-audio'].hidden).toBe(false);
    expect(ui.cards.ja['.listen-audio'].hidden).toBe(true);
    expect(ui.cards.ko['.listen-audio'].hidden).toBe(false);
    expect(ui.elements['content-action-text'].textContent).toContain('Tạo thất bại 1/4: JA');
    ui.state.overrides.delete('POST /api/pois/poi-a/narrations/ja/audio');
    click(ui.elements['generate-all-audio']);
    await flush();
    expect(requests(ui, 'POST', '/api/pois/poi-a/narrations/ja/audio')).toHaveLength(2);
    expect(requests(ui, 'POST')).toHaveLength(4);
    expect(ui.cards.ja['.listen-audio'].hidden).toBe(false);
    click(ui.elements['generate-all-audio']);
    expect(requests(ui, 'POST')).toHaveLength(4);
  });

  it('tiến trình chặn nhấn lặp và không chạy nhiều TTS cùng lúc', async () => {
    const ui = await setup();
    await select(ui);
    const delayed = pending();
    ui.state.overrides.set('POST /api/pois/poi-a/narrations/vi/audio', () => delayed.promise);
    click(ui.elements['generate-all-audio']);
    click(ui.elements['generate-all-audio']);
    await flush();
    expect(requests(ui, 'POST')).toHaveLength(1);
    expect(ui.elements['generate-all-audio'].disabled).toBe(true);
    expect(ui.elements['content-action-text'].textContent).toContain('0/4');
    delayed.resolve(json({ poiId: 'poi-a', language: 'vi', text: texts.vi, audioUrl: '/audio/generated_vi_1.wav' }));
    await flush();
    expect(requests(ui, 'POST')).toHaveLength(4);
    expect(ui.elements['generate-all-audio'].disabled).toBe(false);
  });

  it('audio cũ bị vô hiệu khi nội dung VI thay đổi; batch không dùng bản nháp', async () => {
    const ui = await setup({ pois: [{ ...basePoi, narrations: content(true) }] });
    await select(ui);
    editVi(ui, 'Nội dung VI mới');
    click(ui.elements['generate-all-audio']);
    expect(requests(ui, 'POST')).toEqual([]);
    submit(ui.elements['vi-form']);
    await flush();
    expect(ui.cards.vi['.listen-audio'].hidden).toBe(true);
    expect(ui.elements['generate-all-audio'].disabled).toBe(false);
    click(ui.elements['generate-all-audio']);
    await flush();
    expect(ui.elements['content-action-text'].textContent).toContain('EN, JA, KO');
    expect(requests(ui, 'POST')).toEqual([]);
  });

  it('kiểm tra lại server trước khi bỏ qua audio: bản dịch đổi ở phiên khác phải tạo từ text mới', async () => {
    const ui = await setup({ pois: [{ ...basePoi, narrations: content(true) }] });
    await select(ui);
    ui.state.pois[0].narrations.en = { text: 'English updated elsewhere.' };
    click(ui.elements['generate-all-audio']);
    await flush();
    expect(requests(ui, 'POST').map(([url]) => url)).toEqual(['/api/pois/poi-a/narrations/en/audio']);
    expect(ui.cards.en['.language-text'].textContent).toBe('English updated elsewhere.');
    expect(ui.cards.en['.listen-audio'].hidden).toBe(false);
  });

  it('nội dung đổi giữa lúc TTS chạy thì dừng batch và tải lại trạng thái', async () => {
    const ui = await setup();
    await select(ui);
    ui.state.overrides.set('POST /api/pois/poi-a/narrations/vi/audio', json({ error: 'Changed' }, 409));
    click(ui.elements['generate-all-audio']);
    await flush();
    expect(requests(ui, 'POST')).toHaveLength(1);
    expect(ui.elements['content-action-text'].textContent).toContain('thay đổi');
    expect(ui.elements['generate-all-audio'].disabled).toBe(false);
  });

  it('chuyển POI rồi tạo audio không dùng ID hoặc nội dung của POI trước', async () => {
    const other = { ...basePoi, id: 'poi-b', name: 'POI B', narrations: content() };
    const ui = await setup({ pois: [{ ...basePoi, narrations: content(true) }, other] });
    await select(ui, 1);
    click(ui.elements['generate-all-audio']);
    await flush();
    expect(requests(ui, 'POST').map(([url]) => url)).toEqual(codes.map((code) => `/api/pois/poi-b/narrations/${code}/audio`));
    expect(ui.cards.vi['.listen-audio'].hidden).toBe(false);
  });

  it('thiếu audioUrl không cố play hoặc đoán URL từ audioFile trong GET all', async () => {
    const ui = await setup({ pois: [{ ...basePoi, narrations: content(true) }] });
    ui.state.overrides.set('GET /api/pois/poi-a/narrations/vi', json({ poiId: 'poi-a', language: 'vi', text: texts.vi, audioFile: 'existing.wav' }));
    await select(ui);
    click(ui.cards.vi['.listen-audio']);
    expect(ui.audio.play).not.toHaveBeenCalled();
    expect(ui.cards.vi['.listen-audio'].hidden).toBe(true);
  });

  it.each(['https://unsafe.test/a.wav', '/audio/../outside.wav', '/audio/nested/file.wav', '/audio/a.wav?key=secret'])('URL không hợp lệ %s không phát', async (audioUrl) => {
    const ui = await setup();
    ui.state.overrides.set('GET /api/pois/poi-a/narrations/vi', json({ poiId: 'poi-a', language: 'vi', text: texts.vi, audioUrl }));
    await select(ui);
    click(ui.cards.vi['.listen-audio']);
    expect(ui.audio.play).not.toHaveBeenCalled();
    expect(ui.audio.getAttribute('src')).toBeNull();
    expect(ui.cards.vi['.audio-status'].textContent).toContain('không hợp lệ');
  });

  it('Nghe dùng một player, pause VI trước khi play EN', async () => {
    const ui = await setup({ pois: [{ ...basePoi, narrations: content(true) }] });
    const history = [];
    ui.audio.pause.mockImplementation(() => history.push(`pause:${ui.audio.getAttribute('src')}`));
    ui.audio.play.mockImplementation(async () => history.push(`play:${ui.audio.getAttribute('src')}`));
    await select(ui);
    click(ui.cards.vi['.listen-audio']);
    await flush();
    history.length = 0;
    click(ui.cards.en['.listen-audio']);
    await flush();
    expect(history).toEqual(['pause:/api/admin/audio/server_vi.wav', 'play:/api/admin/audio/server_en.wav']);
  });

  it('play reject có fallback, không unhandled rejection; media error không gọi TTS', async () => {
    const ui = await setup({ pois: [{ ...basePoi, narrations: content(true) }] });
    await select(ui);
    ui.audio.play.mockRejectedValueOnce(new Error('Blocked'));
    click(ui.cards.vi['.listen-audio']);
    await flush();
    expect(ui.elements['preview-status'].textContent).toContain('bấm Play');
    ui.audio.events.error();
    expect(ui.elements['preview-status'].textContent).toContain('Không tải được audio');
    expect(requests(ui, 'POST')).toEqual([]);
  });
});

describe('Stage 7: lỗi, loading và điều phối request', () => {
  it('network error danh sách không expose exception, có thể tải lại', async () => {
    const ui = await setup();
    ui.state.overrides.set('GET /api/pois', new Error('SECRET D:\\private\\key'));
    click(ui.elements['reload-pois']);
    await flush();
    expect(ui.elements['list-status'].textContent).toContain('Không kết nối');
    expect(ui.elements['list-status'].textContent).not.toMatch(/SECRET|private|key/);
    expect(ui.elements['reload-pois'].disabled).toBe(false);
    ui.state.overrides.delete('GET /api/pois');
    click(ui.elements['reload-pois']);
    await flush();
    expect(ui.elements['poi-rows'].children).toHaveLength(1);
  });

  it('chọn POI đã xóa trả 404, clear panel và refresh danh sách', async () => {
    const ui = await setup();
    ui.state.pois = [];
    await select(ui);
    expect(ui.elements['selection-status'].textContent).toContain('không còn tồn tại');
    expect(ui.elements['poi-panel'].hidden).toBe(true);
    expect(ui.elements['poi-rows'].children).toHaveLength(0);
  });

  it.each([400, 409, 500])('lưu POI HTTP %s hiển thị friendly, giữ form và mở khóa', async (status) => {
    const ui = await setup();
    await select(ui);
    ui.state.overrides.set('PUT /api/pois/poi-a', json({ error: 'SECRET D:\\private\\file.onnx api_key=hidden' }, status));
    fill(ui);
    submit(ui.elements['poi-form']);
    await flush();
    expect(ui.elements['action-status'].dataset.tone).toBe('error');
    expect(ui.elements['action-status'].textContent).not.toMatch(/SECRET|private|api_key|onnx/);
    expect(ui.elements['poi-panel'].hidden).toBe(false);
    expect(ui.elements['save-poi'].disabled).toBe(false);
  });

  it.each([502, 503, 504])('translation HTTP %s không crash, giữ nội dung/audio hiện có', async (status) => {
    const ui = await setup({ pois: [{ ...basePoi, narrations: content(true) }] });
    await select(ui);
    ui.state.overrides.set('POST /api/pois/poi-a/translations', json({ error: 'SECRET-provider-url-key' }, status));
    click(ui.elements['translate']);
    await flush();
    expect(ui.elements['content-action-text'].textContent).toMatch(/dịch/);
    expect(ui.elements['content-action-text'].textContent).not.toContain('SECRET');
    expect(ui.elements['translate'].disabled).toBe(false);
    expect(ui.cards.en['.language-text'].textContent).toBe(texts.en);
    expect(ui.cards.en['.listen-audio'].hidden).toBe(false);
    expect(ui.audio.play).not.toHaveBeenCalled();
  });

  it('Piper error chỉ hiển thị hướng dẫn, giữ text và mở nút tạo lại', async () => {
    const ui = await setup();
    await select(ui);
    ui.state.overrides.set('POST /api/pois/poi-a/narrations/ja/audio', json({ error: 'SECRET piper.exe D:\\models\\file.onnx' }, 500));
    click(ui.elements['generate-all-audio']);
    await flush();
    expect(ui.elements['content-action-text'].textContent).toContain('Tạo thất bại 1/4: JA');
    expect(ui.elements['content-action-text'].textContent).not.toMatch(/SECRET|piper.exe|onnx|D:/);
    expect(ui.cards.ja['.language-text'].textContent).toBe(texts.ja);
    expect(ui.elements['generate-all-audio'].disabled).toBe(false);
  });

  it('404 trong mutation của POI đang chọn clear panel', async () => {
    const ui = await setup();
    await select(ui);
    ui.state.pois = [];
    fill(ui);
    submit(ui.elements['poi-form']);
    await flush();
    expect(ui.elements['poi-panel'].hidden).toBe(true);
    expect(ui.elements['content-panel'].hidden).toBe(true);
    expect(ui.elements['action-status'].textContent).toContain('không còn tồn tại');
  });

  it('GET narration 404 sau GET all không dùng text/audio stale', async () => {
    const ui = await setup({ pois: [{ ...basePoi, narrations: content(true) }] });
    ui.state.overrides.set('GET /api/pois/poi-a/narrations/en', json({ error: 'Missing' }, 404));
    await select(ui);
    expect(ui.cards.en['.language-text'].hidden).toBe(true);
    expect(ui.cards.en['.listen-audio'].hidden).toBe(true);
    expect(ui.elements['generate-all-audio'].disabled).toBe(false);
    expect(ui.cards.vi['.listen-audio'].hidden).toBe(false);
  });

  it.each([
    { poiId: 'wrong', language: 'vi', text: 'Wrong POI' },
    { poiId: 'poi-a', language: 'ko', text: 'Wrong language' },
    { poiId: 'poi-a', language: 'vi', text: ' ' },
  ])('narration metadata sai không bật listen/generate: %j', async (response) => {
    const ui = await setup();
    ui.state.overrides.set('GET /api/pois/poi-a/narrations/vi', json(response));
    await select(ui);
    expect(ui.elements['content-status'].textContent).toContain('không hợp lệ');
    expect(ui.elements['generate-all-audio'].disabled).toBe(true);
    expect(ui.cards.vi['.listen-audio'].hidden).toBe(true);
  });

  it('JSON hỏng không expose lỗi parse', async () => {
    const ui = await setup();
    ui.state.overrides.set('GET /api/pois/poi-a/narrations', { ok: true, status: 200, json: async () => { throw new Error('SECRET parse'); } });
    await select(ui);
    expect(ui.elements['content-status'].textContent).toContain('Phản hồi');
    expect(ui.elements['content-status'].textContent).not.toContain('SECRET');
  });

  it.each(['create', 'edit', 'delete', 'vi', 'translation', 'audio'])('double click %s chỉ gửi một mutation, nút được mở lại', async (action) => {
    const ui = await setup();
    await select(ui);
    const delayed = pending();
    const routes = {
      create: 'POST /api/pois', edit: 'PUT /api/pois/poi-a', delete: 'DELETE /api/pois/poi-a',
      vi: 'PUT /api/pois/poi-a/narrations/vi', translation: 'POST /api/pois/poi-a/translations', audio: 'POST /api/pois/poi-a/narrations/vi/audio',
    };
    ui.state.overrides.set(routes[action], () => delayed.promise);
    if (action === 'create') click(ui.elements['new-poi']);
    if (['create', 'edit'].includes(action)) fill(ui);
    if (action === 'create') ui.map.confirm(10, 106);
    if (action === 'vi') editVi(ui, 'VI mới');
    const run = () => {
      if (['create', 'edit'].includes(action)) submit(ui.elements['poi-form']);
      if (action === 'delete') click(ui.elements['delete-selected']);
      if (action === 'vi') submit(ui.elements['vi-form']);
      if (action === 'translation') click(ui.elements['translate']);
      if (action === 'audio') click(ui.elements['generate-all-audio']);
    };
    run(); run();
    if (action === 'audio') await flush();
    const [method, url] = routes[action].split(' ');
    expect(requests(ui, method, url)).toHaveLength(1);
    expect(ui.elements['new-poi'].disabled).toBe(true);
    expect(ui.elements['poi-fields'].disabled).toBe(true);
    expect(ui.elements['translate'].disabled).toBe(true);
    const busyLabels = { vi: ['save-vi', 'Đang lưu...'], translation: ['translate', 'Đang dịch...'], audio: ['generate-all-audio', 'Đang tạo audio...'] };
    if (busyLabels[action]) {
      const [buttonId, label] = busyLabels[action];
      expect(ui.elements[buttonId].textContent).toBe(label);
      expect(ui.elements['content-action-notice'].hidden).toBe(false);
      expect(ui.elements['action-status'].textContent).toBe('');
      if (action === 'vi') expect(ui.elements['vi-text'].value).toBe('VI mới');
    }
    delayed.resolve(json(action === 'delete' ? null : basePoi, action === 'delete' ? 204 : 200));
    await flush();
    expect(ui.elements['new-poi'].disabled).toBe(false);
    expect(ui.elements['reload-pois'].disabled).toBe(false);
    expect(ui.elements['poi-panel'].attributes['aria-busy']).toBe('false');
    if (busyLabels[action]) expect(ui.elements[busyLabels[action][0]].textContent).not.toBe(busyLabels[action][1]);
  });

  it('timeout request dừng loading và cho thử lại, không treo UI', async () => {
    const ui = await setup();
    ui.state.overrides.set('GET /api/pois', (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('AbortError SECRET')));
    }));
    click(ui.elements['reload-pois']);
    await jest.advanceTimersByTimeAsync(10000);
    expect(ui.elements['list-status'].textContent).toContain('thời gian chờ');
    expect(ui.elements['reload-pois'].disabled).toBe(false);
    expect(ui.elements['poi-rows'].attributes['aria-busy']).toBe('false');
  });

  it('chọn B khi GET A chưa xong bỏ qua response A đến muộn', async () => {
    const ui = await setup({ pois: [{ ...basePoi, narrations: content() }, { ...basePoi, id: 'poi-b', name: 'Điểm B', narrations: { vi: { text: 'Text B' } } }] });
    const delayed = pending();
    ui.state.overrides.set('GET /api/pois/poi-a', () => delayed.promise);
    click(ui.elements['poi-rows'].children[0].parts['.row-manage']);
    const oldSignal = requests(ui, 'GET', '/api/admin/pois/poi-a')[0][1].signal;
    await select(ui, 1);
    delayed.resolve(json({ ...basePoi, narrations: content() }));
    await flush();
    expect(oldSignal.aborted).toBe(true);
    expect(ui.elements['selected-id'].textContent).toContain('poi-b');
    expect(ui.cards.vi['.language-text'].textContent).toBe('Text B');
    expect(requests(ui, 'GET', '/api/pois/poi-a/narrations')).toEqual([]);
  });

  it('nội dung A đến muộn không ghi đè B và không giữ audio A', async () => {
    const ui = await setup({ pois: [{ ...basePoi, narrations: content(true) }, { ...basePoi, id: 'poi-b', name: 'B', narrations: {} }] });
    const delayed = pending();
    ui.state.overrides.set('GET /api/pois/poi-a/narrations', () => delayed.promise);
    await select(ui);
    await select(ui, 1);
    delayed.resolve(json({ poiId: 'poi-a', narrations: content(true) }));
    await flush();
    expect(ui.elements['selected-id'].textContent).toContain('poi-b');
    expect(ui.elements['vi-text'].value).toBe('');
    expect(ui.cards.vi['.listen-audio'].hidden).toBe(true);
    expect(ui.audio.getAttribute('src')).toBeNull();
  });

  it('refresh metadata thất bại không giữ audio stale; tải lại phục hồi được', async () => {
    const ui = await setup({ pois: [{ ...basePoi, narrations: content(true) }] });
    await select(ui);
    click(ui.cards.vi['.listen-audio']);
    await flush();
    ui.state.overrides.set('GET /api/pois/poi-a/narrations', new Error('Offline'));
    click(ui.elements['reload-content']);
    await flush();
    expect(ui.audio.getAttribute('src')).toBeNull();
    expect(ui.cards.vi['.listen-audio'].hidden).toBe(true);
    expect(ui.elements['reload-content'].disabled).toBe(false);
    ui.state.overrides.delete('GET /api/pois/poi-a/narrations');
    ui.state.pois[0].narrations = { vi: { text: 'Nguồn mới' } };
    click(ui.elements['reload-content']);
    await flush();
    expect(ui.cards.vi['.language-text'].textContent).toBe('Nguồn mới');
    expect(ui.cards.vi['.listen-audio'].hidden).toBe(true);
  });

  it('pagehide hủy các metadata dùng chung controller và không ghi UI đến muộn', async () => {
    const ui = await setup();
    const delayed = pending();
    for (const code of ['en', 'ja', 'ko']) ui.state.overrides.set(`GET /api/pois/poi-a/narrations/${code}`, () => delayed.promise);
    await select(ui);
    const signal = requests(ui, 'GET', '/api/pois/poi-a/narrations/en')[0][1].signal;
    ui.window.addEventListener.mock.calls.find(([event]) => event === 'pagehide')[1]();
    expect(signal.aborted).toBe(true);
    delayed.resolve(json({ poiId: 'poi-a', language: 'en', text: 'Late' }));
    await flush();
    expect(ui.audio.getAttribute('src')).toBeNull();
    expect(ui.audio.play).not.toHaveBeenCalled();
  });
});
