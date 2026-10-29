jest.mock('../src/integrations/translation/translation.provider', () => ({ translate: jest.fn() }));

const request = require('./helpers/auth-request');
const publicRequest = require('supertest');
const app = require('../src/app');
const pois = require('../src/repositories/poi.repository');
const translations = require('../src/repositories/poi-translation.repository');
const service = require('../src/services/poi.service');
const provider = require('../src/integrations/translation/translation.provider');

let poi;
beforeEach(() => {
  pois.clear();
  translations.clear();
  provider.translate.mockReset().mockImplementation(async (text, _source, language) => ({ text: `${language}: ${text}` }));
  poi = service.createPoi({ name: 'Hủ Tiếu', description: 'Món ăn Việt', category: 'Món ăn',
    address: '40 Tú Xương', latitude: 10, longitude: 106, geofenceRadius: 50 });
});

test('public language selection falls back to Vietnamese until details are translated', async () => {
  const before = await publicRequest(app).get(`/api/pois/${poi.id}?lang=en`);
  expect(before.body).toMatchObject({ name: poi.name, address: poi.address });
  const result = await request(app).post(`/api/pois/${poi.id}/details-translations`)
    .send({ targetLanguages: ['en', 'ja', 'ko'] });
  expect(result.status).toBe(200);
  expect(provider.translate).toHaveBeenCalledTimes(9);
  const english = await publicRequest(app).get('/api/pois?lang=en');
  expect(english.body[0]).toMatchObject({ name: 'en: Hủ Tiếu', description: 'en: Món ăn Việt',
    address: 'en: 40 Tú Xương', category: 'Món ăn' });
  expect(english.body[0].translations.en.name).toBe('en: Hủ Tiếu');
  const nearby = await publicRequest(app).get('/api/pois/nearby?lat=10&lng=106&lang=ja');
  expect(nearby.body.nearestPoi.name).toBe('ja: Hủ Tiếu');
  expect((await publicRequest(app).get(`/api/pois/${poi.id}?lang=vi`)).body.name).toBe('Hủ Tiếu');
});

test('only changed source fields become stale and are translated again', async () => {
  const url = `/api/pois/${poi.id}/details-translations`;
  await request(app).post(url).send({ targetLanguages: ['en'] });
  provider.translate.mockClear();
  await request(app).post(url).send({ targetLanguages: ['en'] });
  expect(provider.translate).not.toHaveBeenCalled();
  service.updatePoi(poi.id, { name: 'Hủ Tiếu Nam Vang' });
  const stale = await request(app).get(`/api/admin/pois/${poi.id}/details-translations`);
  expect(stale.body.translations.en.stale).toEqual({ name: true, description: false, address: false });
  expect((await publicRequest(app).get(`/api/pois/${poi.id}?lang=en`)).body.name).toBe('Hủ Tiếu Nam Vang');
  await request(app).post(url).send({ targetLanguages: ['en'] });
  expect(provider.translate).toHaveBeenCalledTimes(1);
  expect(provider.translate).toHaveBeenCalledWith('Hủ Tiếu Nam Vang', 'vi', 'en');
});

test('manual edits survive automatic translation and narration stays separate', async () => {
  const base = `/api/pois/${poi.id}`;
  await request(app).post(`${base}/details-translations`).send({ targetLanguages: ['en'] });
  const edited = await request(app).put(`${base}/details-translations/en`).send({ name: 'Hu Tieu' });
  expect(edited.status).toBe(200);
  service.updatePoi(poi.id, { name: 'Hủ Tiếu Nam Vang', description: 'Món ăn mới' });
  provider.translate.mockClear();
  await request(app).post(`${base}/details-translations`).send({ targetLanguages: ['en'] });
  const detail = await request(app).get(`/api/admin/pois/${poi.id}/details-translations`);
  expect(detail.body.translations.en.name).toBe('Hu Tieu');
  expect(detail.body.translations.en.stale.name).toBe(true);
  expect(detail.body.translations.en.description).toBe('en: Món ăn mới');
  expect(provider.translate).toHaveBeenCalledTimes(1);
  expect(pois.findById(poi.id).narrations).toBeUndefined();
});

test('unrelated machine name is rejected without saving partial translations', async () => {
  provider.translate.mockImplementation(async (text) => ({ text: text.includes('40')
    ? '1806 Wrong Street' : text === 'Hủ Tiếu' ? 'Bind' : `Translated ${text}` }));
  await request(app).post(`/api/pois/${poi.id}/details-translations`).send({ targetLanguages: ['en'] }).expect(502);
  expect((await translations.findByPoiIds([poi.id]))).toHaveLength(0);
});

test('unsafe machine address preserves place names and house numbers', async () => {
  provider.translate.mockImplementation(async (text) => ({ text: text.includes('40')
    ? '1806 Wrong Street' : text === 'Hủ Tiếu' ? 'Hu Tieu' : `Translated ${text}` }));
  await request(app).post(`/api/pois/${poi.id}/details-translations`).send({ targetLanguages: ['en'] }).expect(200);
  const row = (await request(app).get(`/api/admin/pois/${poi.id}/details-translations`)).body.translations.en;
  expect(row.name).toBe('Hu Tieu');
  expect(row.address).toBe('40 Tu Xuong Street');
  expect(row.description).toBe('Translated Món ăn Việt');
});

test('translation writes require admin session', async () => {
  const response = await publicRequest(app).post(`/api/pois/${poi.id}/details-translations`)
    .send({ targetLanguages: ['en'] });
  expect(response.status).toBe(401);
  expect(provider.translate).not.toHaveBeenCalled();
});
