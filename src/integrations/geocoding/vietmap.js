const crypto = require('crypto');

const baseUrl = 'https://maps.vietmap.vn';
const suggestions = new Map();
const places = new Map();
const reverses = new Map();
const hits = { suggest: [], place: [], reverse: [] };
const limits = { suggest: 60, place: 30, reverse: 30 };
const ttl = 5 * 60 * 1000;

function failure(code, statusCode, message) {
  return Object.assign(new Error(message), { code, statusCode });
}

function key() {
  const value = process.env.VIETMAP_API_KEY?.trim();
  if (!value) throw failure('GEOCODE_NOT_CONFIGURED', 503, 'Chưa cấu hình gợi ý địa chỉ VIETMAP.');
  return value;
}

function limit(type) {
  const now = Date.now();
  hits[type] = hits[type].filter((time) => now - time < 60000);
  if (hits[type].length >= limits[type]) throw failure('GEOCODE_RATE_LIMIT', 429, 'Đã đạt giới hạn tìm địa chỉ. Hãy thử lại sau.');
  hits[type].push(now);
}

async function provider(path, params, type) {
  const apiKey = key();
  const url = new URL(path, baseUrl);
  url.search = new URLSearchParams({ apikey: apiKey, ...params }).toString();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) {
      // Retry counts toward the same per-provider limit as a new request.
      limit(type);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    let response;
    try { response = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } }); }
    catch (error) {
      if (!attempt) continue;
      const cause = error?.cause?.code;
      if (error?.name === 'TimeoutError' || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(cause)) {
        throw failure('GEOCODE_TIMEOUT', 503, 'Dịch vụ địa chỉ phản hồi quá chậm.');
      }
      if (['ENOTFOUND', 'EAI_AGAIN'].includes(cause)) {
        throw failure('GEOCODE_DNS', 503, 'Không phân giải được tên miền dịch vụ địa chỉ.');
      }
      if (typeof cause === 'string' && /^(?:ERR_TLS_|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT)/.test(cause)) {
        throw failure('GEOCODE_TLS', 503, 'Không thiết lập được kết nối bảo mật tới dịch vụ địa chỉ.');
      }
      // Do not log the request URL: it contains the API key.
      console.warn('VietMap connection failure:', cause || error?.name || 'unknown');
      throw failure('GEOCODE_NETWORK', 503, 'Không kết nối được dịch vụ địa chỉ.');
    }
    if (response.status === 401 || response.status === 403) {
      throw failure('GEOCODE_AUTH', 503, 'Khóa dịch vụ địa chỉ chưa hợp lệ hoặc chưa được cấp quyền.');
    }
    if (response.status === 423 || response.status === 429) {
      throw failure('GEOCODE_QUOTA', 503, 'Dịch vụ địa chỉ đã đạt hạn mức hoặc chưa được kích hoạt.');
    }
    if (!response.ok) {
      if (!attempt && [502, 503, 504].includes(response.status)) continue;
      if ([502, 503, 504].includes(response.status)) {
        throw failure(`GEOCODE_HTTP_${response.status}`, 503,
          response.status === 504 ? 'VietMap hết thời gian phản hồi.' : 'VietMap tạm thời không khả dụng.');
      }
      throw failure('GEOCODE_PROVIDER', 503, 'Dịch vụ gợi ý địa chỉ tạm thời không khả dụng.');
    }
    try { return await response.json(); }
    catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw failure('GEOCODE_TIMEOUT', 503, 'Dịch vụ địa chỉ phản hồi quá chậm.');
      }
      throw failure('GEOCODE_INVALID_RESPONSE', 503, 'Phản hồi địa chỉ không hợp lệ.');
    }
  }
  throw failure('GEOCODE_PROVIDER', 503, 'Dịch vụ gợi ý địa chỉ tạm thời không khả dụng.');
}

function tidy(map) {
  const now = Date.now();
  for (const [id, item] of map) if (item.expires <= now) map.delete(id);
  while (map.size > 200) map.delete(map.keys().next().value);
}

