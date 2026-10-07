(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
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

  function message(id, text, tone = 'neutral') {
    byId(id).textContent = text;
    byId(id).dataset.tone = tone;
  }

  function safeError(text, statusCode) {
    return Object.assign(new Error(text), { safe: true, statusCode });
  }

  function apiError(statusCode, scope) {
    if (statusCode === 404) return safeError('POI không còn tồn tại. Hãy tải lại danh sách và chọn địa điểm khác.', 404);
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
      const response = await fetch(url, {
        method, signal: controller.signal,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
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
    byId('reload-content').disabled = blocked || contentLoading || !selectedPoi || viDirty();
    for (const row of rows) {
      row.manage.disabled = mutating;
      row.remove.disabled = mutating;
    }
    for (const [language, card] of cards) {
      card.generate.disabled = blocked || !contentReady || !hasText(language) || viDirty();
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
      card.generate.textContent = audioExists ? 'Tạo lại audio' : 'Tạo audio';
    }
    updateControls();
  }

  function clearSelection() {
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
    message('list-status', pois.length ? 'Chọn địa điểm để quản lý nội dung.' : 'Chưa có POI. Bấm “+ Thêm POI” để tạo địa điểm đầu tiên.');
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
      ['address', 'address'], ['latitude', 'latitude'], ['longitude', 'longitude'], ['radius', 'geofenceRadius']]) {
      byId(`poi-${field}`).value = String(poi[key] ?? '');
      byId(`poi-${field}`).setAttribute('aria-invalid', 'false');
    }
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
    byId('save-poi').textContent = 'Tạo POI';
    byId('delete-selected').hidden = true;
    byId('poi-panel').hidden = false;
    byId('selection-status').hidden = true;
    message('action-status', 'Nhập thông tin và tọa độ của địa điểm mới.');
    updateControls();
    byId('poi-name').focus();
  }

  function readPoiForm() {
    const data = { isActive: byId('poi-active').checked };
    for (const field of ['name', 'description', 'category', 'address']) {
      const input = byId(`poi-${field}`);
      data[field] = input.value.trim();
      const invalid = field !== 'address' && !data[field];
      input.setAttribute('aria-invalid', String(invalid));
      if (invalid) { input.focus(); throw safeError('Tên, mô tả và loại địa điểm không được để trống.'); }
    }
    for (const [field, key, min, max] of [['latitude', 'latitude', -90, 90], ['longitude', 'longitude', -180, 180], ['radius', 'geofenceRadius', 0, Infinity]]) {
      const input = byId(`poi-${field}`);
      const value = input.value.trim();
      const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : NaN;
      const invalid = !Number.isFinite(number) || number < min || number > max || (key === 'geofenceRadius' && number <= 0);
      input.setAttribute('aria-invalid', String(invalid));
      if (invalid) { input.focus(); throw safeError('Latitude phải từ -90 đến 90, longitude từ -180 đến 180 và bán kính phải lớn hơn 0.'); }
      data[key] = number;
    }
    return data;
  }

  async function mutate(label, work, affectedId) {
    if (mutating || disposed) return;
    mutating = true;
    stopPreview();
    byId('poi-panel').setAttribute('aria-busy', 'true');
    message('action-status', label, 'info');
    updateControls();
    try {
      const success = await work();
      if (!disposed) message('action-status', success, 'success');
    } catch (error) {
      if (disposed) return;
      if (error.statusCode === 404) {
        if (selectedPoi?.id === affectedId) clearSelection();
        await loadPois();
      }
      message('action-status', error.safe ? error.message : 'Chưa hoàn tất thao tác. Hãy tải lại và thử lại.', 'error');
    } finally {
      if (!disposed) {
        mutating = false;
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
      return `${id ? 'Đã lưu thay đổi POI.' : 'Đã tạo POI.'}${refreshed ? ' Địa điểm đã được mở để quản lý.' : ' Bấm tải lại để kiểm tra nội dung.'}`;
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
    if (!text) { byId('vi-text').setAttribute('aria-invalid', 'true'); message('action-status', 'Nhập nội dung tiếng Việt trước khi lưu.', 'error'); return; }
    const id = selectedPoi.id;
    mutate('Đang lưu nội dung tiếng Việt…', async () => {
      await requestJson(`${poiUrl(id)}/narrations/${sourceLanguage}`, { method: 'PUT', body: { text } });
      if (disposed) return '';
      const refreshed = await loadContent();
      await loadPois();
      return refreshed ? 'Đã lưu tiếng Việt và cập nhật trạng thái bản dịch/audio theo backend.' : 'Đã lưu tiếng Việt. Bấm tải lại nội dung để kiểm tra trạng thái mới.';
    }, id);
  }

  function translate() {
    if (mutating || !selectedPoi || !contentReady) return;
    if (!hasText(sourceLanguage) || viDirty()) { message('action-status', 'Hãy lưu nội dung tiếng Việt trước khi dịch.', 'error'); return; }
    const id = selectedPoi.id;
    mutate('Đang dịch VI sang EN/JA/KO…', async () => {
      await requestJson(`${poiUrl(id)}/translations`, { method: 'POST', body: { targetLanguages: targets }, scope: 'translation', timeout: 70000 });
      if (disposed) return '';
      const refreshed = await loadContent();
      await loadPois();
      return refreshed ? 'Đã dịch và tải lại nội dung EN/JA/KO.' : 'Đã dịch. Bấm tải lại nội dung để kiểm tra kết quả.';
    }, id);
  }

  function generateAudio(language) {
    if (mutating || !selectedPoi || !contentReady) return;
    if (!hasText(language) || viDirty()) { message('action-status', 'Cần có nội dung đã lưu cho ngôn ngữ này trước khi tạo audio.', 'error'); return; }
    const id = selectedPoi.id;
    mutate(`Đang tạo audio ${languageNames[language]}…`, async () => {
      await requestJson(`${poiUrl(id)}/narrations/${language}/audio`, { method: 'POST', scope: 'audio', timeout: 130000 });
      if (disposed) return '';
      const refreshed = await loadContent();
      await loadPois();
      return refreshed ? `Đã tạo audio ${languageNames[language]}. Bấm “Nghe” để nghe thử.` : 'Đã tạo audio. Bấm tải lại nội dung để lấy metadata mới.';
    }, id);
  }

  async function listen(language) {
    if (mutating || !contentReady || !validAudioUrl(narrations[language]?.audioUrl)) return;
    stopPreview();
    const revision = previewRevision;
    const audio = byId('preview-audio');
    audio.setAttribute('src', narrations[language].audioUrl);
    audio.hidden = false;
    message('preview-status', `Đang nghe thử ${languageNames[language]}.`, 'success');
    try { await audio.play(); }
    catch { if (!disposed && revision === previewRevision) message('preview-status', 'Chưa thể phát audio. Hãy bấm Play trên trình phát để thử lại.', 'error'); }
  }

  for (const language of languages) {
    const element = byId('language-template').content.firstElementChild.cloneNode(true);
    const card = {
      text: element.querySelector('.language-text'), textStatus: element.querySelector('.text-status'),
      audioStatus: element.querySelector('.audio-status'), generate: element.querySelector('.generate-audio'), listen: element.querySelector('.listen-audio'),
    };
    element.querySelector('.language-name').textContent = `${language.toUpperCase()} · ${languageNames[language]}`;
    card.text.setAttribute('lang', language);
    card.generate.setAttribute('aria-label', `Tạo audio ${languageNames[language]}`);
    card.listen.setAttribute('aria-label', `Nghe ${languageNames[language]}`);
    card.generate.addEventListener('click', () => generateAudio(language));
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
    listController?.abort();
    selectionController?.abort();
    contentController?.abort();
    for (const controller of controllers) controller.abort();
    stopPreview();
  });
  renderNarrations();
  loadPois();
})();
