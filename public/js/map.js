(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const t = (key) => window.tourT
    ? window.tourT(key)
    : window.TOUR_TRANSLATIONS?.vi?.[key] ?? key;
  const tiles = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileErrorMessage = () => t('mapTileError');
  let map = null;
  let poiLayer = null;
  let radiusLayer = null;
  let locationMarker = null;
  let accuracyCircle = null;
  let location = null;
  let pois = [];
  let markers = [];
  let tileFailures = 0;
  let tileSuccesses = 0;
  let tileWarning = false;
  let statusKey = null;

  function status(message, tone = 'neutral') {
    statusKey = Object.keys(window.TOUR_TRANSLATIONS?.vi || {}).find((key) => t(key) === message) || null;
    byId('map-status').textContent = message;
    byId('map-status').dataset.tone = tone;
  }

  function validPoint(point) {
    return Number.isFinite(point?.latitude) && point.latitude >= -90 && point.latitude <= 90
      && Number.isFinite(point?.longitude) && point.longitude >= -180 && point.longitude <= 180;
  }

  function popup(poi) {
    const content = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = poi.name;
    content.append(title);
    if (poi.description) {
      const description = document.createElement('p');
      description.textContent = poi.description.slice(0, 180);
      content.append(description);
    }
    if (location) {
      const distance = document.createElement('p');
      const meters = Math.round(map.distance(
        [location.latitude, location.longitude],
        [poi.latitude, poi.longitude]
      ));

      distance.textContent = t('distanceFromYou')
        .replace('{distance}', meters);

      content.append(distance);
    }
    return content;
  }

  function renderPois() {
    if (!map) return;
    poiLayer.clearLayers();
    radiusLayer.clearLayers();
    markers = [];
    for (const poi of pois) {
      const point = [poi.latitude, poi.longitude];
      const marker = window.L.marker(point).addTo(poiLayer);
      marker.bindPopup(popup(poi));
      window.L.circle(point, {
        radius: poi.geofenceRadius, color: '#50774d', weight: 2,
        fillColor: '#87ac7b', fillOpacity: 0.13, interactive: false,
      }).addTo(radiusLayer);
      markers.push({ marker, poi });
    }
    if (!location && pois.length) {
      const points = pois.map((poi) => [poi.latitude, poi.longitude]);
      if (points.length === 1) map.setView(points[0], 14);
      else map.fitBounds(window.L.latLngBounds(points).pad(0.18));
    }
  }

  function updatePopups() {
    for (const { marker, poi } of markers) marker.setPopupContent(popup(poi));
  }

  function renderLocation(center = false) {
    if (!map || !location) return;
    const point = [location.latitude, location.longitude];
    const simulated = location.source === 'GPS giả lập';
    const color = simulated ? '#c36b43' : '#2676ae';
    if (locationMarker) {
      locationMarker.setLatLng(point);
      locationMarker.setStyle({ color, fillColor: color });
    } else {
      locationMarker = window.L.circleMarker(point, {
        radius: 8, color, fillColor: color, fillOpacity: 1, weight: 2,
      }).addTo(map);
    }
    locationMarker.bindPopup(simulated ? t('simulatedLocation') : t('realLocation'));
    if (!simulated && Number.isFinite(location.accuracy) && location.accuracy > 0) {
      if (accuracyCircle) accuracyCircle.setLatLng(point).setRadius(location.accuracy);
      else accuracyCircle = window.L.circle(point, {
        radius: location.accuracy, color, weight: 1, fillOpacity: 0.08, interactive: false,
      }).addTo(map);
    } else if (accuracyCircle) {
      map.removeLayer(accuracyCircle);
      accuracyCircle = null;
    }
    byId('map-recenter').disabled = false;
    updatePopups();
    if (center) map.setView(point, Math.max(map.getZoom(), 15));
  }

  function init() {
    if (map) return true;
    if (!window.L || !byId('poi-map')) {
      status(t('mapLibraryError'), 'error');
      return false;
    }
    try {
      map = window.L.map('poi-map', { scrollWheelZoom: false }).setView([20, 0], 2);
      poiLayer = window.L.layerGroup().addTo(map);
      radiusLayer = window.L.layerGroup().addTo(map);
      window.L.tileLayer(tiles, {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      }).on('loading', () => { tileFailures = 0; tileSuccesses = 0; })
        .on('tileerror', () => { tileFailures++; })
        .on('tileload', () => { tileSuccesses++; })
        .on('load', () => {
          if (tileFailures > 0 && tileSuccesses === 0) {
            tileWarning = true;
            status(tileErrorMessage(), 'error');
          } else if (tileSuccesses > 0 && tileWarning) {
            tileWarning = false;
            if (byId('map-status').textContent === tileErrorMessage()) status(t('mapReady'));
          }
        })
        .addTo(map);
      renderPois();
      renderLocation(!!location);
      status(t('mapReady'));
      return true;
    } catch {
      map?.remove();
      map = null;
      status(t('mapInitError'), 'error');
      return false;
    }
  }

  function setPois(data) {
    pois = Array.isArray(data) ? data.filter((poi) => poi.isActive === true && validPoint(poi)
      && Number.isFinite(poi.geofenceRadius) && poi.geofenceRadius > 0
      && typeof poi.name === 'string').map((poi) => ({
      id: poi.id, name: poi.name, description: typeof poi.description === 'string' ? poi.description : '',
      latitude: poi.latitude, longitude: poi.longitude, geofenceRadius: poi.geofenceRadius,
    })) : [];
    renderPois();
    if (map && !pois.length) status(t('noActiveMapPois'));
  }

  function setLocation(next) {
    if (!validPoint(next)) return;
    const first = !location || location.source !== next.source;
    location = { latitude: next.latitude, longitude: next.longitude, accuracy: next.accuracy, source: next.source };
    renderLocation(first);
  }

  function clearLocation() {
    if (map && locationMarker) map.removeLayer(locationMarker);
    if (map && accuracyCircle) map.removeLayer(accuracyCircle);
    locationMarker = null;
    accuracyCircle = null;
    location = null;
    byId('map-recenter').disabled = true;
    updatePopups();
  }

  function destroy() {
    if (map) map.remove();
    map = null;
    poiLayer = null;
    radiusLayer = null;
    locationMarker = null;
    accuracyCircle = null;
    markers = [];
    tileFailures = 0;
    tileSuccesses = 0;
    tileWarning = false;
    byId('map-recenter').disabled = true;
  }

  function refreshLanguage() {
    if (statusKey) byId('map-status').textContent = t(statusKey);
    if (map && location) renderLocation();
  }

  byId('map-recenter').addEventListener('click', () => {
    if (map && location) map.setView([location.latitude, location.longitude], Math.max(map.getZoom(), 15));
  });
  window.TOUR_MAP = { init, setPois, setLocation, clearLocation, setStatus: status, refreshLanguage, destroy };
})();