async function suggest({ streetAddress, ward, city }) {
  key();
  const query = [streetAddress, ward, city].filter(Boolean).join(', ');
  const cacheKey = query.toLocaleLowerCase('vi');
  tidy(suggestions);
  const cached = suggestions.get(cacheKey);
  if (cached) return cached.items;
  limit('suggest');
  const raw = await provider('/api/autocomplete/v4', { text: query, display_type: '5' }, 'suggest');
  if (!Array.isArray(raw)) throw failure('GEOCODE_INVALID_RESPONSE', 503, 'Phản hồi địa chỉ không hợp lệ.');
  const items = raw.filter((row) => row && typeof row.ref_id === 'string'
    && /^(auto|geocode):[A-Za-z0-9_-]{1,500}$/.test(row.ref_id)
    && typeof row.display === 'string' && row.display.trim()).slice(0, 6).map((row) => {
    const id = crypto.randomUUID();
    places.set(id, { refId: row.ref_id, name: row.name, expires: Date.now() + ttl });
    return { id, name: String(row.name || '').slice(0, 180), address: String(row.address || '').slice(0, 300),
      display: row.display.slice(0, 500) };
  });
  if (raw.length && !items.length) throw failure('GEOCODE_INVALID_RESPONSE', 503, 'Phản hồi địa chỉ không hợp lệ.');
  tidy(places);
  suggestions.set(cacheKey, { items, expires: Date.now() + ttl });
  return items;
}

async function place(id) {
  key();
  tidy(places);
  const selected = places.get(id);
  if (!selected) throw failure('GEOCODE_EXPIRED', 404, 'Gợi ý đã hết hạn. Hãy tìm lại địa chỉ.');
  if (selected.result) return selected.result;
  limit('place');
  const raw = await provider('/api/place/v4', { refid: selected.refId }, 'place');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || typeof raw.lat !== 'number' || typeof raw.lng !== 'number'
    || !Number.isFinite(raw.lat) || Math.abs(raw.lat) > 90
    || !Number.isFinite(raw.lng) || Math.abs(raw.lng) > 180) {
    throw failure('GEOCODE_INVALID_RESPONSE', 503, 'Vị trí trả về không hợp lệ.');
  }
  const part = (value, max) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
  const road = part(raw.road || raw.pedestrian || raw.street || raw.footway, 180);
  const houseNumber = part(raw.house_number, 30);
  const street = road ? [houseNumber, road].filter(Boolean).join(' ') : null;
  const administrative = /^(?:phường|xã|thị trấn|quận|huyện|thành phố|tỉnh)(?:\s|$)/iu;
  const streetCandidate = (value) => {
    const text = part(value, 180)?.split(',')[0].trim();
    return text && !administrative.test(text)
      && /^(?:\d+[\p{L}\d/-]*\s+|đường\s+|phố\s+|ngõ\s+|hẻm\s+|quốc lộ\s+|tỉnh lộ\s+)/iu.test(text)
      ? text : null;
  };
  const suggestedStreet = streetCandidate(selected.name) || streetCandidate(raw.address);
  const suggestedHouse = suggestedStreet?.match(/^(\d+[\p{L}\d/-]*)\s+(.+)$/u);
  const roadName = (value) => value.replace(/^(?:đường|phố)\s+/iu, '').toLocaleLowerCase('vi');
  const matchingSuggestion = road && suggestedHouse && roadName(suggestedHouse[2]) === roadName(road);
  selected.result = {
    latitude: raw.lat, longitude: raw.lng,
    streetAddress: matchingSuggestion && !houseNumber ? suggestedStreet : street || suggestedStreet,
    ward: typeof raw.ward === 'string' && raw.ward.trim() ? raw.ward.trim().slice(0, 150) : null,
    city: typeof raw.city === 'string' && raw.city.trim() ? raw.city.trim().slice(0, 150) : null,
  };
  return selected.result;
}

async function reverse(latitude, longitude) {
  key();
  // Roughly 11 m cells avoid repeat lookups for GPS jitter without retaining user identity.
  const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  tidy(reverses);
  const cached = reverses.get(cacheKey);
  if (cached) return cached.result;
  limit('reverse');
  const raw = await provider('/api/reverse/v4', { lat: latitude, lng: longitude, display_type: '1' }, 'reverse');
  if (!Array.isArray(raw)) throw failure('GEOCODE_INVALID_RESPONSE', 503, 'Phản hồi địa chỉ không hợp lệ.');
  const item = raw[0];
  const boundaries = Array.isArray(item?.boundaries) ? item.boundaries : [];
  const part = (type, max) => {
    const value = boundaries.find((entry) => entry?.type === type)?.full_name;
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  };
  // Reverse v4 provides the nearest named address; its distance is informative,
  // not a guarantee of GPS accuracy and not a reason to discard a valid name.
  const streetAddress = typeof item?.name === 'string' ? item.name.trim().slice(0, 180) : '';
  const result = { streetAddress: streetAddress || '', ward: part(2, 150), city: part(0, 150) };
  reverses.set(cacheKey, { result, expires: Date.now() + 30 * 60 * 1000 });
  tidy(reverses);
  return result;
}

module.exports = { suggest, place, reverse };
