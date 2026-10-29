(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const GPS_INTERVAL_MS = 3000;
  const REQUEST_TIMEOUT_MS = 10000;
  const ADDRESS_INTERVAL_MS = 30000;
  const ADDRESS_MOVE_METERS = 150;
  const FIRST_FIX_TIMEOUT_MS = 25000;
  const { sourceLanguage, names: languageNames } = window.POI_LANGUAGES;
  const access = window.TOUR_ACCESS;
  const tourMap = window.TOUR_MAP;
  const translations = window.TOUR_TRANSLATIONS;
  const categoryCodes = { food: 'categoryFood', 'món ăn': 'categoryFood', drink: 'categoryDrink', 'đồ uống': 'categoryDrink', dessert: 'categoryDessert', 'tráng miệng': 'categoryDessert' };
  const categoryLabel = (category) => {
    const key = categoryCodes[String(category || '').trim().toLocaleLowerCase('vi-VN')];
    return key ? t(key) : category;
  };
  const displayPoi = (poi) => {
    const translated = poi.translations?.[byId('language').value];
    return translated ? { ...poi, ...translated } : poi;
  };
  const t = (key, params) => {
    const value = window.tourT(key, params);
    return value === key ? ({ locationUnknown: 'Chưa xác định vị trí',
      addressUnknown: 'Chưa xác định được số nhà, tên đường' }[key] || value) : value;
  };
  const dynamicText = new Map();
  function setText(id, key, params = {}) {
    if (Object.prototype.hasOwnProperty.call(translations[sourceLanguage], key)) {
      dynamicText.set(id, { key, params });
      byId(id).textContent = t(key, params);
    } else {
      dynamicText.delete(id);
      byId(id).textContent = key;
    }
  }
  let audioObjectUrl = null;
  let watchId = null;
  let gpsActive = false;
  let gpsSession = 0;
  let gpsTimer = null;
  let firstFixTimer = null;
  let pendingPosition = null;
  let lastGpsRequest = -Infinity;
  let locationRevision = 0;
  let currentLocation = null;
  let realLocation = null;
  let simulatedLocation = null;
  let loadedPois = null;
  let translationRefreshTimer = null;
  let poiListRevision = 0;
  let disposed = false;
  let poiSearch = null;
  let poiCards = [];
  let poiOrder = [];
  let poiDistanceStatus = 'distanceEnableGps';
  let displayedNearbyPoi = null;
  let lastResultAt = null;
  let addressController = null;
  let addressTimer = null;
  let addressRevision = 0;
  let addressAnchor = null;
  let addressSource = null;
  let lastAddressRequest = -Infinity;
  let addressFailed = false;
  let addressDisplayKey = null;
  let nearbyController = null;
  let nearbyRequest = 0;
  let currentPoi = null;
  let narrationController = null;
  let narrationRequest = 0;
  let narrationKey = null;
  let currentNarration = null;
  let audioController = null;
  let audioRequest = 0;
  let autoEnabled = false;
  let insidePoiIds = new Set();
  let selectedPoiId = null;
  let confirmedLocationRevision = -1;
  let pendingAutoEntry = null;

  function setMessage(id, text, tone = 'neutral', params = {}) {
    const element = byId(id);
    setText(id, text, params);
    element.dataset.tone = tone;
  }

  function setResult(state, title, message) {
    if (state !== 'loading') clearNarration();
    const labels = {
      idle: 'waitingLocation',
      loading: 'gpsChecking',
      outside: 'gpsOutside',
      error: 'gpsError'
    };
    const panel = byId('geofence-panel');
    panel.dataset.state = state;
    panel.setAttribute('aria-busy', String(state === 'loading'));
    byId('result-empty').hidden = false;
    byId('nearest-card').hidden = true;
    setText('result-title', title);
    setText('result-message', message);
    setMessage('geofence-badge', labels[state], state === 'error' ? 'error' : 'neutral');
    byId('result-time').textContent = '—';
  }

  function displayLocation(location, source) {
    const previous = source === 'GPS thật' ? realLocation : simulatedLocation;
    const changed = !currentLocation || currentLocation.source !== source || !previous
      || previous.latitude !== location.latitude || previous.longitude !== location.longitude;
    if (changed) {
      locationRevision++;
      // Trong chuyến tham quan, chỉ đổi/dừng audio sau kết quả geofence của Backend.
      if (!autoEnabled) clearNarration();
    }
    currentLocation = { ...location, source };
    if (source === 'GPS thật') realLocation = currentLocation;
    else simulatedLocation = currentLocation;
    tourMap?.setLocation(currentLocation);
    updatePoiDistances();
    updateAddress(currentLocation);
    byId('current-accuracy').textContent = Number.isFinite(location.accuracy) && location.accuracy >= 0
      ? `±${Math.round(location.accuracy)} m` : t('noAccuracy');
    setText('current-source', source === 'GPS thật' ? 'gpsReal' : 'gpsSimulated');
    return changed;
  }

  function showAddress(street, ward = '—', city = '—', key = null) {
    addressDisplayKey = key;
    byId('current-street').textContent = street;
    byId('current-ward').textContent = ward;
    byId('current-city').textContent = city;
  }

  function cancelAddress() {
    addressRevision++;
    if (addressController) addressController.abort();
    addressController = null;
    clearTimeout(addressTimer);
    addressTimer = null;
    addressAnchor = null;
    addressSource = null;
    lastAddressRequest = -Infinity;
    addressFailed = false;
  }

  function distanceMeters(a, b) {
    const radians = Math.PI / 180;
    const lat = (b.latitude - a.latitude) * radians;
    const lng = (b.longitude - a.longitude) * radians;
    const arc = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * radians)
      * Math.cos(b.latitude * radians) * Math.sin(lng / 2) ** 2;
    return 12742000 * Math.asin(Math.min(1, Math.sqrt(arc)));
  }

  function validPoint(point) {
    return Number.isFinite(point?.latitude) && point.latitude >= -90 && point.latitude <= 90
      && Number.isFinite(point?.longitude) && point.longitude >= -180 && point.longitude <= 180;
  }

  function formatPoiDistance(meters) {
    const language = byId('language').value;
    return meters < 1000
      ? `${Math.round(meters).toLocaleString(language)} m`
      : `${(meters / 1000).toLocaleString(language, { maximumFractionDigits: 1 })} km`;
  }

  function updatePoiDistances() {
    if (!poiCards.length) return;
    const location = currentLocation?.source === 'GPS giả lập' || gpsActive ? currentLocation : null;
    const hasLocation = validPoint(location);
    const ordered = poiCards.map((entry) => ({ ...entry,
      distance: hasLocation && validPoint(entry.poi) ? distanceMeters(location, entry.poi) : null }));
    for (const entry of ordered) {
      entry.card.querySelector('.poi-distance-text').textContent = entry.distance === null
        ? t(hasLocation ? 'distanceUnknown' : poiDistanceStatus)
        : t('poiDistanceValue', { distance: formatPoiDistance(entry.distance) });
    }
    if (hasLocation) ordered.sort((a, b) => (a.distance === null) - (b.distance === null)
      || (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.index - b.index);
    const nextOrder = ordered.map((entry) => entry.index);
    if (nextOrder.some((index, position) => index !== poiOrder[position])) {
      byId('poi-list').append(...ordered.map((entry) => entry.card));
      poiOrder = nextOrder;
    }
  }

  function updateAddress(location) {
    if (addressSource !== location.source) {
      cancelAddress();
      addressSource = location.source;
      showAddress(t('locationUnknown'), '—', '—', 'locationUnknown');
    }
    const moved = !addressAnchor || distanceMeters(addressAnchor, location) >= ADDRESS_MOVE_METERS;
    if (!moved && !addressFailed) return;
    const remaining = ADDRESS_INTERVAL_MS - (Date.now() - lastAddressRequest);
    if (remaining > 0) {
      if (addressTimer === null && !addressController) {
        addressTimer = setTimeout(() => {
          addressTimer = null;
          if (currentLocation?.source === addressSource) updateAddress(currentLocation);
        }, remaining);
      }
      return;
    }
    clearTimeout(addressTimer);
    addressTimer = null;
    if (addressController) addressController.abort();
    const revision = ++addressRevision;
    const controller = new AbortController();
    addressController = controller;
    addressAnchor = location;
    lastAddressRequest = Date.now();
    addressFailed = false;
    showAddress(t('addressUnknown'), '—', '—', 'addressUnknown');
    const params = new URLSearchParams({ lat: String(location.latitude), lng: String(location.longitude) });
    fetchJson(`/api/geocode/reverse?${params}`, controller, { cache: 'no-store' }, 8000)
      .then((data) => {
        if (revision !== addressRevision) return;
        const value = (field) => typeof data?.[field] === 'string' ? data[field].trim() : '';
        const street = value('streetAddress');
        showAddress(street || t('addressUnknown'), value('ward') || '—', value('city') || '—',
          street ? null : 'addressUnknown');
      })
      .catch(() => {
        if (revision !== addressRevision) return;
        addressFailed = true;
        showAddress(t('addressFetchFailed'), '—', '—', 'addressFetchFailed');
      })
      .finally(() => { if (revision === addressRevision) addressController = null; });
  }

  async function fetchJson(url, controller, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, headers: { Accept: 'application/json', ...options.headers } });
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(t('invalidResponse'));
      }
      if (!response.ok) {
        if (response.status === 401) access.lose();
        const error = new Error(response.status === 401 ? t('sessionExpired')
          : response.status === 404 ? t('noNarrationFound') : t('requestFailed'));
        error.statusCode = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(t('requestTimeout'));
      if (error instanceof TypeError) throw new Error(t('backendUnavailable'));
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
    clearAudio();
    currentPoi = null;
    narrationKey = null;
    byId('narration-text').textContent = '';
    byId('narration-text').hidden = true;
    byId('retry-narration').hidden = true;
    byId('narration-panel').setAttribute('aria-busy', 'false');
    setMessage('narration-status', t('narrationWaiting'));
  }

  function clearAudio() {
    pendingAutoEntry = null;
    audioRequest++;
    if (audioController) audioController.abort();
    audioController = null;
    currentNarration = null;
    const audio = byId('narration-audio');
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    audioObjectUrl = null;
    audio.hidden = true;
    byId('generate-audio').hidden = true;
    byId('generate-audio').disabled = false;
    byId('audio-panel').setAttribute('aria-busy', 'false');
    setMessage('audio-status', t('audioWaiting'));
  }

  async function displayAudio(narration) {
    currentNarration = narration;
    // TTS belongs to the local Admin. Tourists consume prepared audio.
    byId('generate-audio').hidden = true;
    const audioUrl = narration.audioUrl;
    if (!audioUrl) {
      setText('generate-audio', 'generateAudio');
      setMessage('audio-status', 'audioMissingAdmin');
      return;
    }
    // Chỉ chấp nhận WAV của Backend cùng origin, không nhận URL ngoài hoặc path traversal.
    if (typeof audioUrl !== 'string' || !/^\/audio\/[a-zA-Z0-9_-]+\.wav$/.test(audioUrl)) {
      setMessage('audio-status', 'audioInvalidUrl', 'error');
      return;
    }
    const requestId = ++audioRequest;
    const controller = new AbortController();
    audioController = controller;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(audioUrl, { signal: controller.signal, headers: access.headers(), cache: 'no-store' });
      if (response.status === 401) { access.lose(); return; }
      if (!response.ok) throw new Error(t('audioLoadError'));
      const blob = await response.blob();
      if (requestId !== audioRequest || !access.active()) return;
      if (blob.type !== 'audio/wav' && blob.type !== 'audio/x-wav') throw new Error(t('audioInvalidResponse'));
      audioObjectUrl = URL.createObjectURL(blob);
    } catch {
      if (requestId === audioRequest) setMessage('audio-status', 'audioNetworkError', 'error');
      return;
    } finally {
      clearTimeout(timeout);
      if (requestId === audioRequest) audioController = null;
    }
    if (requestId !== audioRequest || !access.active()) return;
    const audio = byId('narration-audio');
    audio.setAttribute('src', audioObjectUrl);
    audio.hidden = false;
    setText('generate-audio', 'regenerateAudio');
    setMessage('audio-status', 'audioReadyPlay');
  }

  async function playAutoNarration() {
    const entry = pendingAutoEntry;
    if (!access.active() || !autoEnabled || !entry || entry.started || confirmedLocationRevision !== locationRevision
      || nearbyController || selectedPoiId !== entry.poiId || !insidePoiIds.has(entry.poiId)
      || currentNarration?.poiId !== entry.poiId || currentNarration.language !== entry.language
      || byId('language').value !== entry.language) return;

    // Đánh dấu trước await: thiếu audio hoặc autoplay bị chặn cũng không thử lại mỗi GPS update.
    entry.started = true;
    const audio = byId('narration-audio');
    if (!audio.getAttribute('src')) {
      setMessage('auto-status', currentNarration.audioUrl ? 'autoInvalidAudio' : 'autoMissingAudio');
      return;
    }
    setMessage('auto-status', 'autoPlaying', 'success', { name: currentPoi.name });
    try {
      await audio.play();
      if (pendingAutoEntry === entry && autoEnabled) {
        setMessage('auto-status', 'autoPlayed', 'success', { name: currentPoi.name });
      }
    } catch {
      if (pendingAutoEntry !== entry || !autoEnabled) return;
      setMessage('auto-status', 'autoplayBlocked', 'info');
      setMessage('audio-status', 'autoplayBlocked', 'info');
    }
  }

  function disableAutoNarration() {
    autoEnabled = false;
    insidePoiIds.clear();
    selectedPoiId = null;
    pendingAutoEntry = null;
    byId('toggle-tour').setAttribute('aria-pressed', 'false');
    setText('tour-button-label', 'startTour');
    setMessage('tour-status', 'tourStatus');
    setMessage('auto-status', 'tourHelp');
  }

  function toggleTour() {
    if (autoEnabled) {
      disableAutoNarration();
      stopGps();
      return;
    }
    if (!access.active()) { access.lose(t('startTicketFirst')); return; }
    autoEnabled = true;
    insidePoiIds.clear();
    selectedPoiId = null;
    clearNarration();
    byId('toggle-tour').setAttribute('aria-pressed', 'true');
    setText('tour-button-label', 'stopTour');
    setMessage('tour-status', 'tourOn', 'success');
    setMessage('auto-status', 'autoWaitingPosition');
    startGps();
  }

  function generateAudio() {
    setMessage('audio-status', 'audioAdminOnly');
  }

  async function loadNarration(poi, force = false, autoEntry = false) {
    if (!access.active()) {
      clearNarration();
      setMessage('narration-status', 'activateForNarration');
      return;
    }
    const language = byId('language').value;
    const key = `${poi.id}:${language}:${poi.updatedAt || ''}`;
    currentPoi = poi;
    if (key === narrationKey && !force) return;
    cancelNarration();
    clearAudio();
    narrationKey = key;
    if (autoEntry) pendingAutoEntry = { poiId: poi.id, language, started: false };
    const requestId = narrationRequest;
    const controller = new AbortController();
    narrationController = controller;
    setText('narration-title', 'narrationLanguage', { language: languageNames[language] });
    byId('narration-panel').setAttribute('aria-busy', 'true');
    byId('narration-text').textContent = '';
    byId('narration-text').hidden = true;
    byId('retry-narration').hidden = true;
    setMessage('narration-status', 'loadingNarration');
    setMessage('audio-status', 'loadingAudio');

    try {
      const data = await fetchJson(`/api/pois/${encodeURIComponent(poi.id)}/narrations/${encodeURIComponent(language)}`, controller,
        { headers: access.headers() });
      if (requestId !== narrationRequest) return;
      if (!data || data.poiId !== poi.id || data.language !== language || typeof data.text !== 'string' || !data.text.trim()) {
        throw new Error(t('invalidNarrationResponse'));
      }
      byId('narration-text').textContent = data.text;
      byId('narration-text').setAttribute('lang', language);
      byId('narration-text').hidden = false;
      setMessage('narration-status', 'narrationOf', 'neutral', { name: poi.name });
      await displayAudio(data);
      playAutoNarration();
    } catch (error) {
      if (requestId !== narrationRequest) return;
      const missing = error.statusCode === 404;
      setMessage('narration-status', missing
        ? 'noNarration' : error.message,
      missing ? 'neutral' : 'error');
      byId('retry-narration').hidden = false;
      setMessage('audio-status', missing
        ? 'noNarrationAudio' : 'narrationLoadAudioError',
      missing ? 'neutral' : 'error');
      if (pendingAutoEntry && autoEnabled) {
        pendingAutoEntry = null;
        setMessage('auto-status', missing
          ? 'autoNarrationMissing' : 'autoNarrationLoadError', missing ? 'neutral' : 'error');
      }
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
      throw new Error(t('invalidNearbyResponse'));
    }

    // pois là danh sách inside do Backend lọc; không tính khoảng cách/bán kính ở frontend.
    const nextInsideIds = new Set(data.insideGeofence ? data.pois.map((poi) => poi.id) : []);
    const nearestId = data.insideGeofence ? data.nearestPoi.id : null;
    if (data.insideGeofence && (typeof nearestId !== 'string' || !nextInsideIds.has(nearestId))) {
      throw new Error(t('invalidNearbyResponse'));
    }
    const autoEntry = autoEnabled && nearestId !== null && !insidePoiIds.has(nearestId);
    const selectionChanged = selectedPoiId !== nearestId;
    confirmedLocationRevision = locationRevision;
    if (autoEnabled) {
      insidePoiIds = nextInsideIds;
      selectedPoiId = nearestId;
      if (nearestId === null) setMessage('auto-status', 'autoReadyNextEntry');
      else if (autoEntry) setMessage('auto-status', 'autoEntering', 'info', { name: data.nearestPoi.name });
      else if (selectionChanged) setMessage('auto-status', 'autoAlreadyInside');
    }

    if (!data.insideGeofence) {
      displayedNearbyPoi = null;
      setResult('outside', 'outsideTitle', 'outsideHelp');
    } else {
      const poi = data.nearestPoi;
      displayedNearbyPoi = poi;
      byId('geofence-panel').dataset.state = 'inside';
      byId('geofence-panel').setAttribute('aria-busy', 'false');
      byId('result-empty').hidden = true;
      byId('nearest-card').hidden = false;
      setMessage('geofence-badge', 'insideRange', 'success');
      setText('nearest-name', 'arrivedAtName', { name: poi.name });
      const savedAddress = [poi.streetAddress, poi.ward, poi.city]
        .filter((part) => typeof part === 'string' && part.trim()).map((part) => part.trim()).join(', ');
      if (savedAddress || poi.address) {
        dynamicText.delete('nearest-address');
        byId('nearest-address').textContent = byId('language').value === 'vi' ? savedAddress || poi.address : poi.address || savedAddress;
      } else setText('nearest-address', 'noAddress');
      byId('nearest-description').textContent = poi.description || '';
      byId('nearest-distance').textContent = `${poi.distance.toLocaleString(byId('language').value, { maximumFractionDigits: 2 })} m`;
      byId('nearest-radius').textContent = `${poi.geofenceRadius} m`;
      setText('matched-count', data.pois.length > 1 ? 'multipleInside' : 'nearestInside',
        { count: data.pois.length });
      loadNarration(poi, false, autoEntry);
    }
    setText('result-source', 'resultFrom', { source: t(source === 'GPS thật' ? 'gpsReal' : 'gpsSimulated') });
    lastResultAt = new Date();
    setText('result-time', 'updatedAt', { time: lastResultAt.toLocaleTimeString(byId('language').value) });
  }

  async function checkNearby(location, source) {
    cancelNearby();
    const requestId = nearbyRequest;
    const revision = locationRevision;
    const controller = new AbortController();
    nearbyController = controller;
    byId('check-simulation').disabled = source === 'GPS giả lập';
    setResult('loading', 'findingNearby', 'checkingPosition');
    setText('result-source', source === 'GPS thật' ? 'gpsReal' : 'gpsSimulated');

    try {
      // Cả GPS thật và giả lập dùng cùng API; geofence do Backend quyết định.
      const query = new URLSearchParams({ lat: location.latitude, lng: location.longitude });
      if (byId('language').value !== 'vi') query.set('lang', byId('language').value);
      const data = await fetchJson(`/api/pois/nearby?${query}`, controller);
      if (requestId !== nearbyRequest || revision !== locationRevision) return;
      renderNearby(data, source);
    } catch (error) {
      if (requestId !== nearbyRequest || revision !== locationRevision) return;
      setResult('error', 'nearbyErrorTitle', error.message);
      if (autoEnabled) setMessage('auto-status', 'geofenceRetry', 'error');
    } finally {
      if (requestId === nearbyRequest) {
        nearbyController = null;
        byId('check-simulation').disabled = false;
        playAutoNarration();
      }
    }
  }

  function stopTracking() {
    gpsActive = false;
    gpsSession++;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    clearTimeout(firstFixTimer);
    firstFixTimer = null;
    cancelAddress();
    clearTimeout(gpsTimer);
    gpsTimer = null;
    pendingPosition = null;
    byId('start-gps').disabled = false;
    byId('stop-gps').disabled = true;
  }

  function stopGps() {
    if (autoEnabled) disableAutoNarration();
    stopTracking();
    cancelNearby();
    currentLocation = null;
    tourMap?.clearLocation?.();
    setText('current-source', 'noLocation');
    byId('current-accuracy').textContent = '—';
    showAddress(t('locationUnknown'), '—', '—', 'locationUnknown');
    poiDistanceStatus = 'distanceEnableGps';
    updatePoiDistances();
    setMessage('gps-status', 'gpsStopped');
    setMessage('gps-message', 'trackingStopped');
    setResult('idle', 'locationStopped', 'restartLocationHelp');
    setText('result-source', 'gpsCheckStopped');
  }

  function gpsError(error) {
    stopTracking();
    cancelNearby();
    currentLocation = null;
    tourMap?.clearLocation?.();
    setText('current-source', 'noLocation');
    byId('current-accuracy').textContent = '—';
    showAddress(t('locationUnknown'), '—', '—', 'locationUnknown');
    poiDistanceStatus = 'distanceGpsUnavailable';
    updatePoiDistances();
    const messages = {
      1: ['gpsDenied', 'gpsPermissionHelp'],
      2: ['gpsUnavailable', 'gpsUnavailableHelp'],
      3: ['gpsFailure', 'gpsTimeoutHelp'],
    };
    const [status, message] = messages[error.code] || ['gpsFailure', 'gpsInvalidHelp'];
    setMessage('gps-status', status, 'error');
    setMessage('gps-message', message, 'error');
    setResult('idle', 'trySimulation', message);
    if (autoEnabled) setMessage('auto-status', 'realGpsStoppedSimulation', 'info');
    setText('result-source', 'noLocationResult');
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
    clearTimeout(firstFixTimer);
    firstFixTimer = null;
    const { latitude, longitude, accuracy } = position.coords;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      gpsError({ code: 0 });
      return;
    }
    const location = { latitude, longitude, accuracy };
    const changed = displayLocation(location, 'GPS thật');
    setMessage('gps-status', 'gpsActive', 'success');
    setMessage('gps-message', 'trackingPosition');
    if (changed) {
      setResult('loading', 'updatingPosition', 'checkingLatestPosition');
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
      poiDistanceStatus = 'distanceGpsUnavailable';
      updatePoiDistances();
      setMessage('gps-status', 'gpsUnavailable', 'error');
      setMessage('gps-message', !navigator.geolocation
        ? 'gpsUnsupportedHelp'
        : 'gpsSecureContextHelp', 'error');
      if (autoEnabled) setMessage('auto-status', 'realGpsUnavailableSimulation', 'info');
      return;
    }
    cancelNearby();
    clearNarration();
    if (currentLocation?.source === 'GPS giả lập') {
      currentLocation = null;
      tourMap?.clearLocation?.();
      setText('current-source', 'noLocation');
      byId('current-accuracy').textContent = '—';
      insidePoiIds.clear();
      selectedPoiId = null;
      pendingAutoEntry = null;
    }
    poiDistanceStatus = 'distanceWaitingGps';
    updatePoiDistances();
    cancelAddress();
    showAddress(t('locationUnknown'), '—', '—', 'locationUnknown');
    gpsActive = true;
    const session = ++gpsSession;
    lastGpsRequest = -Infinity;
    byId('start-gps').disabled = true;
    byId('stop-gps').disabled = false;
    setMessage('gps-status', 'gettingLocation', 'info');
    setMessage('gps-message', 'gpsPermissionPrompt');
    setResult('loading', 'waitingForPosition', 'allowLocationHelp');
    setText('result-source', 'waitingRealGps');

    try {
      firstFixTimer = setTimeout(() => {
        if (gpsActive && session === gpsSession) gpsError({ code: 3 });
      }, FIRST_FIX_TIMEOUT_MS);
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
      setMessage('simulation-message', 'invalidCoordinatesHelp', 'error');
      byId(latitude === null ? 'demo-lat' : 'demo-lng').focus();
      return;
    }
    stopTracking();
    cancelNearby();
    setMessage('gps-status', 'gpsSimulated');
    setMessage('gps-message', 'simulationTrackingHelp');
    setMessage('simulation-message', 'simulationChecking', 'info');
    const location = { latitude, longitude };
    displayLocation(location, 'GPS giả lập');
    checkNearby(location, 'GPS giả lập');
  }

  function usePoiCoordinates(poi) {
    byId('demo-lat').value = String(poi.latitude);
    byId('demo-lng').value = String(poi.longitude);
    byId('demo-lat').setAttribute('aria-invalid', 'false');
    byId('demo-lng').setAttribute('aria-invalid', 'false');
    setMessage('simulation-message', 'selectedPoiSimulation', 'success', { name: poi.name });
    if (!gpsActive) {
      setMessage('gps-message', 'selectedCoordinatesHelp');
      setResult('idle', 'coordinatesReady', 'checkSelectedCoordinates');
      setText('result-source', 'selectedCoordinatesUnchecked');
    }
    byId('demo-lat').focus({ preventScroll: true });
    byId('simulation').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }


