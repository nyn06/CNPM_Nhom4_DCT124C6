(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const GPS_INTERVAL_MS = 3000;
  const REQUEST_TIMEOUT_MS = 10000;
  const { sourceLanguage, names: languageNames } = window.POI_LANGUAGES;
  let watchId = null;
  let gpsActive = false;
  let gpsSession = 0;
  let gpsTimer = null;
  let pendingPosition = null;
  let lastGpsRequest = -Infinity;
  let locationRevision = 0;
  let currentLocation = null;
  let nearbyController = null;
  let nearbyRequest = 0;
  let currentPoi = null;
  let narrationController = null;
  let narrationRequest = 0;
  let narrationKey = null;

  function setMessage(id, text, tone = 'neutral') {
    const element = byId(id);
    element.textContent = text;
    element.dataset.tone = tone;
  }

  function setResult(state, title, message) {
    if (state !== 'loading') clearNarration();
    const labels = { idle: 'Chờ vị trí', loading: 'Đang kiểm tra', outside: 'Ngoài phạm vi', error: 'Chưa thể kiểm tra' };
    const panel = byId('geofence-panel');
    panel.dataset.state = state;
    panel.setAttribute('aria-busy', String(state === 'loading'));
    byId('result-empty').hidden = false;
    byId('nearest-card').hidden = true;
    byId('result-title').textContent = title;
    byId('result-message').textContent = message;
    setMessage('geofence-badge', labels[state], state === 'error' ? 'error' : 'neutral');
    byId('result-time').textContent = '—';
  }

  function displayLocation(location, source) {
    const changed = !currentLocation || currentLocation.latitude !== location.latitude
      || currentLocation.longitude !== location.longitude || currentLocation.source !== source;
    if (changed) {
      locationRevision++;
      clearNarration();
    }
    currentLocation = { ...location, source };
    byId('current-lat').textContent = location.latitude.toFixed(6);
    byId('current-lng').textContent = location.longitude.toFixed(6);
    byId('current-accuracy').textContent = Number.isFinite(location.accuracy) && location.accuracy >= 0
      ? `±${Math.round(location.accuracy)} m` : 'Không có';
    byId('current-source').textContent = source;
    return changed;
  }

  async function fetchJson(url, controller) {
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error('Phản hồi không hợp lệ. Hãy kiểm tra server và thử lại.');
      }
      if (!response.ok) {
        const error = new Error(data.error || `Yêu cầu thất bại (HTTP ${response.status}).`);
        error.statusCode = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Yêu cầu quá thời gian chờ. Hãy thử lại.');
      if (error instanceof TypeError) throw new Error('Không kết nối được Backend. Hãy kiểm tra server và kết nối mạng.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function cancelNearby() {
    nearbyRequest++;
    if (nearbyController) nearbyController.abort();
    nearbyController = null;
    byId('check-simulation').disabled = false;
  }

  function cancelNarration() {
    narrationRequest++;
    if (narrationController) narrationController.abort();
    narrationController = null;
  }

  function clearNarration() {
    cancelNarration();
    currentPoi = null;
    narrationKey = null;
    byId('narration-text').textContent = '';
    byId('narration-text').hidden = true;
    byId('retry-narration').hidden = true;
    byId('narration-panel').setAttribute('aria-busy', 'false');
    setMessage('narration-status', 'Đến một địa điểm để xem nội dung thuyết minh.');
  }

  async function loadNarration(poi, force = false) {
    const language = byId('language').value;
    const key = `${poi.id}:${language}:${poi.updatedAt || ''}`;
    currentPoi = poi;
    if (key === narrationKey && !force) return;
    cancelNarration();
    narrationKey = key;
    const requestId = narrationRequest;
    const controller = new AbortController();
    narrationController = controller;
    byId('narration-title').textContent = `Thuyết minh – ${languageNames[language]}`;
    byId('narration-panel').setAttribute('aria-busy', 'true');
    byId('narration-text').textContent = '';
    byId('narration-text').hidden = true;
    byId('retry-narration').hidden = true;
    setMessage('narration-status', 'Đang tải nội dung thuyết minh…');

    try {
      const data = await fetchJson(`/api/pois/${encodeURIComponent(poi.id)}/narrations/${encodeURIComponent(language)}`, controller);
      if (requestId !== narrationRequest) return;
      if (data.poiId !== poi.id || data.language !== language || typeof data.text !== 'string' || !data.text.trim()) {
        throw new Error('Nội dung thuyết minh trả về không hợp lệ.');
      }
      byId('narration-text').textContent = data.text;
      byId('narration-text').setAttribute('lang', language);
      byId('narration-text').hidden = false;
      setMessage('narration-status', `Nội dung của ${poi.name}`);
    } catch (error) {
      if (requestId !== narrationRequest) return;
      const missing = error.statusCode === 404;
      setMessage('narration-status', missing
        ? 'Chưa có nội dung thuyết minh cho ngôn ngữ này.' : error.message,
      missing ? 'neutral' : 'error');
      byId('retry-narration').hidden = false;
    } finally {
      if (requestId === narrationRequest) {
        narrationController = null;
        byId('narration-panel').setAttribute('aria-busy', 'false');
      }
    }
  }

  function renderNearby(data, source) {
    if (typeof data.insideGeofence !== 'boolean' || !Array.isArray(data.pois)
      || (data.insideGeofence && (!data.nearestPoi || !Number.isFinite(data.nearestPoi.distance)))) {
      throw new Error('Kết quả vị trí không hợp lệ. Hãy thử lại.');
    }

    if (!data.insideGeofence) {
      setResult('outside', 'Chưa có địa điểm nào trong phạm vi thuyết minh.',
        'Hãy tiếp tục di chuyển đến gần một địa điểm, hoặc thử một tọa độ khác.');
    } else {
      const poi = data.nearestPoi;
      byId('geofence-panel').dataset.state = 'inside';
      byId('geofence-panel').setAttribute('aria-busy', 'false');
      byId('result-empty').hidden = true;
      byId('nearest-card').hidden = false;
      setMessage('geofence-badge', 'Trong phạm vi', 'success');
      byId('nearest-name').textContent = `Đã đến ${poi.name}`;
      byId('nearest-address').textContent = poi.address || 'Chưa có địa chỉ';
      byId('nearest-description').textContent = poi.description || '';
      byId('nearest-distance').textContent = `${poi.distance.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} m`;
      byId('nearest-radius').textContent = `${poi.geofenceRadius} m`;
      byId('matched-count').textContent = data.pois.length > 1
        ? `${data.pois.length} địa điểm trong phạm vi · Đang hiển thị địa điểm gần nhất.`
        : 'Địa điểm gần nhất trong phạm vi của bạn.';
      loadNarration(poi);
    }
    byId('result-source').textContent = `Kết quả từ ${source.toLowerCase()}`;
    byId('result-time').textContent = `Cập nhật ${new Date().toLocaleTimeString('vi-VN')}`;
  }

  async function checkNearby(location, source) {
    cancelNearby();
    const requestId = nearbyRequest;
    const revision = locationRevision;
    const controller = new AbortController();
    nearbyController = controller;
    byId('check-simulation').disabled = source === 'GPS giả lập';
    setResult('loading', 'Đang tìm địa điểm quanh bạn…', 'Vị trí đang được kiểm tra. Kết quả sẽ xuất hiện tại đây.');
    byId('result-source').textContent = source;

    try {
      // Cả GPS thật và giả lập dùng cùng API; geofence do Backend quyết định.
      const query = new URLSearchParams({ lat: location.latitude, lng: location.longitude });
      const data = await fetchJson(`/api/pois/nearby?${query}`, controller);
      if (requestId !== nearbyRequest || revision !== locationRevision) return;
      renderNearby(data, source);
    } catch (error) {
      if (requestId !== nearbyRequest || revision !== locationRevision) return;
      setResult('error', 'Chưa thể kiểm tra vị trí', error.message);
    } finally {
      if (requestId === nearbyRequest) {
        nearbyController = null;
        byId('check-simulation').disabled = false;
      }
    }
  }

  function stopTracking() {
    gpsActive = false;
    gpsSession++;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    clearTimeout(gpsTimer);
    gpsTimer = null;
    pendingPosition = null;
    byId('start-gps').disabled = false;
    byId('stop-gps').disabled = true;
  }

  function stopGps() {
    stopTracking();
    cancelNearby();
    setMessage('gps-status', 'GPS đã dừng');
    setMessage('gps-message', 'Đã dừng theo dõi. Tọa độ hiển thị là vị trí nhận gần nhất.');
    setResult('idle', 'Định vị đã dừng', 'Bật lại GPS hoặc dùng vị trí giả lập để tiếp tục khám phá.');
    byId('result-source').textContent = 'Đã dừng kiểm tra GPS';
  }

  function gpsError(error) {
    stopTracking();
    cancelNearby();
    const messages = {
      1: ['GPS bị từ chối', 'Bạn chưa cho phép vị trí. Có thể cấp quyền trong trình duyệt hoặc dùng GPS giả lập.'],
      2: ['GPS không khả dụng', 'Thiết bị chưa xác định được vị trí. Hãy thử lại hoặc dùng GPS giả lập.'],
      3: ['GPS lỗi', 'Lấy vị trí quá thời gian chờ. Hãy thử lại ở nơi có tín hiệu tốt hơn.'],
    };
    const [status, message] = messages[error.code] || ['GPS lỗi', 'Không lấy được vị trí hợp lệ. Hãy thử lại hoặc dùng GPS giả lập.'];
    setMessage('gps-status', status, 'error');
    setMessage('gps-message', message, 'error');
    setResult('idle', 'Thử khám phá bằng GPS giả lập', message);
    byId('result-source').textContent = 'Chưa có kết quả vị trí';
  }

  function runGpsCheck() {
    gpsTimer = null;
    if (!gpsActive || !pendingPosition) return;
    const location = pendingPosition;
    pendingPosition = null;
    lastGpsRequest = Date.now();
    checkNearby(location, 'GPS thật');
  }

  function receivePosition(position) {
    const { latitude, longitude, accuracy } = position.coords;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      gpsError({ code: 0 });
      return;
    }
    const location = { latitude, longitude, accuracy };
    const changed = displayLocation(location, 'GPS thật');
    setMessage('gps-status', 'GPS đang hoạt động', 'success');
    setMessage('gps-message', 'Đang theo dõi vị trí. Kiểm tra địa điểm tối đa một lần mỗi 3 giây.');
    if (changed) {
      setResult('loading', 'Đang cập nhật vị trí…', 'Đang chờ kiểm tra tọa độ mới nhất của bạn.');
    }
    pendingPosition = location;
    if (gpsTimer !== null) return;
    const remaining = GPS_INTERVAL_MS - (Date.now() - lastGpsRequest);
    if (remaining <= 0) runGpsCheck();
    else gpsTimer = setTimeout(runGpsCheck, remaining);
  }

  function startGps() {
    if (gpsActive) return;
    if (!navigator.geolocation || !window.isSecureContext) {
      setMessage('gps-status', 'GPS không khả dụng', 'error');
      setMessage('gps-message', !navigator.geolocation
        ? 'Trình duyệt không hỗ trợ định vị. Bạn vẫn có thể dùng GPS giả lập.'
        : 'GPS thật cần HTTPS hoặc localhost. Hãy dùng GPS giả lập trên kết nối hiện tại.', 'error');
      return;
    }
    cancelNearby();
    clearNarration();
    gpsActive = true;
    const session = ++gpsSession;
    lastGpsRequest = -Infinity;
    byId('start-gps').disabled = true;
    byId('stop-gps').disabled = false;
    setMessage('gps-status', 'Đang lấy vị trí', 'info');
    setMessage('gps-message', 'Hãy cho phép trình duyệt truy cập vị trí khi được hỏi.');
    setResult('loading', 'Đang chờ vị trí của bạn…', 'Cho phép định vị để bắt đầu khám phá.');
    byId('result-source').textContent = 'Đang chờ GPS thật';

    try {
      const id = navigator.geolocation.watchPosition(
        (position) => { if (gpsActive && session === gpsSession) receivePosition(position); },
        (error) => { if (gpsActive && session === gpsSession) gpsError(error); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );
      if (gpsActive && session === gpsSession) watchId = id;
      else navigator.geolocation.clearWatch(id);
    } catch {
      gpsError({ code: 0 });
    }
  }

  function parseCoordinate(input, min, max) {
    const value = input.value.trim();
    const valid = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value);
    const number = valid ? Number(value) : NaN;
    const invalid = !Number.isFinite(number) || number < min || number > max;
    input.setAttribute('aria-invalid', String(invalid));
    return invalid ? null : number;
  }

  function simulatePosition(event) {
    event.preventDefault();
    if (byId('check-simulation').disabled) return;
    const latitude = parseCoordinate(byId('demo-lat'), -90, 90);
    const longitude = parseCoordinate(byId('demo-lng'), -180, 180);
    if (latitude === null || longitude === null) {
      setMessage('simulation-message', 'Nhập latitude từ -90 đến 90 và longitude từ -180 đến 180 bằng số hợp lệ.', 'error');
      byId(latitude === null ? 'demo-lat' : 'demo-lng').focus();
      return;
    }
    const wasActive = gpsActive;
    stopTracking();
    cancelNearby();
    if (wasActive) setMessage('gps-status', 'GPS đã dừng');
    setMessage('gps-message', 'Đang dùng GPS giả lập. Định vị thật không chạy đồng thời.');
    setMessage('simulation-message', 'Đang dùng tọa độ giả lập để kiểm tra địa điểm.', 'info');
    const location = { latitude, longitude };
    displayLocation(location, 'GPS giả lập');
    checkNearby(location, 'GPS giả lập');
  }

  function usePoiCoordinates(poi) {
    const wasActive = gpsActive;
    stopTracking();
    cancelNearby();
    if (wasActive) setMessage('gps-status', 'GPS đã dừng');
    byId('demo-lat').value = String(poi.latitude);
    byId('demo-lng').value = String(poi.longitude);
    byId('demo-lat').setAttribute('aria-invalid', 'false');
    byId('demo-lng').setAttribute('aria-invalid', 'false');
    setMessage('simulation-message', `Đã chọn ${poi.name}. Bấm “Kiểm tra vị trí giả lập” để nhận kết quả.`, 'success');
    setMessage('gps-message', 'Định vị thật đang tắt. Tọa độ đã chọn chỉ được gửi khi bạn bấm kiểm tra.');
    setResult('idle', 'Tọa độ đã sẵn sàng', 'Bấm “Kiểm tra vị trí giả lập” để khám phá địa điểm vừa chọn.');
    byId('result-source').textContent = 'Chưa kiểm tra tọa độ đã chọn';
    byId('demo-lat').focus({ preventScroll: true });
    byId('simulation').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderPoiList(pois) {
    const list = byId('poi-list');
    list.replaceChildren();
    for (const poi of pois) {
      const card = byId('poi-template').content.firstElementChild.cloneNode(true);
      const active = poi.isActive === true;
      card.dataset.inactive = String(!active);
      card.querySelector('.poi-name').textContent = poi.name;
      card.querySelector('.poi-category').textContent = poi.category === 'food' ? 'ẨM THỰC' : poi.category;
      card.querySelector('.poi-address').textContent = poi.address || 'Chưa có địa chỉ';
      card.querySelector('.poi-coordinates').textContent = `${poi.latitude}, ${poi.longitude}`;
      card.querySelector('.poi-radius').textContent = `${poi.geofenceRadius} m`;
      const status = card.querySelector('.poi-status');
      status.textContent = active ? 'Đang hoạt động' : 'Tạm dừng';
      status.dataset.tone = active ? 'success' : 'neutral';
      const button = card.querySelector('.poi-use');
      button.disabled = !active;
      button.setAttribute('aria-label', `Dùng tọa độ của ${poi.name} để giả lập`);
      button.addEventListener('click', () => usePoiCoordinates(poi));
      list.append(card);
    }
    byId('poi-count').textContent = `${pois.filter((poi) => poi.isActive === true).length} đang hoạt động / ${pois.length} địa điểm`;
    byId('poi-message').hidden = pois.length > 0;
    setMessage('poi-message', 'Chưa có POI. Hãy tạo địa điểm bằng API theo README, rồi bấm “Tải lại danh sách”.');
  }

  async function loadPois() {
    byId('reload-pois').disabled = true;
    byId('poi-list').setAttribute('aria-busy', 'true');
    byId('poi-list').replaceChildren();
    byId('poi-message').hidden = false;
    setMessage('poi-message', 'Đang tải danh sách POI…');
    byId('poi-count').textContent = 'Đang tải danh sách địa điểm…';
    try {
      const pois = await fetchJson('/api/pois', new AbortController());
      if (!Array.isArray(pois)) throw new Error('Danh sách địa điểm không hợp lệ. Hãy thử tải lại.');
      renderPoiList(pois);
    } catch (error) {
      setMessage('poi-message', `${error.message} Bấm “Tải lại danh sách” để thử lại.`, 'error');
      byId('poi-count').textContent = 'Chưa tải được danh sách';
    } finally {
      byId('reload-pois').disabled = false;
      byId('poi-list').setAttribute('aria-busy', 'false');
    }
  }

  function updateLanguage() {
    const language = byId('language').value;
    byId('language-note').textContent = `Đang chọn: ${languageNames[language]} · Nội dung thuyết minh dạng text.`;
    byId('narration-title').textContent = `Thuyết minh – ${languageNames[language]}`;
    try { localStorage.setItem('poi-demo-language', language); } catch { /* Vẫn dùng được khi storage bị chặn. */ }
    if (currentPoi) loadNarration(currentPoi);
  }

  byId('language').replaceChildren(...Object.entries(languageNames).map(([code, name]) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    return option;
  }));
  byId('language').value = sourceLanguage;
  try {
    const savedLanguage = localStorage.getItem('poi-demo-language');
    if (Object.prototype.hasOwnProperty.call(languageNames, savedLanguage)) byId('language').value = savedLanguage;
  } catch { /* Trình duyệt có thể không cho phép localStorage. */ }
  updateLanguage();
  byId('language').addEventListener('change', updateLanguage);
  byId('start-gps').addEventListener('click', startGps);
  byId('stop-gps').addEventListener('click', stopGps);
  byId('simulation-form').addEventListener('submit', simulatePosition);
  byId('reload-pois').addEventListener('click', loadPois);
  byId('retry-narration').addEventListener('click', () => { if (currentPoi) loadNarration(currentPoi, true); });
  window.addEventListener('pagehide', () => { stopTracking(); cancelNearby(); clearNarration(); });
  loadPois();
})();
