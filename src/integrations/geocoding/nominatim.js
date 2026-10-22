const endpoint = 'https://nominatim.openstreetmap.org/search';
const cache = new Map();
let queue = Promise.resolve();
let nextRequestAt = 0;
let pending = 0;

async function searchAddress(input) {
  const query = [input.streetAddress, input.ward, input.city, 'Việt Nam'].map((part) => part.trim()).join(', ');
  const key = query.toLocaleLowerCase('vi');
  const saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved.results;
  if (pending >= 20) throw Object.assign(new Error('Dịch vụ tìm địa chỉ đang bận.'), { statusCode: 503 });
  pending++;
  const task = queue.catch(() => {}).then(async () => {
    try {
      const wait = Math.max(0, nextRequestAt - Date.now());
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      nextRequestAt = Date.now() + 1100;
      const url = new URL(endpoint);
      url.search = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1',
        countrycodes: 'vn', limit: '5', 'accept-language': 'vi' }).toString();
      const response = await fetch(url, { headers: { 'User-Agent': 'AutoNarrationDemo/1.0 (admin POI address search)', Accept: 'application/json' },
        signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Geocoding unavailable');
      const raw = await response.json();
      if (!Array.isArray(raw)) throw new Error('Invalid geocoding response');
      const results = raw.map((item) => ({
        label: String(item.display_name || '').slice(0, 500),
        latitude: typeof item.lat === 'string' && item.lat.trim() ? Number(item.lat) : NaN,
        longitude: typeof item.lon === 'string' && item.lon.trim() ? Number(item.lon) : NaN,
      })).filter((item) => item.label && Number.isFinite(item.latitude) && Math.abs(item.latitude) <= 90
        && Number.isFinite(item.longitude) && Math.abs(item.longitude) <= 180);
      cache.set(key, { results, expires: Date.now() + 3600000 });
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      return results;
    } catch {
      throw Object.assign(new Error('Không tìm được địa chỉ lúc này. Bạn có thể đặt ghim thủ công.'), { statusCode: 503 });
    } finally { pending--; }
  });
  queue = task.catch(() => {});
  return task;
}

module.exports = { searchAddress };
