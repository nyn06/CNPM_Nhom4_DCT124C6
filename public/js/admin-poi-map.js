(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  let map;
  let marker;
  let radiusCircle;
  let point = null;
  let confirmed = false;
  let searching = false;
  let searchRevision = 0;
  let autoRevision = 0;
  let autoTimer;
  let autoController;
  let placeController;
  let reverseController;
  let pointRevision = 0;
  let options = [];
  let activeOption = -1;
  const addressFields = ['street-address', 'ward', 'city'];
  const status = (text) => { byId('poi-location-status').textContent = text; };
  const valid = (latitude, longitude) => Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
  const suggestionStatus = (text) => { byId('poi-suggestion-status').textContent = text; };
  const administrative = /^(?:phường|xã|thị trấn|quận|huyện|thành phố|tỉnh)(?:\s|$)/iu;
  const streetCandidate = (value, fromSuggestion = false) => {
    const street = typeof value === 'string' ? value.split(',')[0].trim() : '';
    if (!street || administrative.test(street)) return '';
    if (fromSuggestion && !/^(?:\d+[\p{L}\d/-]*\s+|đường\s+|phố\s+|ngõ\s+|hẻm\s+|quốc lộ\s+|tỉnh lộ\s+)/iu.test(street)) return '';
    return street;
  };

  function closeSuggestions() {
    byId('poi-suggestions').hidden = true;
    byId('poi-street-address').setAttribute('aria-expanded', 'false');
    byId('poi-street-address').removeAttribute('aria-activedescendant');
    activeOption = -1;
  }

  function cancelAutocomplete() {
    autoRevision++;
    clearTimeout(autoTimer);
    autoController?.abort();
    placeController?.abort();
    autoController = null;
    placeController = null;
    options = [];
    byId('poi-suggestions').replaceChildren();
    closeSuggestions();
  }

  function updateRadius() {
    if (radiusCircle) { radiusCircle.remove(); radiusCircle = null; }
    const radius = Number(byId('poi-radius').value);
    if (map && point && Number.isFinite(radius) && radius > 0) {
      radiusCircle = window.L.circle([point.latitude, point.longitude], { radius, color: '#b05b36', fillOpacity: 0.12 }).addTo(map);
    }
  }

  function setPoint(latitude, longitude, accepted = false) {
    if (!valid(latitude, longitude)) return;
    pointRevision++;
    reverseController?.abort();
    reverseController = null;
    point = { latitude, longitude };
    confirmed = accepted;
    byId('poi-coordinates').textContent = `Latitude: ${latitude.toFixed(6)} · Longitude: ${longitude.toFixed(6)}${accepted ? (window.ADMIN_I18N?.t('js.admin_poi_map.001') ?? ' · Đã xác nhận') : (window.ADMIN_I18N?.t('js.admin_poi_map.002') ?? ' · Chưa xác nhận')}`;
    if (map && !marker) {
      marker = window.L.marker([latitude, longitude], { draggable: true }).addTo(map);
      marker.on('dragend', () => {
        const position = marker.getLatLng();
        setPoint(position.lat, position.lng);
        reversePoint(position.lat, position.lng, pointRevision);
      });
    } else if (map) marker.setLatLng([latitude, longitude]);
    updateRadius();
    if (map) map.setView([latitude, longitude], Math.max(map.getZoom(), 16));
    status(accepted ? (window.ADMIN_I18N?.t('js.admin_poi_map.003') ?? 'Vị trí đã xác nhận.') : (window.ADMIN_I18N?.t('js.admin_poi_map.004') ?? 'Vị trí đang chờ xác nhận. Kéo ghim để điều chỉnh nếu cần.'));
  }

  async function reversePoint(latitude, longitude, revision) {
    const controller = new AbortController();
    reverseController = controller;
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`/api/geocode/reverse?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}`,
        { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) return;
      const address = await response.json();
      if (revision !== pointRevision) return;
      const street = streetCandidate(address.streetAddress);
      if (street) byId('poi-street-address').value = street;
      for (const field of ['ward', 'city']) {
        if (typeof address[field] === 'string' && address[field].trim()) byId(`poi-${field}`).value = address[field].trim();
      }
    } catch { /* Reverse lookup must not interrupt marker placement or confirmation. */ }
    finally {
      clearTimeout(timer);
      if (reverseController === controller) reverseController = null;
    }
  }

  function ensureMap() {
    if (!window.L?.map) {
      status((window.ADMIN_I18N?.t('js.admin_poi_map.005') ?? 'Bản đồ chưa sẵn sàng. Bạn vẫn có thể tìm địa chỉ; hãy tải lại trang để đặt ghim.'));
      return;
    }
    if (!map) {
      try {
        map = window.L.map('poi-admin-map').setView([16.0, 106.0], 6);
        window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);
        map.on('click', (event) => setPoint(event.latlng.lat, event.latlng.lng));
      } catch {
        map?.remove();
        map = null;
        status((window.ADMIN_I18N?.t('js.admin_poi_map.005') ?? 'Bản đồ chưa sẵn sàng. Bạn vẫn có thể tìm địa chỉ; hãy tải lại trang để đặt ghim.'));
        return;
      }
    }
    setTimeout(() => map.invalidateSize(), 0);
  }

  function load(poi) {
    searchRevision++;
    cancelAutocomplete();
    pointRevision++;
    reverseController?.abort();
    ensureMap();
    byId('poi-search-results').replaceChildren();
    if (marker) { marker.remove(); marker = null; }
    if (radiusCircle) { radiusCircle.remove(); radiusCircle = null; }
    point = null;
    confirmed = false;
    byId('poi-coordinates').textContent = (window.ADMIN_I18N?.t('js.admin_poi_map.006') ?? 'Chưa chọn vị trí GPS.');
    suggestionStatus((window.ADMIN_I18N?.t('js.admin_poi_map.007') ?? 'Nhập ít nhất 3 ký tự để xem gợi ý địa chỉ.'));
    if (valid(poi?.latitude, poi?.longitude)) setPoint(poi.latitude, poi.longitude, true);
    else if (map) status((window.ADMIN_I18N?.t('js.admin_poi_map.008') ?? 'Tìm địa chỉ hoặc nhấp trên bản đồ để đặt ghim.'));
  }

  function clear() {
    searchRevision++;
    cancelAutocomplete();
    pointRevision++;
    reverseController?.abort();
    if (marker) { marker.remove(); marker = null; }
    if (radiusCircle) { radiusCircle.remove(); radiusCircle = null; }
    point = null;
    confirmed = false;
    byId('poi-coordinates').textContent = (window.ADMIN_I18N?.t('js.admin_poi_map.006') ?? 'Chưa chọn vị trí GPS.');
    byId('poi-search-results').replaceChildren();
  }

  async function internalRequest(path, body, controller) {
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        signal: controller.signal, headers: { 'Content-Type': 'application/json', ...window.ADMIN_AUTH.headers('POST') },
        body: JSON.stringify(body) });
      window.ADMIN_AUTH.handle(response);
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error('Address service unavailable'), { code: data.code });
      return data;
    } finally { clearTimeout(timer); }
  }

  function showOptions(results) {
    const list = byId('poi-suggestions');
    list.replaceChildren();
    options = Array.isArray(results) ? results.filter((item) => typeof item?.id === 'string'
      && typeof item.display === 'string').slice(0, 6) : [];
    if (!options.length) { closeSuggestions(); suggestionStatus((window.ADMIN_I18N?.t('js.admin_poi_map.009') ?? 'Không có gợi ý. Bạn có thể tìm thủ công hoặc đặt ghim.')); return; }
    options.forEach((item, index) => {
      const row = document.createElement('div');
      row.id = `poi-suggestion-${index}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      const name = document.createElement('strong');
      name.textContent = item.name || item.display;
      const address = document.createElement('span');
      address.textContent = item.address || item.display;
      row.append(name, address);
      row.addEventListener('mousedown', (event) => event.preventDefault());
      row.addEventListener('click', () => selectOption(index));
      list.append(row);
    });
    list.hidden = false;
    byId('poi-street-address').setAttribute('aria-expanded', 'true');
    suggestionStatus((window.ADMIN_I18N?.t('js.admin_poi_map.010', [options.length]) ?? `${options.length} gợi ý. Dùng phím mũi tên để chọn.`));
  }

  function suggestionFailure(error) {
    const code = error?.code;
    const key = code === 'GEOCODE_NOT_CONFIGURED' ? '017'
      : code === 'GEOCODE_AUTH' ? '018'
        : ['GEOCODE_QUOTA', 'GEOCODE_RATE_LIMIT'].includes(code) ? '019'
          : ['GEOCODE_HTTP_504', 'GEOCODE_TIMEOUT'].includes(code) || error?.name === 'AbortError' ? '029'
            : ['GEOCODE_NETWORK', 'GEOCODE_DNS', 'GEOCODE_TLS'].includes(code) ? '030'
              : ['GEOCODE_HTTP_502', 'GEOCODE_HTTP_503'].includes(code) ? '031'
                : code === 'GEOCODE_INVALID_RESPONSE' ? '032' : '020';
    return window.ADMIN_I18N?.t(`js.admin_poi_map.${key}`) ?? {
      '017': 'Chưa cấu hình VIETMAP. Hãy dùng nút tìm thủ công hoặc đặt ghim.',
      '018': 'Khóa VIETMAP chưa hợp lệ hoặc chưa được cấp quyền. Hãy dùng nút tìm thủ công.',
      '019': 'Dịch vụ gợi ý đã đạt hạn mức. Hãy thử lại sau hoặc đặt ghim.',
      '029': 'Dịch vụ gợi ý phản hồi quá chậm. Hãy thử lại hoặc đặt ghim.',
      '030': 'Không kết nối được dịch vụ gợi ý. Hãy thử lại hoặc đặt ghim.',
      '031': 'VietMap tạm thời không khả dụng. Hãy thử lại hoặc đặt ghim.',
      '032': 'VietMap trả dữ liệu không hợp lệ. Hãy tìm thủ công hoặc đặt ghim.',
    }[key] ?? 'Không tải được gợi ý. Bạn có thể tìm thủ công hoặc đặt ghim.';
  }

  function moveOption(step) {
    if (!options.length) return;
    activeOption = (activeOption + step + options.length) % options.length;
    for (let index = 0; index < options.length; index++) {
      byId('poi-suggestions').children[index].setAttribute('aria-selected', String(index === activeOption));
    }
    const node = byId('poi-suggestions').children[activeOption];
    byId('poi-street-address').setAttribute('aria-activedescendant', node.id);
    node.scrollIntoView?.({ block: 'nearest' });
  }

  async function selectOption(index) {
    const selected = options[index];
    if (!selected) return;
    cancelAutocomplete();
    const revision = autoRevision;
    const controller = new AbortController();
    placeController = controller;
    suggestionStatus((window.ADMIN_I18N?.t('js.admin_poi_map.011') ?? 'Đang lấy vị trí địa chỉ đã chọn…'));
    try {
      const detail = await internalRequest('/api/admin/geocode/place', { id: selected.id }, controller);
      if (revision !== autoRevision) return;
      if (!valid(detail.latitude, detail.longitude)) throw new Error('Invalid point');
      const street = streetCandidate(detail.streetAddress) || streetCandidate(selected.name, true);
      if (street) byId('poi-street-address').value = street;
      for (const field of ['ward', 'city']) {
        if (typeof detail[field] === 'string' && detail[field].trim()) byId(`poi-${field}`).value = detail[field].trim();
      }
      setPoint(detail.latitude, detail.longitude);
      suggestionStatus((window.ADMIN_I18N?.t('js.admin_poi_map.012') ?? 'Đã đặt ghim từ kết quả. Kiểm tra và xác nhận vị trí trước khi lưu.'));
    } catch (error) {
      if (revision === autoRevision) suggestionStatus(error.code === 'GEOCODE_AUTH'
        ? (window.ADMIN_I18N?.t('js.admin_poi_map.013') ?? 'Khóa VIETMAP chưa hợp lệ hoặc chưa được cấp quyền. Hãy đặt ghim thủ công.')
        : error.code === 'GEOCODE_QUOTA' || error.code === 'GEOCODE_RATE_LIMIT'
          ? (window.ADMIN_I18N?.t('js.admin_poi_map.014') ?? 'Dịch vụ địa chỉ đã đạt hạn mức hoặc chưa được kích hoạt. Hãy đặt ghim thủ công.')
          : (window.ADMIN_I18N?.t('js.admin_poi_map.015') ?? 'Không lấy được vị trí gợi ý. Hãy tìm thủ công hoặc đặt ghim.'));
    } finally { if (placeController === controller) placeController = null; }
  }

  async function suggest(revision) {
    const controller = new AbortController();
    autoController = controller;
    const body = { streetAddress: byId('poi-street-address').value.trim(),
      ward: byId('poi-ward').value.trim(), city: byId('poi-city').value.trim() };
    suggestionStatus((window.ADMIN_I18N?.t('js.admin_poi_map.016') ?? 'Đang tìm gợi ý…'));
    try {
      const data = await internalRequest('/api/admin/geocode/suggest', body, controller);
      if (revision === autoRevision) showOptions(data.results);
    } catch (error) {
      if (revision !== autoRevision) return;
      closeSuggestions();
      suggestionStatus(suggestionFailure(error));
    } finally { if (autoController === controller) autoController = null; }
  }

  function scheduleAutocomplete() {
    cancelAutocomplete();
    const street = byId('poi-street-address').value.trim();
    if (street.length < 3) { suggestionStatus((window.ADMIN_I18N?.t('js.admin_poi_map.007') ?? 'Nhập ít nhất 3 ký tự để xem gợi ý địa chỉ.')); return; }
    const revision = autoRevision;
    autoTimer = setTimeout(() => suggest(revision), 400);
  }

  async function search() {
    if (searching) return;
    cancelAutocomplete();
    const body = {
      streetAddress: byId('poi-street-address').value.trim(),
      ward: byId('poi-ward').value.trim(), city: byId('poi-city').value.trim(),
    };
    if (Object.values(body).some((value) => !value)) {
      status((window.ADMIN_I18N?.t('js.admin_poi_map.021') ?? 'Nhập số nhà/đường, phường/xã và tỉnh/thành phố trước khi tìm.'));
      return;
    }
    const revision = ++searchRevision;
    searching = true;
    byId('poi-search-address').disabled = true;
    byId('poi-search-results').replaceChildren();
    status((window.ADMIN_I18N?.t('js.admin_poi_map.022') ?? 'Đang tìm địa chỉ…'));
    try {
      const response = await fetch('/api/admin/geocode', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...window.ADMIN_AUTH.headers('POST') }, body: JSON.stringify(body) });
      window.ADMIN_AUTH.handle(response);
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();
      if (revision !== searchRevision) return;
      const results = Array.isArray(data.results) ? data.results : [];
      if (!results.length) { status((window.ADMIN_I18N?.t('js.admin_poi_map.023') ?? 'Không có kết quả. Bạn vẫn có thể đặt ghim trực tiếp trên bản đồ.')); return; }
      status((window.ADMIN_I18N?.t('js.admin_poi_map.024', [results.length]) ?? `Có ${results.length} kết quả. Chọn địa chỉ đúng rồi xác nhận vị trí.`));
      for (const result of results) {
        if (!valid(result.latitude, result.longitude) || typeof result.label !== 'string') continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button secondary';
        button.textContent = result.label;
        button.addEventListener('click', () => setPoint(result.latitude, result.longitude));
        byId('poi-search-results').append(button);
      }
    } catch {
      if (revision === searchRevision) status((window.ADMIN_I18N?.t('js.admin_poi_map.025') ?? 'Không tải được kết quả. Bạn vẫn có thể đặt ghim trực tiếp trên bản đồ.'));
    } finally {
      searching = false;
      byId('poi-search-address').disabled = false;
    }
  }

  for (const field of addressFields) byId(`poi-${field}`).addEventListener('input', () => {
    searchRevision++;
    byId('poi-search-results').replaceChildren();
    if (point) { confirmed = false; status((window.ADMIN_I18N?.t('js.admin_poi_map.026') ?? 'Địa chỉ đã đổi. Kiểm tra ghim và xác nhận lại vị trí.')); }
    scheduleAutocomplete();
  });
  byId('poi-street-address').addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || event.key === 'Tab') { cancelAutocomplete(); return; }
    if (byId('poi-suggestions').hidden) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveOption(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectOption(activeOption < 0 ? 0 : activeOption);
    }
  });
  byId('poi-street-address').addEventListener('blur', () => setTimeout(closeSuggestions, 0));
  byId('poi-radius').addEventListener('input', () => { if (map) updateRadius(); });
  byId('poi-search-address').addEventListener('click', search);
  byId('poi-confirm-location').addEventListener('click', () => {
    if (!point) { status((window.ADMIN_I18N?.t('js.admin_poi_map.027') ?? 'Đặt ghim trên bản đồ trước khi xác nhận.')); return; }
    confirmed = true;
    byId('poi-coordinates').textContent = (window.ADMIN_I18N?.t('js.admin_poi_map.028', [point.latitude.toFixed(6), point.longitude.toFixed(6)]) ?? `Latitude: ${point.latitude.toFixed(6)} · Longitude: ${point.longitude.toFixed(6)} · Đã xác nhận`);
    status((window.ADMIN_I18N?.t('js.admin_poi_map.003') ?? 'Vị trí đã xác nhận.'));
  });
  window.ADMIN_I18N?.onChange(() => {
    const translate = window.ADMIN_I18N.t;
    if (point) {
      byId('poi-coordinates').textContent = `Latitude: ${point.latitude.toFixed(6)} · Longitude: ${point.longitude.toFixed(6)}${translate(confirmed ? 'js.admin_poi_map.001' : 'js.admin_poi_map.002')}`;
      status(translate(confirmed ? 'js.admin_poi_map.003' : 'js.admin_poi_map.004'));
    } else {
      byId('poi-coordinates').textContent = translate('js.admin_poi_map.006');
      if (map) status(translate('js.admin_poi_map.008'));
    }
    suggestionStatus(translate(options.length ? 'js.admin_poi_map.010' : 'js.admin_poi_map.007', [options.length]));
  });
  window.addEventListener('pagehide', () => { cancelAutocomplete(); if (map) map.remove(); map = null; });
  window.ADMIN_POI_MAP = { load, clear, refresh: () => { if (map) setTimeout(() => map.invalidateSize(), 0); },
    location: () => (confirmed && point ? { ...point } : null) };
})();
