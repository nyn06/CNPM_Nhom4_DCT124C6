const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = (name) => fs.readFileSync(path.join(__dirname, '../public/js', name), 'utf8');
const pages = ['admin.html', 'admin-login.html'].map((name) => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8'));

function setup(saved = null) {
  const values = new Map(saved === null ? [] : [['vigac_admin_language', saved]]);
  const storage = { getItem: jest.fn((key) => values.get(key) ?? null), setItem: jest.fn((key, value) => values.set(key, value)) };
  const nodes = new Map();
  const make = (id, dataset = {}) => ({ id, dataset, textContent: '', value: '', attributes: {}, events: {},
    setAttribute(name, value) { this.attributes[name] = value; }, addEventListener(name, handler) { this.events[name] = handler; } });
  const label = make('label', { adminI18n: 'html.admin.005' });
  const placeholder = make('placeholder', { adminI18nPlaceholder: 'html.admin.019' });
  const status = make('dashboard-status', { adminI18n: 'html.admin.005' });
  status.textContent = 'Live data';
  const deleteTitle = make('poi-delete-title', { adminI18n: 'html.admin.187' });
  const deleteCancel = make('poi-delete-cancel', { adminI18n: 'html.admin.188' });
  const deleteConfirm = make('poi-delete-confirm', { adminI18n: 'html.admin.189' });
  const selector = make('admin-language');
  nodes.set(selector.id, selector);
  const document = { documentElement: { lang: '' }, getElementById: (id) => nodes.get(id),
    addEventListener: jest.fn((name, handler) => { document.events[name] = handler; }), events: {},
    querySelectorAll: jest.fn((query) => ({ '[data-admin-i18n]': [label, status, deleteTitle, deleteCancel, deleteConfirm],
      '[data-admin-i18n-placeholder]': [placeholder] })[query] || []) };
  const window = {};
  vm.runInNewContext(source('admin-translations.js'), { window });
  vm.runInNewContext(source('admin-i18n.js'), { window, document, localStorage: storage });
  document.events.DOMContentLoaded();
  return { window, document, storage, values, label, placeholder, status, selector,
    deleteTitle, deleteCancel, deleteConfirm };
}

test('hai trang Admin nạp catalog riêng và có bộ chọn bốn ngôn ngữ', () => {
  const catalog = setup().window.ADMIN_TRANSLATIONS;
  for (const html of pages) {
    expect(html).toContain('/js/admin-translations.js');
    expect(html).toContain('/js/admin-i18n.js');
    expect(html).toContain('id="admin-language"');
    for (const language of ['vi', 'en', 'ja', 'ko']) expect(html).toContain(`value="${language}"`);
    for (const [, key] of html.matchAll(/data-admin-i18n(?:-[\w-]+)?="([^"]+)"/g)) {
      for (const language of ['vi', 'en', 'ja', 'ko']) expect(catalog[language][key]).toEqual(expect.any(String));
    }
  }
  for (const script of ['accounts.js', 'admin-auth.js', 'admin-dashboard.js', 'admin-login.js', 'admin-navigation.js',
    'admin-poi-map.js', 'admin-vouchers.js', 'admin.js']) {
    for (const [, key] of source(script).matchAll(/ADMIN_I18N\?*\.t\('([^']+)'/g)) {
      for (const language of ['vi', 'en', 'ja', 'ko']) expect(catalog[language][key]).toEqual(expect.any(String));
    }
  }
});

test('đổi VI/EN/JA/KO ngay tại chỗ, lưu lựa chọn riêng và giữ trạng thái động', () => {
  const ui = setup();
  const listener = jest.fn();
  ui.window.ADMIN_I18N.onChange(listener);
  for (const language of ['en', 'ja', 'ko', 'vi']) {
    ui.selector.value = language;
    ui.selector.events.change();
    expect(ui.document.documentElement.lang).toBe(language);
    expect(ui.label.textContent).toBe(ui.window.ADMIN_TRANSLATIONS[language]['html.admin.005']);
    expect(ui.placeholder.attributes.placeholder).toBe(ui.window.ADMIN_TRANSLATIONS[language]['html.admin.019']);
    expect(ui.status.textContent).toBe('Live data');
    expect(ui.deleteTitle.textContent).toBe(ui.window.ADMIN_TRANSLATIONS[language]['html.admin.187']);
    expect(ui.deleteCancel.textContent).toBe(ui.window.ADMIN_TRANSLATIONS[language]['html.admin.188']);
    expect(ui.deleteConfirm.textContent).toBe(ui.window.ADMIN_TRANSLATIONS[language]['html.admin.189']);
    expect(ui.values.get('vigac_admin_language')).toBe(language);
  }
  expect(listener).toHaveBeenCalledTimes(4);
  expect(ui.storage.setItem).toHaveBeenCalledTimes(4);
  expect(ui.values.has('poi-demo-language')).toBe(false);
});

test('khôi phục ngôn ngữ, fallback tiếng Việt và giữ tham số của mọi bản dịch', () => {
  const stored = setup('ja');
  expect(stored.window.ADMIN_I18N.language()).toBe('ja');
  expect(stored.selector.value).toBe('ja');
  const invalid = setup('xx');
  expect(invalid.window.ADMIN_I18N.language()).toBe('vi');
  const dictionaries = invalid.window.ADMIN_TRANSLATIONS;
  for (const language of ['en', 'ja', 'ko']) {
    expect(Object.keys(dictionaries[language]).sort()).toEqual(Object.keys(dictionaries.vi).sort());
    for (const [key, original] of Object.entries(dictionaries.vi)) {
      const params = (value) => [...value.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort();
      expect(params(dictionaries[language][key])).toEqual(params(original));
    }
  }
  delete dictionaries.en['html.admin.005'];
  invalid.window.ADMIN_I18N.setLanguage('en');
  expect(invalid.window.ADMIN_I18N.t('html.admin.005')).toBe(dictionaries.vi['html.admin.005']);
  expect(invalid.window.ADMIN_I18N.t('missing.key')).toBe('missing.key');
  expect(invalid.window.ADMIN_I18N.t('js.admin_vouchers.005', [60])).toContain('60');
});
