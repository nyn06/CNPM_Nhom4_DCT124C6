(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const auth = window.ADMIN_AUTH;
  const { sourceLanguage, names: languageNames } = window.POI_LANGUAGES;
  const languages = Object.keys(languageNames);
  const targets = languages.filter((language) => language !== sourceLanguage);
  const cards = new Map();
  const controllers = new Set();
  let rows = [];
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
    if (statusCode === 401) return safeError('Phiên quản trị đã hết hạn. Hãy đăng nhập lại.', 401);
    if (statusCode === 403) return safeError('Bạn không có quyền thực hiện thao tác hoặc CSRF token đã thay đổi. Hãy tải lại trang.', 403);
    if (statusCode === 404) return safeError('Địa điểm không còn tồn tại. Hãy tải lại danh sách và chọn địa điểm khác.', 404);
    if (statusCode === 409) return safeError('Nội dung đã thay đổi trong lúc xử lý. Hãy tải lại nội dung rồi thử lại.', 409);
    if (statusCode === 400) return safeError('Dữ liệu chưa hợp lệ. Kiểm tra các trường bắt buộc, tọa độ và nội dung tiếng Việt đã lưu.', 400);
    if (scope === 'translation') return safeError(statusCode === 504
      ? 'Dịch vụ dịch quá thời gian chờ. Chưa lưu bản dịch mới; hãy thử lại.'
      : 'Chưa dịch được nội dung. Kiểm tra dịch vụ dịch và cấu hình server rồi thử lại.', statusCode);
    if (scope === 'audio') return safeError('Không tạo được audio. Kiểm tra cấu hình Piper trên server rồi thử lại.', statusCode);
    return safeError('Server chưa xử lý được yêu cầu. Hãy thử tải lại hoặc thực hiện lại sau.', statusCode);
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
      try { return await response.json(); } catch { throw safeError('Phản hồi từ server không hợp lệ. Hãy tải lại và thử lại.'); }
    } catch (error) {
      if (error.safe) throw error;
      throw safeError(controller.signal.aborted
        ? 'Yêu cầu đã hết thời gian chờ. Hãy kiểm tra server hoặc dịch vụ rồi thử lại.'
        : 'Không kết nối được backend. Hãy kiểm tra server và kết nối mạng.');
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
    message('preview-status', 'Chọn “Nghe” ở một ngôn ngữ để nghe thử.');
  }

  function renderNarrations() {
    for (const [language, card] of cards) {
      const narration = narrations[language];
      const textExists = hasText(language);
      const audioExists = textExists && validAudioUrl(narration.audioUrl);
      card.text.textContent = textExists ? narration.text : '';
      card.text.hidden = !textExists;
      card.textStatus.textContent = textExists ? 'Đã có nội dung' : 'Chưa có nội dung';
      card.audioStatus.textContent = audioExists ? 'Có audio · Sẵn sàng nghe thử'
        : narration?.audioUrl ? 'Đường dẫn audio không hợp lệ.' : 'Chưa có audio';
      card.audioStatus.dataset.tone = audioExists ? 'success' : narration?.audioUrl ? 'error' : 'neutral';
      card.listen.hidden = !audioExists;
    }
    updateControls();
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
    mode = 'idle';
    selectionLoading = false;
    contentLoading = false;
    contentReady = false;
    byId('vi-text').value = '';
    byId('poi-panel').hidden = true;
    window.ADMIN_POI_MAP.clear();
    byId('content-panel').hidden = true;
    byId('selection-status').hidden = false;
    byId('poi-panel').setAttribute('aria-busy', 'false');
    byId('content-panel').setAttribute('aria-busy', 'false');
    message('selection-status', 'Chọn “Quản lý” trong danh sách để mở địa điểm.');
    stopPreview();
    renderNarrations();
    markSelectedRow();
  }

  function markSelectedRow() {
    for (const row of rows) row.element.dataset.selected = String(row.id === selectedPoi?.id);
  }

  function renderPois(pois) {
    byId('poi-rows').replaceChildren();
    rows = pois.map((poi) => {
      const row = byId('poi-row-template').content.firstElementChild.cloneNode(true);
      row.querySelector('.row-name').textContent = poi.name;
      row.querySelector('.row-category').textContent = poi.category;
      const badge = row.querySelector('.row-active');
      badge.textContent = poi.isActive ? 'Hoạt động' : 'Tạm dừng';
      badge.dataset.tone = poi.isActive ? 'success' : 'neutral';
      const manage = row.querySelector('.row-manage');
      const remove = row.querySelector('.row-delete');
      manage.setAttribute('aria-label', `Quản lý ${poi.name}`);
      remove.setAttribute('aria-label', `Xóa ${poi.name}`);
      manage.addEventListener('click', () => { if (!mutating) selectPoi(poi.id); });
      remove.addEventListener('click', () => deletePoi(poi));
      byId('poi-rows').append(row);
      return { id: poi.id, element: row, manage, remove };
    });
    byId('poi-count').textContent = `${pois.length} địa điểm · ${pois.filter((poi) => poi.isActive).length} đang hoạt động`;
    message('list-status', pois.length ? 'Chọn địa điểm để quản lý nội dung.' : 'Chưa có địa điểm. Bấm “+ Thêm địa điểm” để tạo địa điểm đầu tiên.');
    markSelectedRow();
    updateControls();
  }

  async function loadPois() {
    const revision = ++listRevision;
    listController?.abort();
    const controller = new AbortController();
    listController = controller;
    listLoading = true;
    byId('poi-rows').setAttribute('aria-busy', 'true');
    message('list-status', 'Đang tải danh sách POI…');
    updateControls();
    try {
      const pois = await requestJson('/api/pois', { controller });
      if (disposed || revision !== listRevision) return false;
      if (!Array.isArray(pois) || pois.some((poi) => !poi || typeof poi.id !== 'string' || typeof poi.name !== 'string')) {
        throw safeError('Danh sách POI không hợp lệ. Hãy thử tải lại.');
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

  function fillPoiForm(poi) {
    for (const [field, key] of [['name', 'name'], ['description', 'description'], ['category', 'category'],
      ['street-address', 'streetAddress'], ['ward', 'ward'], ['city', 'city'], ['radius', 'geofenceRadius']]) {
      byId(`poi-${field}`).value = String(poi[key] ?? '');
      byId(`poi-${field}`).setAttribute('aria-invalid', 'false');
    }
    const legacyAddress = byId('poi-legacy-address');
    legacyAddress.hidden = !poi.address || !!(poi.streetAddress || poi.ward || poi.city);
    legacyAddress.textContent = legacyAddress.hidden ? '' : `Địa chỉ đã lưu: ${poi.address}`;
    byId('poi-active').checked = poi.isActive === true;
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
    message('content-status', 'Đang tải nội dung và kiểm tra audio…');
    message('draft-status', '');
    try {
      const all = await requestJson(`${poiUrl(id)}/narrations`, { controller });
      if (disposed || revision !== contentRevision) return false;
      if (all?.poiId !== id || !all.narrations || typeof all.narrations !== 'object' || Array.isArray(all.narrations)) {
        throw safeError('Nội dung trả về không hợp lệ. Hãy thử tải lại.');
      }
      // GET all không có audioUrl. Lấy metadata từ GET từng ngôn ngữ, không đoán tên WAV.
      const entries = await Promise.all(languages.map(async (language) => {
        if (!all.narrations[language]?.text) return [language, null];
        let data;
        try { data = await requestJson(`${poiUrl(id)}/narrations/${language}`, { controller }); }
        catch (error) { if (error.statusCode === 404) return [language, null]; throw error; }
        if (data?.poiId !== id || data.language !== language || typeof data.text !== 'string' || !data.text.trim()) {
          throw safeError('Nội dung trả về không hợp lệ. Hãy thử tải lại.');
        }
        return [language, data];
      }));
      if (disposed || revision !== contentRevision) return false;
      narrations = Object.fromEntries(entries.filter(([, data]) => data));
      contentReady = true;
      byId('vi-text').value = narrations[sourceLanguage]?.text || '';
      byId('vi-text').setAttribute('aria-invalid', 'false');
      renderNarrations();
      message('content-status', `Đã tải ${languages.filter(hasText).length}/${languages.length} nội dung · ${languages.filter((code) => validAudioUrl(narrations[code]?.audioUrl)).length}/${languages.length} audio.`);
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

  async function selectPoi(id) {
    clearSelection();
    const revision = selectionRevision;
    const controller = new AbortController();
    selectionController = controller;
    selectionLoading = true;
    message('selection-status', 'Đang mở địa điểm…');
    updateControls();
    try {
      const poi = await requestJson(poiUrl(id), { controller });
      if (disposed || revision !== selectionRevision) return false;
      if (poi?.id !== id || typeof poi.name !== 'string') throw safeError('Thông tin POI không hợp lệ. Hãy tải lại danh sách.');
      selectedPoi = poi;
      mode = 'edit';
      fillPoiForm(poi);
      byId('poi-form-title').textContent = `Thông tin ${poi.name}`;
      byId('selected-id').textContent = `POI: ${poi.id}`;
      byId('save-poi').textContent = 'Lưu thay đổi';
      byId('delete-selected').hidden = false;
      byId('poi-panel').hidden = false;
      byId('content-panel').hidden = false;
      byId('selection-status').hidden = true;
      window.ADMIN_POI_MAP.load(poi);
      markSelectedRow();
      return await loadContent();
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
    clearSelection();
    mode = 'new';
    fillPoiForm({ category: 'food', geofenceRadius: 50, isActive: true });
    byId('poi-form-title').textContent = 'Thêm địa điểm mới';
    byId('selected-id').textContent = 'Lưu địa điểm để bắt đầu chuẩn bị thuyết minh.';
    byId('save-poi').textContent = 'Tạo địa điểm';
    byId('delete-selected').hidden = true;
    byId('poi-panel').hidden = false;
    byId('selection-status').hidden = true;
    window.ADMIN_POI_MAP.load(null);
    message('action-status', 'Đang thêm địa điểm mới.');
    updateControls();
    byId('poi-name').focus();
  }

  function readPoiForm() {
    const data = { isActive: byId('poi-active').checked };
    for (const field of ['name', 'description', 'category']) {
      const input = byId(`poi-${field}`);
      data[field] = input.value.trim();
      const invalid = !data[field];
      input.setAttribute('aria-invalid', String(invalid));
      if (invalid) { input.focus(); throw safeError('Tên, mô tả và loại địa điểm không được để trống.'); }
    }
    for (const [field, key] of [['street-address', 'streetAddress'], ['ward', 'ward'], ['city', 'city']]) {
      data[key] = byId(`poi-${field}`).value.trim();
    }
    data.address = [data.streetAddress, data.ward, data.city].filter(Boolean).join(', ') || selectedPoi?.address || '';
    const location = window.ADMIN_POI_MAP.location();
    if (!location) throw safeError('Đặt ghim và xác nhận vị trí trước khi lưu.');
    Object.assign(data, location);
    for (const [field, key, min, max] of [['radius', 'geofenceRadius', 0, Infinity]]) {
      const input = byId(`poi-${field}`);
      const value = input.value.trim();
      const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : NaN;
      const invalid = !Number.isFinite(number) || number < min || number > max || (key === 'geofenceRadius' && number <= 0);
      input.setAttribute('aria-invalid', String(invalid));
      if (invalid) { input.focus(); throw safeError('Bán kính phải là số lớn hơn 0.'); }
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
      const detail = error.safe ? error.message : 'Chưa hoàn tất thao tác. Hãy tải lại và thử lại.';
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
    const viDraft = id && viDirty() ? byId('vi-text').value : null;
    mutate(id ? 'Đang lưu thay đổi…' : 'Đang tạo địa điểm…', async () => {
      const poi = await requestJson(id ? poiUrl(id) : '/api/pois', { method: id ? 'PUT' : 'POST', body });
      if (disposed) return '';
      if (typeof poi?.id !== 'string') throw safeError('Địa điểm đã lưu nhưng phản hồi không hợp lệ. Hãy tải lại danh sách.');
      await loadPois();
      const refreshed = await selectPoi(poi.id);
      if (viDraft !== null && selectedPoi?.id === id) {
        byId('vi-text').value = viDraft;
        message('draft-status', 'Có nội dung VI chưa lưu. Hãy lưu trước khi dịch hoặc tạo audio.');
        updateControls();
      }
      return `${id ? 'Đã lưu thay đổi địa điểm.' : 'Đã tạo địa điểm.'}${refreshed ? ' Địa điểm đã được mở để quản lý.' : ' Bấm tải lại để kiểm tra nội dung.'}`;
    }, id);
  }

  function deletePoi(poi) {
    if (mutating || disposed || !poi) return;
    if (!window.confirm(`Xóa POI “${poi.name}” và nội dung thuyết minh của điểm này? Thao tác không thể hoàn tác.`)) return;
    mutate('Đang xóa địa điểm…', async () => {
      await requestJson(poiUrl(poi.id), { method: 'DELETE' });
      if (disposed) return '';
      if (selectedPoi?.id === poi.id) clearSelection();
      await loadPois();
      return 'Đã xóa POI.';
    }, poi.id);
  }

  function saveVietnamese(event) {
    event.preventDefault();
    if (mutating || !selectedPoi || !contentReady) return;
    const text = byId('vi-text').value.trim();
    if (!text) { byId('vi-text').setAttribute('aria-invalid', 'true'); contentNotice('Nhập nội dung tiếng Việt trước khi lưu.', 'error'); return; }
    const id = selectedPoi.id;
    mutate('Đang lưu nội dung tiếng Việt…', async () => {
      const saved = await requestJson(`${poiUrl(id)}/narrations/${sourceLanguage}`, { method: 'PUT', body: { text } });
      if (saved?.poiId !== id || saved.language !== sourceLanguage || saved.text !== text) {
        throw safeError('Phản hồi lưu nội dung chưa được xác nhận. Hãy tải lại để kiểm tra.');
      }
      if (disposed) return null;
      const refreshed = await loadContent();
      await loadPois();
      return refreshed
        ? { text: 'Đã lưu nội dung tiếng Việt thành công.', tone: 'success' }
        : { text: 'Đã lưu tiếng Việt nhưng chưa tải lại được nội dung. Hãy tải lại để kiểm tra.', tone: 'error' };
    }, id, { buttonId: 'save-vi', busyLabel: 'Đang lưu...', failure: 'Không thể lưu nội dung tiếng Việt. Vui lòng thử lại.' });
  }

  function translate() {
    if (mutating || !selectedPoi || !contentReady) return;
    if (!hasText(sourceLanguage) || viDirty()) { contentNotice('Hãy lưu nội dung tiếng Việt trước khi dịch.', 'error'); return; }
    const id = selectedPoi.id;
    mutate('Đang dịch nội dung sang EN/JA/KO...', async () => {
      const translated = await requestJson(`${poiUrl(id)}/translations`, { method: 'POST', body: { targetLanguages: targets }, scope: 'translation', timeout: 70000 });
      if (disposed) return null;
      const refreshed = await loadContent();
      await loadPois();
      if (!refreshed) return { text: 'Đã gửi yêu cầu dịch nhưng chưa tải lại được nội dung. Hãy tải lại để kiểm tra.', tone: 'error' };
      const confirmed = targets.filter((language) => typeof translated?.translations?.[language]?.text === 'string'
        && translated.translations[language].text.trim() && narrations[language]?.text === translated.translations[language].text);
      return confirmed.length === targets.length && translated?.poiId === id
        ? { text: 'Đã dịch và tải nội dung EN/JA/KO thành công.', tone: 'success' }
        : { text: `Đã xác nhận ${confirmed.length}/${targets.length} bản dịch EN/JA/KO. Hãy tải lại và kiểm tra các ngôn ngữ còn thiếu.`, tone: 'error' };
    }, id, { buttonId: 'translate', busyLabel: 'Đang dịch...', failure: 'Không thể hoàn tất dịch nội dung. Vui lòng kiểm tra và thử lại.' });
  }

  async function generateAllAudio() {
    if (mutating || !selectedPoi || !contentReady || viDirty()) {
      if (viDirty()) contentNotice('Hãy lưu nội dung tiếng Việt trước khi tạo audio.', 'error');
      return;
    }
    const id = selectedPoi.id;
    const revision = selectionRevision;
    mutating = true;
    const audioButton = byId('generate-all-audio');
    const originalAudioLabel = audioButton.textContent;
    audioButton.textContent = 'Đang tạo audio...';
    stopPreview();
    byId('content-panel').setAttribute('aria-busy', 'true');
    updateControls();
    try {
      contentNotice('Đang tạo audio cho 4 ngôn ngữ...');
      if (!await loadContent() || disposed || revision !== selectionRevision || selectedPoi?.id !== id) {
        if (!disposed) contentNotice('Không thể hoàn tất tạo audio. Vui lòng kiểm tra và thử lại. Chưa kiểm tra được nội dung mới nhất.', 'error');
        return;
      }
      byId('content-panel').setAttribute('aria-busy', 'true');
      const missing = languages.filter((language) => !hasText(language));
      if (missing.length) {
        contentNotice(`Thiếu nội dung đã lưu: ${missing.map((language) => language.toUpperCase()).join(', ')}. Hãy lưu hoặc dịch nội dung trước khi tạo audio.`, 'error');
        return;
      }
      const pending = languages.filter((language) => !validAudioUrl(narrations[language]?.audioUrl));
      if (!pending.length) {
        contentNotice('Audio của cả 4 ngôn ngữ đã có. Bấm “Nghe” để nghe thử.', 'success');
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
        contentNotice(`Đang tạo audio: ${processed}/${languages.length} · ${languageNames[language]}…`);
        try {
          const result = await requestJson(`${poiUrl(id)}/narrations/${language}/audio`,
            { method: 'POST', scope: 'audio', timeout: 130000 });
          if (disposed || revision !== selectionRevision || selectedPoi?.id !== id) return;
          if (result?.poiId !== id || result.language !== language || result.text !== expectedTexts[language]
            || !validAudioUrl(result.audioUrl)) throw safeError('Metadata audio không hợp lệ. Hãy tải lại nội dung.', 409);
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
        contentNotice(`Đang tạo audio: ${processed}/${languages.length}`);
      }
      if (disposed || revision !== selectionRevision || selectedPoi?.id !== id) return;
      if (accessError) contentNotice(`Không thể hoàn tất tạo audio. Vui lòng kiểm tra và thử lại. ${accessError.message}`, 'error');
      else if (changed) {
        await loadContent();
        contentNotice('Nội dung hoặc POI đã thay đổi trong lúc tạo audio. Đã tải lại trạng thái; hãy kiểm tra rồi thử lại.', 'error');
      } else {
        const success = completed.map((language) => language.toUpperCase()).join(', ');
        const errors = failed.map((language) => language.toUpperCase()).join(', ');
        contentNotice(errors
          ? `Không thể hoàn tất tạo audio. Vui lòng kiểm tra và thử lại. Audio sẵn sàng ${completed.length}/${languages.length}: ${success || 'chưa có'}. Tạo thất bại ${failed.length}/${languages.length}: ${errors}. Bấm lại để thử những ngôn ngữ chưa có audio.`
          : 'Đã tạo audio 4 ngôn ngữ thành công.', errors ? 'error' : 'success');
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
    message('preview-status', `Đang nghe thử ${languageNames[language]}.`, 'success');
    try { await audio.play(); }
    catch { if (!disposed && revision === previewRevision) message('preview-status', 'Chưa thể phát audio. Hãy bấm Play trên trình phát để thử lại.', 'error'); }
  }

  for (const language of languages) {
    const element = byId('language-template').content.firstElementChild.cloneNode(true);
    const card = {
      text: element.querySelector('.language-text'), textStatus: element.querySelector('.text-status'),
      audioStatus: element.querySelector('.audio-status'), listen: element.querySelector('.listen-audio'),
    };
    element.querySelector('.language-name').textContent = `${language.toUpperCase()} · ${languageNames[language]}`;
    card.text.setAttribute('lang', language);
    card.listen.setAttribute('aria-label', `Nghe ${languageNames[language]}`);
    card.listen.addEventListener('click', () => listen(language));
    cards.set(language, card);
    byId('language-cards').append(element);
  }
  byId('new-poi').addEventListener('click', newPoi);
  byId('cancel-edit').addEventListener('click', () => { if (!mutating) clearSelection(); });
  byId('reload-pois').addEventListener('click', () => { if (!mutating && !listLoading) loadPois(); });
  byId('poi-form').addEventListener('submit', savePoi);
  byId('delete-selected').addEventListener('click', () => deletePoi(selectedPoi));
  byId('vi-form').addEventListener('submit', saveVietnamese);
  byId('translate').addEventListener('click', translate);
  byId('generate-all-audio').addEventListener('click', generateAllAudio);
  byId('dismiss-content-action').addEventListener('click', clearContentNotice);
  byId('reload-content').addEventListener('click', () => { if (!mutating && !contentLoading && !viDirty()) loadContent(); });
  byId('vi-text').addEventListener('input', () => {
    message('draft-status', viDirty() ? 'Có nội dung VI chưa lưu. Hãy lưu trước khi dịch hoặc tạo audio.' : '');
    updateControls();
  });
  byId('preview-audio').addEventListener('error', () => {
    if (byId('preview-audio').getAttribute('src')) message('preview-status', 'Không tải được audio. Hãy tải lại nội dung hoặc tạo lại audio.', 'error');
  });
  window.addEventListener('pagehide', () => {
    disposed = true;
    clearContentNotice();
    listController?.abort();
    selectionController?.abort();
    contentController?.abort();
    for (const controller of controllers) controller.abort();
    stopPreview();
  });
  auth.onLost(() => {
    disposed = true;
    clearContentNotice();
    for (const controller of controllers) controller.abort();
    stopPreview();
  });
  renderNarrations();
  auth.ready.then((user) => { if (user && !disposed) loadPois(); });
})();
