const express = require('express');
const { requireAdmin, requireRoles } = require('../middlewares/requireAdmin');
const csrf = require('../middlewares/csrf');
const { searchAddress } = require('../integrations/geocoding/nominatim');
const vietmap = require('../integrations/geocoding/vietmap');

const router = express.Router();
const manage = [requireAdmin, requireRoles('ADMIN', 'POI_MANAGER'), csrf()];
const providerError = (res, error) => res.status(error.statusCode || 503).json({
  code: error.code || 'GEOCODE_PROVIDER', error: error.statusCode ? error.message : 'Dịch vụ địa chỉ tạm thời không khả dụng.',
});

router.get('/geocode/reverse', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { lat, lng } = req.query;
  const numeric = (value, limit) => typeof value === 'string' && value.trim()
    && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit;
  if (!numeric(lat, 90) || !numeric(lng, 180)) return res.status(400).json({ error: 'Tọa độ chưa hợp lệ.' });
  try { return res.json(await vietmap.reverse(Number(lat), Number(lng))); }
  catch (error) { return providerError(res, error); }
});

router.post('/admin/geocode/suggest', ...manage, async (req, res) => {
  const { streetAddress, ward = '', city = '' } = req.body || {};
  if (typeof streetAddress !== 'string' || streetAddress.trim().length < 3 || streetAddress.length > 180
    || typeof ward !== 'string' || ward.length > 150 || typeof city !== 'string' || city.length > 150) {
    return res.status(400).json({ error: 'Địa chỉ tìm kiếm chưa hợp lệ.' });
  }
  try { return res.json({ results: await vietmap.suggest({ streetAddress: streetAddress.trim(), ward: ward.trim(), city: city.trim() }) }); }
  catch (error) { return providerError(res, error); }
});

router.post('/admin/geocode/place', ...manage, async (req, res) => {
  const { id } = req.body || {};
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Gợi ý không hợp lệ.' });
  try { return res.json(await vietmap.place(id)); }
  catch (error) { return providerError(res, error); }
});

router.post('/admin/geocode', requireAdmin, requireRoles('ADMIN', 'POI_MANAGER'), csrf(), async (req, res, next) => {
  const { streetAddress, ward, city } = req.body || {};
  if (![streetAddress, ward, city].every((value) => typeof value === 'string' && value.trim().length > 0)
    || streetAddress.length > 180 || ward.length > 150 || city.length > 150) {
    return res.status(400).json({ error: 'Nhập số nhà/đường, phường/xã và tỉnh/thành phố.' });
  }
  try { return res.json({ results: await searchAddress({ streetAddress, ward, city }) }); }
  catch (error) { return next(error); }
});
module.exports = router;