function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function applyPoiSearch() {
  if (!loadedPois) return;

  const result = byId('poi-search-result');

  if (!poiSearch) {
    poiCards.forEach(({ card }) => {
      card.hidden = false;
    });
    result.hidden = true;
    return;
  }

  let count = 0;

  for (const { poi, card } of poiCards) {
    const address = [
      poi.streetAddress,
      poi.ward,
      poi.city,
      poi.address
    ].filter(Boolean).join(' ');

    const keywordMatch = !poiSearch.keyword ||
      normalizeSearch(poi.name).includes(poiSearch.keyword) ||
      normalizeSearch(address).includes(poiSearch.keyword);

    const statusMatch = poiSearch.status === 'all' ||
      (poiSearch.status === 'active' && poi.isActive === true) ||
      (poiSearch.status === 'inactive' && poi.isActive !== true);

    let distanceMatch = true;

    if (poiSearch.distance !== 'all') {
      const location = currentLocation?.source === 'GPS giả lập' ||
        gpsActive ? currentLocation : null;

      distanceMatch = validPoint(location) &&
        validPoint(poi) &&
        distanceMeters(location, poi) <= Number(poiSearch.distance);
    }

    const matched = keywordMatch && statusMatch && distanceMatch;

    card.hidden = !matched;

    if (matched) count++;
  }

  result.hidden = false;
  setText(
    'poi-search-result',
    count > 0 ? 'searchResultCount' : 'searchNoResults',
    { count }
  );
}

  function searchPois(event) {
    event.preventDefault();

    if (!loadedPois) return;

    const keyword = normalizeSearch(
      byId('poi-search-keyword').value
    );

    const status = byId('poi-search-status').value;
    const distance = byId('poi-search-distance').value;

    const location = currentLocation?.source === 'GPS giả lập' ||
      gpsActive ? currentLocation : null;
    if (distance !== 'all' && !validPoint(location)) {
      const result = byId('poi-search-result');
      result.hidden = false;
      setText('poi-search-result', 'searchNeedGps');

      result.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
      return;
    }
    poiSearch = { keyword, status, distance };
    applyPoiSearch();
    byId('poi-search-result').scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  function renderPoiList(pois) {
    loadedPois = pois;
    scheduleTranslationRefresh();
    const list = byId('poi-list');
    list.replaceChildren();
    poiCards = [];
    poiOrder = [];
    for (const [index, original] of pois.entries()) {
      const poi = displayPoi(original);
      const card = byId('poi-template').content.firstElementChild.cloneNode(true);
      const active = poi.isActive === true;
      card.dataset.inactive = String(!active);
      card.querySelector('.poi-name').textContent = poi.name;
      card.querySelector('.poi-category').textContent = categoryLabel(poi.category);
      const savedAddress = [poi.streetAddress, poi.ward, poi.city]
        .filter((part) => typeof part === 'string' && part.trim()).map((part) => part.trim()).join(', ');
      card.querySelector('.poi-address').textContent = (byId('language').value === 'vi' ? savedAddress || poi.address : poi.address || savedAddress) || t('noAddress');
      card.querySelector('.poi-coordinates').textContent = `${poi.latitude}, ${poi.longitude}`;
      card.querySelector('.poi-radius').textContent = `${poi.geofenceRadius} m`;
      const status = card.querySelector('.poi-status');
      status.textContent = t(active ? 'active' : 'inactive');
      status.dataset.tone = active ? 'success' : 'neutral';
      const button = card.querySelector('.poi-use');
      button.disabled = !active || !validPoint(poi);
      button.setAttribute('aria-label', t('usePoiCoordinatesLabel', { name: poi.name }));
      for (const key of ['technicalDetails', 'coordinates', 'radius', 'useCoordinates']) {
        const label = card.querySelector(`[data-i18n="${key}"]`);
        if (label) label.textContent = t(key);
      }
      button.addEventListener('click', () => usePoiCoordinates(poi));
      list.append(card);
      poiCards.push({ poi, card, index });
      poiOrder.push(index);
    }
    updatePoiDistances();
    applyPoiSearch();
    setText('poi-count', 'poiCount', { active: pois.filter((poi) => poi.isActive === true).length, total: pois.length });
    byId('poi-message').hidden = pois.length > 0;
    setMessage('poi-message', 'noPoiData');
  }
  function refreshDisplayedPoi() {
    if (!loadedPois) return;
    tourMap?.setPois(loadedPois.map(displayPoi));
    if (currentPoi) {
      const source = loadedPois.find((poi) => poi.id === currentPoi.id);
      if (source) currentPoi = displayPoi(source);
    }
    if (displayedNearbyPoi) {
      const source = loadedPois.find((poi) => poi.id === displayedNearbyPoi.id);
      if (source) {
        const poi = displayPoi(source);
        displayedNearbyPoi = { ...poi, distance: displayedNearbyPoi.distance };
        byId('nearest-name').textContent = t('arrivedAtName', { name: poi.name });
        byId('nearest-description').textContent = poi.description || '';
        const parts = [poi.streetAddress, poi.ward, poi.city].filter(Boolean).join(', ');
        byId('nearest-address').textContent = byId('language').value === 'vi' ? parts || poi.address : poi.address || parts;
      }
    }
  }
  function scheduleTranslationRefresh() {
    clearTimeout(translationRefreshTimer);
    if (disposed || !loadedPois?.some((poi) => poi.translationPending)) return;
    const revision = poiListRevision;
    translationRefreshTimer = setTimeout(async () => {
      try {
        const pois = await fetchJson('/api/pois', new AbortController());
        if (revision !== poiListRevision) return;
        if (!disposed && Array.isArray(pois)) {
          renderPoiList(pois);
          refreshDisplayedPoi();
        } else if (!disposed) scheduleTranslationRefresh();
      } catch { scheduleTranslationRefresh(); }
    }, 15000);
  }

  async function loadPois() {
    ++poiListRevision;
    clearTimeout(translationRefreshTimer);
    byId('reload-pois').disabled = true;
    byId('poi-list').setAttribute('aria-busy', 'true');
    byId('poi-list').replaceChildren();
    poiCards = [];
    poiOrder = [];
    loadedPois = null;
    byId('poi-message').hidden = false;
    setMessage('poi-message', 'loadingPoisMessage');
    setText('poi-count', 'loadingPois');
    try {
      const pois = await fetchJson('/api/pois', new AbortController());
      if (!Array.isArray(pois)) throw new Error(t('invalidPoiList'));
      renderPoiList(pois);
      refreshDisplayedPoi();
    } catch (error) {
      tourMap?.setPois([]);
      tourMap?.setStatus?.(t('mapPoiLoadError'), 'error');
      setMessage('poi-message', 'poiLoadRetry', 'error', { error: error.message });
      setText('poi-count', 'poiListUnavailable');
    } finally {
      byId('reload-pois').disabled = false;
      byId('poi-list').setAttribute('aria-busy', 'false');
    }
  }
  function applyTranslations() {
    const language = byId('language').value;
    const dictionary = translations[language] || translations[sourceLanguage];

    document.documentElement.lang = language;
    document.title = t('pageTitle');

    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.dataset.i18n;
      if (dictionary[key] !== undefined) {
        element.textContent = dictionary[key];
      }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
      const key = element.dataset.i18nPlaceholder;
      if (dictionary[key] !== undefined) {
        element.placeholder = dictionary[key];
      }
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
      element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
    });
    for (const [id, { key, params }] of dynamicText) {
      if (id === 'result-source' && key === 'resultFrom' && currentLocation) {
        params.source = t(currentLocation.source === 'GPS thật' ? 'gpsReal' : 'gpsSimulated');
      }
      byId(id).textContent = t(key, params);
    }
    if (addressDisplayKey) byId('current-street').textContent = t(addressDisplayKey);
    if (displayedNearbyPoi) byId('nearest-distance').textContent =
      `${displayedNearbyPoi.distance.toLocaleString(language, { maximumFractionDigits: 2 })} m`;
    if (lastResultAt && dynamicText.get('result-time')?.key === 'updatedAt') {
      setText('result-time', 'updatedAt', { time: lastResultAt.toLocaleTimeString(language) });
    }
    updatePoiDistances();
  }
  function updateLanguage() {
    const language = byId('language').value;
    applyTranslations();
    pendingAutoEntry = null;
    if (autoEnabled && currentPoi) setMessage('auto-status', 'autoPlayReady');
    setText('tour-button-label', autoEnabled ? 'stopTour' : 'startTour');
    setText('language-note', 'selectedLanguageHelp', { language: languageNames[language] });
    setText('audio-title', 'audioLanguage', { language: languageNames[language] });
    setText('narration-title', 'narrationLanguage', { language: languageNames[language] });
    if (loadedPois) {
      renderPoiList(loadedPois);
      refreshDisplayedPoi();
    }
    tourMap?.refreshLanguage?.();
    access.refreshLanguage?.();
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
  setText('gps-status', 'gpsStatus');
  setText('gps-message', 'gpsHelp');
  setText('current-source', 'noLocation');
  setText('simulation-message', 'simulationHint');
  setText('result-source', 'locationUnchecked');
  setText('poi-count', 'loadingPois');
  setMessage('narration-status', 'narrationWaiting');
  setMessage('audio-status', 'audioWaiting');
  updateLanguage();
  byId('language').addEventListener('change', updateLanguage);
  byId('start-gps').addEventListener('click', startGps);
  byId('stop-gps').addEventListener('click', stopGps);
  byId('toggle-tour').addEventListener('click', toggleTour);
  byId('simulation-form').addEventListener('submit', simulatePosition);
  byId('reload-pois').addEventListener('click', loadPois);
  byId('poi-search-form').addEventListener('submit', searchPois);
  byId('poi-search-reset').addEventListener('click', () => {
    byId('poi-search-keyword').value = '';
    byId('poi-search-status').value = 'all';
    byId('poi-search-distance').value = 'all';

    poiSearch = null;
    applyPoiSearch();

    byId('poi-list').scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  });
  byId('retry-narration').addEventListener('click', () => { if (currentPoi) loadNarration(currentPoi, true); });
  byId('generate-audio').addEventListener('click', generateAudio);
  byId('narration-audio').addEventListener('error', () => {
    if (byId('narration-audio').getAttribute('src')) {
      setMessage('audio-status', 'audioLoadError', 'error');
      if (autoEnabled) setMessage('auto-status', 'audioLoadError', 'error');
    }
  });
  access.subscribe((valid) => {
    if (!valid) { disableAutoNarration(); clearNarration(); }
  });
  window.addEventListener('pagehide', () => {
    disposed = true;
    clearTimeout(translationRefreshTimer);
    disableAutoNarration(); stopTracking(); cancelNearby(); clearNarration();
    currentLocation = null;
    poiDistanceStatus = 'distanceEnableGps';
    updatePoiDistances();
    tourMap?.destroy();
  });
  window.addEventListener('pageshow', (event) => { if (event.persisted) {
    disposed = false;
    tourMap?.init();
    scheduleTranslationRefresh();
  } });
  tourMap?.init();
  showAddress(t('locationUnknown'), '—', '—', 'locationUnknown');
  loadPois();
})();
