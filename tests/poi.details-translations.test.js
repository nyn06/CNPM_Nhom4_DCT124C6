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
  provider.translate.mockReset().mockImplementation(async (text, _source, language) => ({
    text: language === 'vi' ? pois.findById(poi?.id)?.description || text
      : language === 'ja' ? 'ベトナム料理' : language === 'ko' ? '베트남 요리'
        : text === 'Món ăn mới' ? 'New dish' : 'Vietnamese dish',
  }));
  poi = service.createPoi({ name: 'Hủ Tiếu', description: 'Món ăn Việt', category: 'Món ăn',
    address: '40 Tú Xương', latitude: 10, longitude: 106, geofenceRadius: 50 });
});

test('public language selection falls back to Vietnamese until details are translated', async () => {
  const before = await publicRequest(app).get(`/api/pois/${poi.id}?lang=en`);
  expect(before.body).toMatchObject({ name: 'Hu Tieu', address: '40 Tu Xuong',
    description: poi.description });
  const result = await request(app).post(`/api/pois/${poi.id}/details-translations`)
    .send({ targetLanguages: ['en', 'ja', 'ko'] });
  expect(result.status).toBe(200);
  expect(provider.translate).toHaveBeenCalledTimes(6);
  const english = await publicRequest(app).get('/api/pois?lang=en');
  expect(english.body[0]).toMatchObject({ name: 'Hu Tieu', description: 'Vietnamese dish',
    address: '40 Tu Xuong', category: 'Món ăn' });
  expect(english.body[0].translations.en.name).toBe('Hu Tieu');
  const nearby = await publicRequest(app).get('/api/pois/nearby?lat=10&lng=106&lang=ja');
  expect(nearby.body.nearestPoi.name).toBe('Hu Tieu');
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
  expect((await publicRequest(app).get(`/api/pois/${poi.id}?lang=en`)).body.name).toBe('Hu Tieu Nam Vang');
  await request(app).post(url).send({ targetLanguages: ['en'] });
  expect(provider.translate).not.toHaveBeenCalled();
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
  expect(detail.body.translations.en.description).toBe('New dish');
  expect(provider.translate).toHaveBeenCalledTimes(2);
  expect(pois.findById(poi.id).narrations).toBeUndefined();
});

test('unrelated machine description is rejected without saving partial translations', async () => {
  provider.translate.mockImplementation(async (_text, source) => ({ text: source === 'ja'
    ? 'Không liên quan' : 'ログイン' }));
  await request(app).post(`/api/pois/${poi.id}/details-translations`).send({ targetLanguages: ['ja'] }).expect(502);
  expect((await translations.findByPoiIds([poi.id]))).toHaveLength(0);
});

test('unsafe machine address preserves place names and house numbers', async () => {
  provider.translate.mockImplementation(async (text, source) => ({ text: source === 'en'
    ? 'Món ăn Việt' : text.includes('40') ? '1806 Wrong Street' : 'Vietnamese dish' }));
  await request(app).post(`/api/pois/${poi.id}/details-translations`).send({ targetLanguages: ['en'] }).expect(200);
  const row = (await request(app).get(`/api/admin/pois/${poi.id}/details-translations`)).body.translations.en;
  expect(row.name).toBe('Hu Tieu');
  expect(row.address).toBe('40 Tu Xuong');
  expect(row.description).toBe('Vietnamese dish');
});

test('translation writes require admin session', async () => {
  const response = await publicRequest(app).post(`/api/pois/${poi.id}/details-translations`)
    .send({ targetLanguages: ['en'] });
  expect(response.status).toBe(401);
  expect(provider.translate).not.toHaveBeenCalled();
});
