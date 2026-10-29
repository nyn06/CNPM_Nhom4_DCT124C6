(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const auth = window.ADMIN_AUTH;
  const { sourceLanguage, names: languageNames } = window.POI_LANGUAGES;
  const languages = Object.keys(languageNames);
  const targets = languages.filter((language) => language !== sourceLanguage);
  const poiT = (key, params) => window.ADMIN_I18N?.t?.(key, params) || key;
  const adminLanguage = () => window.ADMIN_I18N?.language?.() || 'vi';
  const categoryCodes = { food: 'food', 'món ăn': 'food', drink: 'drink', 'đồ uống': 'drink', dessert: 'dessert', 'tráng miệng': 'dessert' };
  const categoryLabel = (category) => {
    const code = categoryCodes[String(category || '').trim().toLocaleLowerCase('vi-VN')];
    return code && window.ADMIN_I18N?.t ? poiT(`poi.category.${code}`) : category;
  };
  const displayPoi = (poi) => {
    if (!poi) return null;
    const language = adminLanguage();
    const row = poi.translations?.[language];
    return { ...poi, ...Object.fromEntries(['name', 'description', 'address'].map((field) =>
      [field, language !== 'vi' && row?.[field] && !row.stale?.[field] ? row[field] : poi.original?.[field] ?? poi[field]])) };
  };
  const cards = new Map();
  const controllers = new Set();
  let rows = [];
  let allPois = [];
  let translationRefreshTimer = null;
  let poiPage = 1;
  let poiFilters = { search: '', status: 'all', category: 'all' };
  let activeLanguage = sourceLanguage;
  let selectedPoi = null;
  let mode = 'idle';
  let narrations = {};
  let listLoading = false;
  let selectionLoading = false;
  let contentLoading = false;
  let contentReady = false;
  let mutating = false;
  let disposed = false;
  let listRevision = 0;
  let selectionRevision = 0;
  let contentRevision = 0;
  let previewRevision = 0;
  let listController = null;
  let selectionController = null;
  let contentController = null;
  let contentNoticeTimer = null;
  let contentNoticeRevision = 0;

  function message(id, text, tone = 'neutral') {
    const target = byId(id);
    target.textContent = text;
    target.dataset.tone = tone;
    if (id === 'action-status') target.hidden = !text;
  }

  function clearContentNotice() {
    contentNoticeRevision++;
    clearTimeout(contentNoticeTimer);
    contentNoticeTimer = null;
    byId('content-action-notice').hidden = true;
    byId('content-action-text').textContent = '';
    byId('dismiss-content-action').hidden = true;
  }

  function contentNotice(text, tone = 'info') {
    clearContentNotice();
    const revision = contentNoticeRevision;
    const notice = byId('content-action-notice');
    notice.dataset.tone = tone;
    notice.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    notice.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    byId('content-action-text').textContent = text;
    byId('dismiss-content-action').hidden = tone !== 'error';
    notice.hidden = false;
    if (tone === 'success') contentNoticeTimer = setTimeout(() => {
      if (!disposed && revision === contentNoticeRevision) clearContentNotice();
    }, 5000);
  }

  function safeError(text, statusCode) {
    return Object.assign(new Error(text), { safe: true, statusCode });
  }

  function apiError(statusCode, scope) {
    if (statusCode === 401) return safeError((window.ADMIN_I18N?.t('js.admin.001') ?? 'Phiên quản trị đã hết hạn. Hãy đăng nhập lại.'), 401);
    if (statusCode === 403) return safeError((window.ADMIN_I18N?.t('js.admin.002') ?? 'Bạn không có quyền thực hiện thao tác hoặc CSRF token đã thay đổi. Hãy tải lại trang.'), 403);
    if (statusCode === 404) return safeError((window.ADMIN_I18N?.t('js.admin.003') ?? 'Địa điểm không còn tồn tại. Hãy tải lại danh sách và chọn địa điểm khác.'), 404);
    if (statusCode === 409) return safeError((window.ADMIN_I18N?.t('js.admin.004') ?? 'Nội dung đã thay đổi trong lúc xử lý. Hãy tải lại nội dung rồi thử lại.'), 409);
    if (statusCode === 400) return safeError((window.ADMIN_I18N?.t('js.admin.005') ?? 'Dữ liệu chưa hợp lệ. Kiểm tra các trường bắt buộc, tọa độ và nội dung tiếng Việt đã lưu.'), 400);
    if (scope === 'translation') return safeError(statusCode === 504
      ? (window.ADMIN_I18N?.t('js.admin.006') ?? 'Dịch vụ dịch quá thời gian chờ. Chưa lưu bản dịch mới; hãy thử lại.')
      : (window.ADMIN_I18N?.t('js.admin.007') ?? 'Chưa dịch được nội dung. Kiểm tra dịch vụ dịch và cấu hình server rồi thử lại.'), statusCode);
    if (scope === 'audio') return safeError((window.ADMIN_I18N?.t('js.admin.008') ?? 'Không tạo được audio. Kiểm tra cấu hình Piper trên server rồi thử lại.'), statusCode);
    return safeError((window.ADMIN_I18N?.t('js.admin.009') ?? 'Server chưa xử lý được yêu cầu. Hãy thử tải lại hoặc thực hiện lại sau.'), statusCode);
  }

  // Không đưa response error, URL provider hoặc exception gốc lên UI.
  async function requestJson(url, { method = 'GET', body, controller = new AbortController(), scope, timeout = 10000 } = {}) {
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const target = method === 'GET' && /^\/api\/pois(?:\/[^/]+)?$/.test(url) ? url.replace('/api/pois', '/api/admin/pois') : url;
      const response = await fetch(target, {
        method, signal: controller.signal, credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json', ...auth.headers(method), ...(!['GET', 'HEAD'].includes(method) ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      auth.handle(response);
      if (!response.ok) throw apiError(response.status, scope);
      if (response.status === 204) return null;
      try { return await response.json(); } catch { throw safeError((window.ADMIN_I18N?.t('js.admin.010') ?? 'Phản hồi từ server không hợp lệ. Hãy tải lại và thử lại.')); }
    } catch (error) {
      if (error.safe) throw error;
      throw safeError(controller.signal.aborted
        ? (window.ADMIN_I18N?.t('js.admin.011') ?? 'Yêu cầu đã hết thời gian chờ. Hãy kiểm tra server hoặc dịch vụ rồi thử lại.')
        : (window.ADMIN_I18N?.t('js.admin.012') ?? 'Không kết nối được backend. Hãy kiểm tra server và kết nối mạng.'));
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }

  const poiUrl = (id) => `/api/pois/${encodeURIComponent(id)}`;
  const hasText = (language) => typeof narrations[language]?.text === 'string' && !!narrations[language].text.trim();
  const validAudioUrl = (url) => typeof url === 'string' && /^\/audio\/[a-zA-Z0-9_-]+\.wav$/.test(url);
  const viDirty = () => byId('vi-text').value.trim() !== (narrations[sourceLanguage]?.text || '').trim();

  function updateControls() {
    const blocked = mutating || selectionLoading;
    byId('new-poi').disabled = mutating;
    byId('reload-pois').disabled = mutating || listLoading;
    byId('cancel-edit').disabled = mutating;
    byId('poi-fields').disabled = blocked || mode === 'idle';
    byId('save-poi').disabled = blocked || mode === 'idle';
    byId('delete-selected').disabled = blocked || !selectedPoi;
    byId('vi-text').disabled = blocked || contentLoading || !contentReady;
    byId('save-vi').disabled = blocked || !contentReady || !byId('vi-text').value.trim();
    byId('translate').disabled = blocked || !contentReady || !hasText(sourceLanguage) || viDirty();
    byId('generate-all-audio').disabled = blocked || contentLoading || !contentReady || !selectedPoi || viDirty();
    byId('reload-content').disabled = blocked || contentLoading || !selectedPoi || viDirty();
    for (const row of rows) {
      row.manage.disabled = mutating;
      row.remove.disabled = mutating;
    }
    for (const [language, card] of cards) {
      card.listen.disabled = blocked || !contentReady || !validAudioUrl(narrations[language]?.audioUrl);
    }
  }

  function stopPreview() {
    previewRevision++;
    const audio = byId('preview-audio');
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio.hidden = true;
    message('preview-status', (window.ADMIN_I18N?.t('js.admin.013') ?? 'Chọn “Nghe” ở một ngôn ngữ để nghe thử.'));
  }

  function renderNarrations() {
    for (const [language, card] of cards) {
      const narration = narrations[language];
      const textExists = hasText(language);
      const audioExists = textExists && validAudioUrl(narration.audioUrl);
      card.text.textContent = textExists ? narration.text : '';
      card.text.hidden = !textExists;
      card.textStatus.textContent = textExists ? (window.ADMIN_I18N?.t('js.admin.014') ?? 'Đã có nội dung') : (window.ADMIN_I18N?.t('js.admin.015') ?? 'Chưa có nội dung');
      card.audioStatus.textContent = audioExists ? (window.ADMIN_I18N?.t('js.admin.016') ?? 'Có audio · Sẵn sàng nghe thử')
        : narration?.audioUrl ? (window.ADMIN_I18N?.t('js.admin.017') ?? 'Đường dẫn audio không hợp lệ.') : (window.ADMIN_I18N?.t('js.admin.018') ?? 'Chưa có audio thuyết minh');
      card.audioStatus.dataset.tone = audioExists ? 'success' : narration?.audioUrl ? 'error' : 'neutral';
      card.listen.hidden = !audioExists;
    }
    updateControls();
  }

  function showLanguage(language) {
    activeLanguage = language;
    for (const [code, card] of cards) {
      card.element.hidden = code !== language;
      byId(`language-tab-${code}`).setAttribute('aria-selected', String(code === language));
    }
    byId('vi-form').hidden = language !== sourceLanguage;
    byId('translated-language-help').hidden = language === sourceLanguage;
  }

  function changeLanguage(language) {
    if (language === activeLanguage) return;
    if (activeLanguage === sourceLanguage && viDirty()
      && !window.confirm((window.ADMIN_I18N?.t('js.admin.019') ?? 'Nội dung tiếng Việt chưa lưu. Chuyển ngôn ngữ và giữ bản nháp để lưu sau?'))) return;
    stopPreview();
    showLanguage(language);
  }

  function clearSelection() {
    clearContentNotice();
    selectionRevision++;
    contentRevision++;
    selectionController?.abort();
    contentController?.abort();
    selectionController = null;
    contentController = null;
    selectedPoi = null;
    narrations = {};
    activeLanguage = sourceLanguage;
    mode = 'idle';
    selectionLoading = false;
    contentLoading = false;
    contentReady = false;
    byId('vi-text').value = '';
    byId('poi-panel').hidden = true;
    window.ADMIN_POI_MAP.clear();
    byId('content-panel').hidden = true;
    byId('selected-poi-summary').textContent = '';
    byId('selection-status').hidden = false;
    byId('poi-panel').setAttribute('aria-busy', 'false');
    byId('content-panel').setAttribute('aria-busy', 'false');
    message('selection-status', (window.ADMIN_I18N?.t('js.admin.020') ?? 'Chọn “Quản lý” trong danh sách để mở địa điểm.'));
    stopPreview();
    renderNarrations();
    showLanguage(sourceLanguage);
    markSelectedRow();
  }

  function markSelectedRow() {
    for (const row of rows) row.element.dataset.selected = String(row.id === selectedPoi?.id);
  }

  function syncPoiCategories() {
    const select = byId('poi-category-filter');
    const draft = select.value || 'all';
    const categories = [...new Set(allPois.map((poi) => String(poi.category || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'vi'));
    const all = document.createElement('option');
    all.value = 'all';
    all.dataset.adminI18n = 'html.admin.020';
    all.textContent = (window.ADMIN_I18N?.t('html.admin.020') ?? 'Tất cả danh mục');
    const options = categories.map((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = categoryLabel(category);
      return option;
    });
    select.replaceChildren(all, ...options);
    select.value = categories.includes(draft) ? draft : 'all';
    if (poiFilters.category !== 'all' && !categories.includes(poiFilters.category)) poiFilters.category = 'all';
  }

  function renderPoiPage() {
    const search = poiFilters.search.toLocaleLowerCase('vi-VN');
    const category = poiFilters.category.toLocaleLowerCase('vi-VN');
    const status = poiFilters.status;
    const filtered = allPois.filter((poi) => {
      const view = displayPoi(poi);
      const searchable = [view.name, view.address].filter(Boolean).join(' ').toLocaleLowerCase('vi-VN');
      return searchable.includes(search) && (category === 'all' || String(poi.category || '').toLocaleLowerCase('vi-VN') === category)
        && (status === 'all' || poi.isActive === (status === 'active'));
    });
    const pages = Math.ceil(filtered.length / 10);
    poiPage = Math.min(poiPage, Math.max(1, pages));
    const visible = filtered.slice((poiPage - 1) * 10, poiPage * 10);
    byId('poi-rows').replaceChildren();
    rows = visible.map((poi, index) => {
      const view = displayPoi(poi);
      const row = byId('poi-row-template').content.firstElementChild.cloneNode(true);
      const number = row.querySelector('.row-number');
      const address = row.querySelector('.row-address');
      const radius = row.querySelector('.row-radius');
      if (number) number.textContent = String((poiPage - 1) * 10 + index + 1);
      if (address) address.textContent = view.address || '—';
      if (radius) radius.textContent = `${poi.geofenceRadius} m`;
      row.querySelector('.row-name').textContent = view.name;
      row.querySelector('.row-category').textContent = categoryLabel(poi.category);
      const badge = row.querySelector('.row-active');
      badge.textContent = poi.isActive ? (window.ADMIN_I18N?.t('js.admin.021') ?? 'Hoạt động') : (window.ADMIN_I18N?.t('js.admin.022') ?? 'Tạm dừng');
      badge.dataset.tone = poi.isActive ? 'success' : 'neutral';
      const manage = row.querySelector('.row-manage');
      const remove = row.querySelector('.row-delete');
      manage.textContent = (window.ADMIN_I18N?.t('html.admin.147') ?? 'Quản lý');
      remove.textContent = (window.ADMIN_I18N?.t('html.admin.148') ?? 'Xóa');
      manage.setAttribute('aria-label', (window.ADMIN_I18N?.t('js.admin.023', [view.name]) ?? `Quản lý ${view.name}`));
      remove.setAttribute('aria-label', (window.ADMIN_I18N?.t('js.admin.024', [view.name]) ?? `Xóa ${view.name}`));
      manage.addEventListener('click', () => { if (!mutating) selectPoi(poi.id, false, true); });
      remove.addEventListener('click', () => deletePoi(poi));
      byId('poi-rows').append(row);
      return { id: poi.id, element: row, manage, remove };
    });
    byId('poi-count').textContent = (window.ADMIN_I18N?.t('js.admin.025', [filtered.length, allPois.length]) ?? `${filtered.length}/${allPois.length} địa điểm`);
    byId('poi-page').textContent = (window.ADMIN_I18N?.t('js.admin.026', [poiPage, Math.max(1, pages), filtered.length]) ?? `Trang ${poiPage}/${Math.max(1, pages)} · ${filtered.length} kết quả`);
    byId('poi-prev').disabled = poiPage <= 1;
    byId('poi-next').disabled = poiPage >= pages;
    message('list-status', visible.length ? (window.ADMIN_I18N?.t('js.admin.027') ?? 'Chọn địa điểm để quản lý nội dung.') : allPois.length
      ? (window.ADMIN_I18N?.t('js.admin.028') ?? 'Không có địa điểm phù hợp bộ lọc.') : (window.ADMIN_I18N?.t('js.admin.029') ?? 'Chưa có địa điểm. Bấm “+ Thêm địa điểm” để tạo địa điểm đầu tiên.'));
    markSelectedRow();
    updateControls();
  }

  function renderPois(pois) {
    allPois = [...pois].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    if (selectedPoi) {
      const latest = allPois.find((poi) => poi.id === selectedPoi.id);
      if (latest) {
        selectedPoi = { ...selectedPoi, translations: latest.translations };
        renderSelectedPoiSummary();
        byId('poi-form-title').textContent = (window.ADMIN_I18N?.t('js.admin.042', [displayPoi(selectedPoi).name])
          ?? `Thông tin ${displayPoi(selectedPoi).name}`);
      }
    }
    syncPoiCategories();
    byId('poi-stat-total').textContent = String(pois.length);
    byId('poi-stat-active').textContent = String(pois.filter((poi) => poi.isActive === true).length);
    byId('poi-stat-inactive').textContent = String(pois.filter((poi) => poi.isActive === false).length);
    renderPoiPage();
    scheduleTranslationRefresh();
  }

  async function loadPois() {
    const revision = ++listRevision;
    listController?.abort();
    const controller = new AbortController();
    listController = controller;
    listLoading = true;
    for (const key of ['total', 'active', 'inactive']) byId(`poi-stat-${key}`).textContent = '—';
    byId('poi-rows').setAttribute('aria-busy', 'true');
    message('list-status', (window.ADMIN_I18N?.t('js.admin.030') ?? 'Đang tải danh sách POI…'));
    updateControls();
    try {
      const pois = await requestJson('/api/pois', { controller });
      if (disposed || revision !== listRevision) return false;
      if (!Array.isArray(pois) || pois.some((poi) => !poi || typeof poi.id !== 'string' || typeof poi.name !== 'string')) {
        throw safeError((window.ADMIN_I18N?.t('js.admin.031') ?? 'Danh sách POI không hợp lệ. Hãy thử tải lại.'));
      }
      if (selectedPoi && !pois.some((poi) => poi.id === selectedPoi.id)) clearSelection();
      renderPois(pois);
      return true;
    } catch (error) {
      if (!disposed && revision === listRevision) message('list-status', error.message, 'error');
      return false;
    } finally {
      if (!disposed && revision === listRevision) {
        listController = null;
        listLoading = false;
        byId('poi-rows').setAttribute('aria-busy', 'false');
        updateControls();
      }
    }
  }

  function scheduleTranslationRefresh() {
    clearTimeout(translationRefreshTimer);
    if (disposed || !allPois.some((poi) => targets.some((language) =>
      ['name', 'description', 'address'].some((field) => poi[field]
        && !poi.translations?.[language]?.[`${field}Manual`]
        && (!poi.translations?.[language]?.[field] || poi.translations[language].stale?.[field]))))) return;
    async function refresh() {
      if (disposed) return;
      const revision = listRevision;
      try {
        const pois = await requestJson('/api/pois');
        if (!disposed && !mutating && revision === listRevision && Array.isArray(pois)) renderPois(pois);
        else if (!disposed && revision === listRevision) scheduleTranslationRefresh();
      } catch { if (!disposed && revision === listRevision) scheduleTranslationRefresh(); }
    }
    translationRefreshTimer = setTimeout(refresh, 15000);
  }

  function fillPoiForm(poi) {
    for (const [field, key] of [['name', 'name'], ['description', 'description'], ['category', 'category'],
      ['street-address', 'streetAddress'], ['ward', 'ward'], ['city', 'city'], ['radius', 'geofenceRadius']]) {
      byId(`poi-${field}`).value = String(poi[key] ?? '');
      byId(`poi-${field}`).setAttribute('aria-invalid', 'false');
    }
    const legacyAddress = byId('poi-legacy-address');
    legacyAddress.hidden = !poi.address || !!(poi.streetAddress || poi.ward || poi.city);
    legacyAddress.textContent = legacyAddress.hidden ? '' : (window.ADMIN_I18N?.t('js.admin.032', [poi.address]) ?? `Địa chỉ đã lưu: ${poi.address}`);
    byId('poi-active').checked = poi.isActive === true;
    renderCategoryFormLabel();
  }

  function renderCategoryFormLabel() {
    const category = byId('poi-category').value.trim();
    const label = categoryLabel(category);
    const display = byId('poi-category-display');
    display.hidden = !category || label === category;
    display.textContent = display.hidden ? '' : label;
  }

  function renderSelectedPoiSummary() {
    if (!selectedPoi) return;
    const poi = displayPoi(selectedPoi);
    const t = poiT;
    byId('selected-poi-summary').textContent = `${poi.name} · ${categoryLabel(poi.category)} · ${poi.description} · ${poi.address || t('js.admin.039')} · ${t(poi.isActive ? 'js.admin.040' : 'js.admin.041')}`;
  }

  async function loadContent() {
    if (!selectedPoi || disposed) return false;
    const id = selectedPoi.id;
    const revision = ++contentRevision;
    contentController?.abort();
    const controller = new AbortController();
    contentController = controller;
    contentLoading = true;
    contentReady = false;
    narrations = {};
    byId('vi-text').value = '';
    stopPreview();
    renderNarrations();
    byId('content-panel').setAttribute('aria-busy', 'true');
    message('content-status', (window.ADMIN_I18N?.t('js.admin.033') ?? 'Đang tải nội dung và kiểm tra audio…'));
    message('draft-status', '');
    try {
      const all = await requestJson(`${poiUrl(id)}/narrations`, { controller });
      if (disposed || revision !== contentRevision) return false;
      if (all?.poiId !== id || !all.narrations || typeof all.narrations !== 'object' || Array.isArray(all.narrations)) {
        throw safeError((window.ADMIN_I18N?.t('js.admin.034') ?? 'Nội dung trả về không hợp lệ. Hãy thử tải lại.'));
      }
      // GET all không có audioUrl. Lấy metadata từ GET từng ngôn ngữ, không đoán tên WAV.
      const entries = await Promise.all(languages.map(async (language) => {
        if (!all.narrations[language]?.text) return [language, null];
        let data;
        try { data = await requestJson(`${poiUrl(id)}/narrations/${language}`, { controller }); }
        catch (error) { if (error.statusCode === 404) return [language, null]; throw error; }
        if (data?.poiId !== id || data.language !== language || typeof data.text !== 'string' || !data.text.trim()) {
          throw safeError((window.ADMIN_I18N?.t('js.admin.034') ?? 'Nội dung trả về không hợp lệ. Hãy thử tải lại.'));
        }
        return [language, data];
      }));
      if (disposed || revision !== contentRevision) return false;
      narrations = Object.fromEntries(entries.filter(([, data]) => data));
      contentReady = true;
      byId('vi-text').value = narrations[sourceLanguage]?.text || '';
      byId('vi-text').setAttribute('aria-invalid', 'false');
      renderNarrations();
      message('content-status', (window.ADMIN_I18N?.t('js.admin.035', [languages.filter(hasText).length, languages.length, languages.filter((code) => validAudioUrl(narrations[code]?.audioUrl)).length, languages.length]) ?? `Đã tải ${languages.filter(hasText).length}/${languages.length} nội dung · ${languages.filter((code) => validAudioUrl(narrations[code]?.audioUrl)).length}/${languages.length} audio.`));
      return true;
    } catch (error) {
      if (disposed || revision !== contentRevision) return false;
      if (error.statusCode === 404) {
        clearSelection();
        message('selection-status', error.message, 'error');
        await loadPois();
      } else message('content-status', error.message, 'error');
      return false;
    } finally {
      if (!disposed && revision === contentRevision) {
        contentController = null;
        contentLoading = false;
        byId('content-panel').setAttribute('aria-busy', 'false');
        updateControls();
      }
    }
  }

  function scrollToPoiEditor() {
    const panel = byId('poi-panel');
    if (panel.hidden) return;
    panel.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  async function selectPoi(id, force = false, scrollAfterOpen = false) {
    if (!force && selectedPoi && viDirty()
      && !window.confirm((window.ADMIN_I18N?.t('js.admin.036') ?? 'Nội dung tiếng Việt chưa lưu. Rời địa điểm này và bỏ bản nháp?'))) return false;
    clearSelection();
    const revision = selectionRevision;
    const controller = new AbortController();
    selectionController = controller;
    selectionLoading = true;
    message('selection-status', (window.ADMIN_I18N?.t('js.admin.037') ?? 'Đang mở địa điểm…'));
    updateControls();
    try {
      const poi = await requestJson(poiUrl(id), { controller });
      if (disposed || revision !== selectionRevision) return false;
      if (poi?.id !== id || typeof poi.name !== 'string') throw safeError((window.ADMIN_I18N?.t('js.admin.038') ?? 'Thông tin POI không hợp lệ. Hãy tải lại danh sách.'));
      selectedPoi = { ...poi, translations: allPois.find((entry) => entry.id === id)?.translations || poi.translations };
      renderSelectedPoiSummary();
      showLanguage(sourceLanguage);
      mode = 'edit';
      fillPoiForm(poi);
      byId('poi-form-title').textContent = (window.ADMIN_I18N?.t('js.admin.042', [displayPoi(poi).name]) ?? `Thông tin ${poi.name}`);
      byId('selected-id').textContent = `POI: ${poi.id}`;
      byId('save-poi').textContent = (window.ADMIN_I18N?.t('js.admin.043') ?? 'Lưu thay đổi');
      byId('delete-selected').hidden = false;
      byId('poi-panel').hidden = false;
      byId('content-panel').hidden = false;
      byId('selection-status').hidden = true;
      window.ADMIN_POI_MAP.load(poi);
      markSelectedRow();
      const contentLoaded = await loadContent();
      if (scrollAfterOpen && selectedPoi?.id === id && !disposed) scrollToPoiEditor();
      return contentLoaded;
    } catch (error) {
      if (disposed || revision !== selectionRevision) return false;
      clearSelection();
      message('selection-status', error.message, 'error');
      if (error.statusCode === 404) await loadPois();
      return false;
    } finally {
      if (!disposed && revision === selectionRevision) {
        selectionLoading = false;
        selectionController = null;
        updateControls();
      }
    }
  }

  function newPoi() {
    if (mutating) return;
    if (selectedPoi && viDirty()
      && !window.confirm((window.ADMIN_I18N?.t('js.admin.044') ?? 'Nội dung tiếng Việt chưa lưu. Tạo địa điểm mới và bỏ bản nháp?'))) return;
    clearSelection();
    mode = 'new';
    byId('selected-poi-summary').textContent = '';
    fillPoiForm({ category: 'Món ăn', geofenceRadius: 50, isActive: true });
    byId('poi-form-title').textContent = (window.ADMIN_I18N?.t('js.admin.045') ?? 'Thêm địa điểm mới');
    byId('selected-id').textContent = (window.ADMIN_I18N?.t('js.admin.046') ?? 'Lưu địa điểm để bắt đầu chuẩn bị thuyết minh.');
    byId('save-poi').textContent = (window.ADMIN_I18N?.t('js.admin.047') ?? 'Tạo địa điểm');
    byId('delete-selected').hidden = true;
    byId('poi-panel').hidden = false;
    byId('selection-status').hidden = true;
    window.ADMIN_POI_MAP.load(null);
    message('action-status', (window.ADMIN_I18N?.t('js.admin.048') ?? 'Đang thêm địa điểm mới.'));
    updateControls();
    byId('poi-name').focus({ preventScroll: true });
    scrollToPoiEditor();
  }

  function readPoiForm() {
    const data = { isActive: byId('poi-active').checked };
    for (const field of ['name', 'description', 'category']) {
      const input = byId(`poi-${field}`);
      data[field] = input.value.trim();
      const invalid = !data[field];
      input.setAttribute('aria-invalid', String(invalid));
      if (invalid) { input.focus(); throw safeError((window.ADMIN_I18N?.t('js.admin.049') ?? 'Tên, mô tả và loại địa điểm không được để trống.')); }
    }
    for (const [field, key] of [['street-address', 'streetAddress'], ['ward', 'ward'], ['city', 'city']]) {
      data[key] = byId(`poi-${field}`).value.trim();
    }
    data.address = [data.streetAddress, data.ward, data.city].filter(Boolean).join(', ') || selectedPoi?.address || '';
    const location = window.ADMIN_POI_MAP.location();

    if (!location) {
      throw safeError((window.ADMIN_I18N?.t('js.admin.050') ?? 'Đặt ghim và xác nhận vị trí trước khi lưu.'));
    }
    Object.assign(data, location);
    for (const [field, key, min, max] of [['radius', 'geofenceRadius', 0, Infinity]]) {
      const input = byId(`poi-${field}`);
      const value = input.value.trim();
      const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : NaN;
      const invalid = !Number.isFinite(number) || number < min || number > max || (key === 'geofenceRadius' && number <= 0);
      input.setAttribute('aria-invalid', String(invalid));
      if (invalid) { input.focus(); throw safeError((window.ADMIN_I18N?.t('js.admin.051') ?? 'Bán kính phải là số lớn hơn 0.')); }
      data[key] = number;
    }
    return data;
  }

  async function mutate(label, work, affectedId, contentAction = null) {
    if (mutating || disposed) return;
    mutating = true;
    const button = contentAction ? byId(contentAction.buttonId) : null;
    const originalLabel = button?.textContent;
    if (button) button.textContent = contentAction.busyLabel;
    stopPreview();
    byId('poi-panel').setAttribute('aria-busy', 'true');
    if (contentAction) contentNotice(label);
    else message('action-status', label, 'info');
    updateControls();
    try {
      const success = await work();
      if (!disposed) {
        if (contentAction) contentNotice(success.text, success.tone);
        else message('action-status', success, 'success');
      }
    } catch (error) {
      if (disposed) return;
      if (error.statusCode === 404) {
        if (selectedPoi?.id === affectedId) clearSelection();
        await loadPois();
      }
      const detail = error.safe ? error.message : (window.ADMIN_I18N?.t('js.admin.052') ?? 'Chưa hoàn tất thao tác. Hãy tải lại và thử lại.');
      if (contentAction && !byId('content-panel').hidden) contentNotice(`${contentAction.failure} ${detail}`, 'error');
      else message(contentAction ? 'selection-status' : 'action-status', detail, 'error');
    } finally {
      if (!disposed) {
        mutating = false;
        if (button) button.textContent = originalLabel;
        byId('poi-panel').setAttribute('aria-busy', 'false');
        updateControls();
      }
    }
  }

  function savePoi(event) {
    event.preventDefault();
    if (mutating || selectionLoading || mode === 'idle') return;
    let body;
    try { body = readPoiForm(); } catch (error) { message('action-status', error.message, 'error'); return; }
    const id = selectedPoi?.id;
    const detailsChanged = !id || ['name', 'description', 'address'].some((field) => body[field] !== selectedPoi[field]);
    const viDraft = id && viDirty() ? byId('vi-text').value : null;
    mutate(id ? (window.ADMIN_I18N?.t('js.admin.053') ?? 'Đang lưu thay đổi…') : (window.ADMIN_I18N?.t('js.admin.054') ?? 'Đang tạo địa điểm…'), async () => {
      const poi = await requestJson(id ? poiUrl(id) : '/api/pois', { method: id ? 'PUT' : 'POST', body });
      if (disposed) return '';
      if (typeof poi?.id !== 'string') throw safeError((window.ADMIN_I18N?.t('js.admin.055') ?? 'Địa điểm đã lưu nhưng phản hồi không hợp lệ. Hãy tải lại danh sách.'));
      await loadPois();
      const refreshed = await selectPoi(poi.id, true);
      if (detailsChanged) scheduleTranslationRefresh();
      if (viDraft !== null && selectedPoi?.id === id) {
        byId('vi-text').value = viDraft;
        message('draft-status', (window.ADMIN_I18N?.t('js.admin.056') ?? 'Có nội dung VI chưa lưu. Hãy lưu trước khi dịch hoặc tạo audio.'));
        updateControls();
      }
      return `${id ? (window.ADMIN_I18N?.t('js.admin.057') ?? 'Đã lưu thay đổi địa điểm.') : (window.ADMIN_I18N?.t('js.admin.058') ?? 'Đã tạo địa điểm.')}${refreshed ? (window.ADMIN_I18N?.t('js.admin.059') ?? ' Địa điểm đã được mở để quản lý.') : (window.ADMIN_I18N?.t('js.admin.060') ?? ' Bấm tải lại để kiểm tra nội dung.')}`;
    }, id);
  }


let pendingDeletePoi = null;
let deleteModalPreviousFocus = null;

function closeDeletePoiModal() {
  const modal = byId('poi-delete-modal');
  if (modal.hidden) return;

  modal.hidden = true;
  pendingDeletePoi = null;

  deleteModalPreviousFocus?.focus?.();
  deleteModalPreviousFocus = null;
}

function updateDeletePoiModalText() {
  if (!pendingDeletePoi) return;
  const translate = window.ADMIN_I18N?.t;
  byId('poi-delete-description').textContent = translate
    ? `${translate('js.admin.096', [pendingDeletePoi.name])} ${translate('js.admin.097')}`
    : pendingDeletePoi.name;
}

function deletePoi(poi) {
  if (mutating || disposed || !poi) return;

  pendingDeletePoi = poi;
  deleteModalPreviousFocus = document.activeElement;

  const modal = byId('poi-delete-modal');
  updateDeletePoiModalText();

  modal.hidden = false;
  byId('poi-delete-cancel').focus();
}

function confirmDeletePoi() {
  const poi = pendingDeletePoi;

  if (!poi || mutating || disposed) return;

  closeDeletePoiModal();

  mutate(
    (window.ADMIN_I18N?.t('js.admin.062')
      ?? 'Đang xóa địa điểm…'),
    async () => {
      await requestJson(poiUrl(poi.id), {
        method: 'DELETE'
      });

      if (disposed) return '';

      if (selectedPoi?.id === poi.id) {
        clearSelection();
      }

      await loadPois();

      return (window.ADMIN_I18N?.t('js.admin.063')
        ?? 'Đã xóa POI.');
    },
    poi.id
  );
}


  function saveVietnamese(event) {
    event.preventDefault();
    if (mutating || !selectedPoi || !contentReady) return;
    const text = byId('vi-text').value.trim();
    if (!text) { byId('vi-text').setAttribute('aria-invalid', 'true'); contentNotice((window.ADMIN_I18N?.t('js.admin.064') ?? 'Nhập nội dung tiếng Việt trước khi lưu.'), 'error'); return; }
    const id = selectedPoi.id;
    mutate((window.ADMIN_I18N?.t('js.admin.065') ?? 'Đang lưu nội dung tiếng Việt…'), async () => {
      const saved = await requestJson(`${poiUrl(id)}/narrations/${sourceLanguage}`, { method: 'PUT', body: { text } });
      if (saved?.poiId !== id || saved.language !== sourceLanguage || saved.text !== text) {
        throw safeError((window.ADMIN_I18N?.t('js.admin.066') ?? 'Phản hồi lưu nội dung chưa được xác nhận. Hãy tải lại để kiểm tra.'));
      }
      if (disposed) return null;
      const refreshed = await loadContent();
      await loadPois();
      return refreshed
        ? { text: (window.ADMIN_I18N?.t('js.admin.067') ?? 'Đã lưu nội dung tiếng Việt thành công.'), tone: 'success' }
        : { text: (window.ADMIN_I18N?.t('js.admin.068') ?? 'Đã lưu tiếng Việt nhưng chưa tải lại được nội dung. Hãy tải lại để kiểm tra.'), tone: 'error' };
    }, id, { buttonId: 'save-vi', busyLabel: (window.ADMIN_I18N?.t('js.admin.069') ?? 'Đang lưu...'), failure: (window.ADMIN_I18N?.t('js.admin.070') ?? 'Không thể lưu nội dung tiếng Việt. Vui lòng thử lại.') });
  }

  function translate() {
    if (mutating || !selectedPoi || !contentReady) return;
    if (!hasText(sourceLanguage) || viDirty()) { contentNotice((window.ADMIN_I18N?.t('js.admin.071') ?? 'Hãy lưu nội dung tiếng Việt trước khi dịch.'), 'error'); return; }
    const id = selectedPoi.id;
    mutate((window.ADMIN_I18N?.t('js.admin.072') ?? 'Đang dịch nội dung sang EN/JA/KO...'), async () => {
      const translated = await requestJson(`${poiUrl(id)}/translations`, { method: 'POST', body: { targetLanguages: targets }, scope: 'translation', timeout: 70000 });
      if (disposed) return null;
      const refreshed = await loadContent();
      await loadPois();
      if (!refreshed) return { text: (window.ADMIN_I18N?.t('js.admin.073') ?? 'Đã gửi yêu cầu dịch nhưng chưa tải lại được nội dung. Hãy tải lại để kiểm tra.'), tone: 'error' };
      const confirmed = targets.filter((language) => typeof translated?.translations?.[language]?.text === 'string'
        && translated.translations[language].text.trim() && narrations[language]?.text === translated.translations[language].text);
      return confirmed.length === targets.length && translated?.poiId === id
        ? { text: (window.ADMIN_I18N?.t('js.admin.074') ?? 'Đã dịch và tải nội dung EN/JA/KO thành công.'), tone: 'success' }
        : { text: (window.ADMIN_I18N?.t('js.admin.075', [confirmed.length, targets.length]) ?? `Đã xác nhận ${confirmed.length}/${targets.length} bản dịch EN/JA/KO. Hãy tải lại và kiểm tra các ngôn ngữ còn thiếu.`), tone: 'error' };
    }, id, { buttonId: 'translate', busyLabel: (window.ADMIN_I18N?.t('js.admin.076') ?? 'Đang dịch...'), failure: (window.ADMIN_I18N?.t('js.admin.077') ?? 'Không thể hoàn tất dịch nội dung. Vui lòng kiểm tra và thử lại.') });
  }

  async function generateAllAudio() {
    if (mutating || !selectedPoi || !contentReady || viDirty()) {
      if (viDirty()) contentNotice((window.ADMIN_I18N?.t('js.admin.078') ?? 'Hãy lưu nội dung tiếng Việt trước khi tạo audio.'), 'error');
      return;
    }
    const id = selectedPoi.id;
    const revision = selectionRevision;
    mutating = true;
    const audioButton = byId('generate-all-audio');
    const originalAudioLabel = audioButton.textContent;
    audioButton.textContent = (window.ADMIN_I18N?.t('js.admin.079') ?? 'Đang tạo audio...');
    stopPreview();
    byId('content-panel').setAttribute('aria-busy', 'true');
    updateControls();
    try {
      contentNotice((window.ADMIN_I18N?.t('js.admin.080') ?? 'Đang tạo audio cho 4 ngôn ngữ...'));
      if (!await loadContent() || disposed || revision !== selectionRevision || selectedPoi?.id !== id) {
        if (!disposed) contentNotice((window.ADMIN_I18N?.t('js.admin.081') ?? 'Không thể hoàn tất tạo audio. Vui lòng kiểm tra và thử lại. Chưa kiểm tra được nội dung mới nhất.'), 'error');
        return;
      }
      byId('content-panel').setAttribute('aria-busy', 'true');
      const missing = languages.filter((language) => !hasText(language));
      if (missing.length) {
        contentNotice((window.ADMIN_I18N?.t('js.admin.082', [missing.map((language) => language.toUpperCase()).join(', ')]) ?? `Thiếu nội dung đã lưu: ${missing.map((language) => language.toUpperCase()).join(', ')}. Hãy lưu hoặc dịch nội dung trước khi tạo audio.`), 'error');
        return;
      }
      const pending = languages.filter((language) => !validAudioUrl(narrations[language]?.audioUrl));
      if (!pending.length) {
        contentNotice((window.ADMIN_I18N?.t('js.admin.083') ?? 'Audio của cả 4 ngôn ngữ đã có. Bấm “Nghe” để nghe thử.'), 'success');
        return;
      }
      const expectedTexts = Object.fromEntries(languages.map((language) => [language, narrations[language].text]));
      const completed = languages.filter((language) => !pending.includes(language));
      const failed = [];
      let processed = completed.length;
      let changed = false;
      let accessError = null;
      for (const language of pending) {
        if (disposed || revision !== selectionRevision || selectedPoi?.id !== id) return;
        contentNotice((window.ADMIN_I18N?.t('js.admin.084', [processed, languages.length, languageNames[language]]) ?? `Đang tạo audio: ${processed}/${languages.length} · ${languageNames[language]}…`));
        try {
          const result = await requestJson(`${poiUrl(id)}/narrations/${language}/audio`,
            { method: 'POST', scope: 'audio', timeout: 130000 });
          if (disposed || revision !== selectionRevision || selectedPoi?.id !== id) return;
          if (result?.poiId !== id || result.language !== language || result.text !== expectedTexts[language]
            || !validAudioUrl(result.audioUrl)) throw safeError((window.ADMIN_I18N?.t('js.admin.085') ?? 'Metadata audio không hợp lệ. Hãy tải lại nội dung.'), 409);
          narrations[language] = result;
          completed.push(language);
          renderNarrations();
        } catch (error) {
          if (disposed) return;
          failed.push(language);
          if (error.statusCode === 401 || error.statusCode === 403) { accessError = error; break; }
          if (error.statusCode === 404 || error.statusCode === 409) { changed = true; break; }
        }
        processed++;
        contentNotice((window.ADMIN_I18N?.t('js.admin.086', [processed, languages.length]) ?? `Đang tạo audio: ${processed}/${languages.length}`));
      }
      if (disposed || revision !== selectionRevision || selectedPoi?.id !== id) return;
      if (accessError) contentNotice((window.ADMIN_I18N?.t('js.admin.087', [accessError.message]) ?? `Không thể hoàn tất tạo audio. Vui lòng kiểm tra và thử lại. ${accessError.message}`), 'error');
      else if (changed) {
        await loadContent();
        contentNotice((window.ADMIN_I18N?.t('js.admin.088') ?? 'Nội dung hoặc POI đã thay đổi trong lúc tạo audio. Đã tải lại trạng thái; hãy kiểm tra rồi thử lại.'), 'error');
      } else {
        const success = completed.map((language) => language.toUpperCase()).join(', ');
        const errors = failed.map((language) => language.toUpperCase()).join(', ');
        contentNotice(errors
          ? (window.ADMIN_I18N?.t('js.admin.089', [completed.length, languages.length, success || (window.ADMIN_I18N?.t('js.admin.090') ?? 'chưa có'), failed.length, languages.length, errors]) ?? `Không thể hoàn tất tạo audio. Vui lòng kiểm tra và thử lại. Audio sẵn sàng ${completed.length}/${languages.length}: ${success || 'chưa có'}. Tạo thất bại ${failed.length}/${languages.length}: ${errors}. Bấm lại để thử những ngôn ngữ chưa có audio.`)
          : (window.ADMIN_I18N?.t('js.admin.091') ?? 'Đã tạo audio 4 ngôn ngữ thành công.'), errors ? 'error' : 'success');
      }
    } finally {
      if (!disposed) {
        mutating = false;
        audioButton.textContent = originalAudioLabel;
        byId('content-panel').setAttribute('aria-busy', 'false');
        updateControls();
      }
    }
  }

  async function listen(language) {
    if (mutating || !contentReady || !validAudioUrl(narrations[language]?.audioUrl)) return;
    stopPreview();
    const revision = previewRevision;
    const audio = byId('preview-audio');
    audio.setAttribute('src', narrations[language].audioUrl.replace('/audio/', '/api/admin/audio/'));
    audio.hidden = false;
    message('preview-status', (window.ADMIN_I18N?.t('js.admin.092', [languageNames[language]]) ?? `Đang nghe thử ${languageNames[language]}.`), 'success');
    try { await audio.play(); }
    catch { if (!disposed && revision === previewRevision) message('preview-status', (window.ADMIN_I18N?.t('js.admin.093') ?? 'Chưa thể phát audio. Hãy bấm Play trên trình phát để thử lại.'), 'error'); }
  }

  for (const language of languages) {
    const element = byId('language-template').content.firstElementChild.cloneNode(true);
    const card = {
      element,
      text: element.querySelector('.language-text'), textStatus: element.querySelector('.text-status'),
      audioStatus: element.querySelector('.audio-status'), listen: element.querySelector('.listen-audio'),
    };
    element.querySelector('.language-name').textContent = `${language.toUpperCase()} · ${languageNames[language]}`;
    card.text.setAttribute('lang', language);
    card.listen.setAttribute('aria-label', `Nghe ${languageNames[language]}`);
    card.listen.addEventListener('click', () => listen(language));
    cards.set(language, card);
    byId('language-cards').append(element);
    byId(`language-tab-${language}`).addEventListener('click', () => changeLanguage(language));
  }
  showLanguage(sourceLanguage);
  byId('poi-search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    poiFilters = { search: byId('poi-search').value.trim(), status: byId('poi-status-filter').value || 'all',
      category: byId('poi-category-filter').value || 'all' };
    poiPage = 1;
    renderPoiPage();
  });
  byId('poi-search-reset').addEventListener('click', () => {
    byId('poi-search').value = '';
    byId('poi-status-filter').value = 'all';
    byId('poi-category-filter').value = 'all';
    poiFilters = { search: '', status: 'all', category: 'all' };
    poiPage = 1;
    renderPoiPage();
  });
  byId('poi-prev').addEventListener('click', () => { if (poiPage > 1) { poiPage--; renderPoiPage(); } });
  byId('poi-next').addEventListener('click', () => { poiPage++; renderPoiPage(); });
  byId('new-poi').addEventListener('click', newPoi);
  byId('cancel-edit').addEventListener('click', () => {
    if (!mutating && (!selectedPoi || !viDirty() || window.confirm((window.ADMIN_I18N?.t('js.admin.094') ?? 'Nội dung tiếng Việt chưa lưu. Đóng và bỏ bản nháp?')))) clearSelection();
  });
  byId('reload-pois').addEventListener('click', () => { if (!mutating && !listLoading) loadPois(); });
  byId('poi-form').addEventListener('submit', savePoi);
  byId('poi-category').addEventListener('input', renderCategoryFormLabel);
  byId('delete-selected').addEventListener('click', () => deletePoi(selectedPoi));

byId('poi-delete-cancel').addEventListener('click', () => {
  closeDeletePoiModal();
});

byId('poi-delete-confirm').addEventListener('click', () => {
  confirmDeletePoi();
});

byId('poi-delete-modal').addEventListener('click', (event) => {
  if (event.target === byId('poi-delete-modal')) {
    closeDeletePoiModal();
  }
});

document.addEventListener('keydown', (event) => {
  const modal = byId('poi-delete-modal');

  if (modal.hidden) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeDeletePoiModal();
  }

  if (event.key === 'Tab') {
    const cancel = byId('poi-delete-cancel');
    const confirm = byId('poi-delete-confirm');

    if (event.shiftKey && document.activeElement === cancel) {
      event.preventDefault();
      confirm.focus();
    } else if (!event.shiftKey && document.activeElement === confirm) {
      event.preventDefault();
      cancel.focus();
    }
  }
});

  byId('vi-form').addEventListener('submit', saveVietnamese);
  byId('translate').addEventListener('click', translate);
  byId('generate-all-audio').addEventListener('click', generateAllAudio);
  byId('dismiss-content-action').addEventListener('click', clearContentNotice);
  byId('reload-content').addEventListener('click', () => { if (!mutating && !contentLoading && !viDirty()) loadContent(); });
  byId('vi-text').addEventListener('input', () => {
    message('draft-status', viDirty() ? (window.ADMIN_I18N?.t('js.admin.056') ?? 'Có nội dung VI chưa lưu. Hãy lưu trước khi dịch hoặc tạo audio.') : '');
    updateControls();
  });
  byId('preview-audio').addEventListener('error', () => {
    if (byId('preview-audio').getAttribute('src')) message('preview-status', (window.ADMIN_I18N?.t('js.admin.095') ?? 'Không tải được audio. Hãy tải lại nội dung hoặc tạo lại audio.'), 'error');
  });
  window.ADMIN_I18N?.onChange(() => {
    const translate = window.ADMIN_I18N.t;
    updateDeletePoiModalText();
    const allCategory = byId('poi-category-filter').children[0];
    if (allCategory) allCategory.textContent = translate('html.admin.020');
    for (const option of [...byId('poi-category-filter').children].slice(1)) option.textContent = categoryLabel(option.value);
    renderCategoryFormLabel();
    if (!listLoading) renderPoiPage();
    if (!listLoading && adminLanguage() !== 'vi' && allPois.length
      && allPois.every((poi) => !poi.translations)) loadPois();
    renderNarrations();
    for (const card of cards.values()) card.listen.textContent = translate('html.admin.159');
    if (selectedPoi) {
      const poi = selectedPoi;
      renderSelectedPoiSummary();
      byId('poi-form-title').textContent = translate('js.admin.042', [displayPoi(poi).name]);
      byId('save-poi').textContent = translate('js.admin.043');
      const legacy = byId('poi-legacy-address');
      if (!legacy.hidden) legacy.textContent = translate('js.admin.032', [poi.address]);
    } else if (mode === 'new') {
      byId('poi-form-title').textContent = translate('js.admin.045');
      byId('selected-id').textContent = translate('js.admin.046');
      byId('save-poi').textContent = translate('js.admin.047');
      message('action-status', translate('js.admin.048'));
    } else message('selection-status', translate('js.admin.020'));
    message('draft-status', viDirty() && mode === 'edit' ? translate('js.admin.056') : '');
    if (contentLoading) message('content-status', translate('js.admin.033'));
    else if (contentReady) message('content-status', translate('js.admin.035', [languages.filter(hasText).length,
      languages.length, languages.filter((code) => validAudioUrl(narrations[code]?.audioUrl)).length, languages.length]));
    if (byId('preview-audio').hidden) message('preview-status', translate('js.admin.013'));
    clearContentNotice();
  });
  window.addEventListener('pagehide', () => {
    disposed = true;
    clearTimeout(translationRefreshTimer);
    clearContentNotice();
    listController?.abort();
    selectionController?.abort();
    contentController?.abort();
    for (const controller of controllers) controller.abort();
    stopPreview();
  });
  auth.onLost(() => {
    disposed = true;
    clearTimeout(translationRefreshTimer);
    clearContentNotice();
    for (const controller of controllers) controller.abort();
    stopPreview();
  });
  renderNarrations();
  auth.ready.then((user) => { if (user && !disposed) loadPois(); });
})();
