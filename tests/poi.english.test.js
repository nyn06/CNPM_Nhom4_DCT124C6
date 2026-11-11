jest.mock('../src/integrations/translation/translation.provider', () => ({ translate: jest.fn() }));

const { createHash } = require('crypto');
const request = require('supertest');
const adminRequest = require('./helpers/auth-request');
const app = require('../src/app');
const pois = require('../src/repositories/poi.repository');
const rows = require('../src/repositories/poi-translation.repository');
const service = require('../src/services/poi-translation.service');
const provider = require('../src/integrations/translation/translation.provider');
const { englishName, englishAddress } = require('../src/services/poi-english');

const source = { id: 'poi-english', name: 'Hủ Tiếu',
  description: 'Hủ tiếu là món ăn quen thuộc của miền Nam.',
  address: '40 Đường Tú Xương, Phường Xuân Hòa, Thành phố Hồ Chí Minh',
  category: 'food', latitude: 10, longitude: 106, geofenceRadius: 50, isActive: true };
const hash = (value) => createHash('sha256').update(value || '', 'utf8').digest('hex');

beforeEach(() => {
  pois.clear(); rows.clear();
  pois.create(source);
  provider.translate.mockReset().mockImplementation(async (_text, from, to) => ({ text: from === 'en' && to === 'vi'
    ? source.description : 'Hu Tieu is a familiar dish in Southern Vietnam.' }));
});

test('English name and address preserve proper names, numbers and administrative units', () => {
  expect(englishName('Bún Thịt Nướng Phố Nhỏ')).toBe('Bun Thit Nuong Pho Nho');
  expect(englishAddress(source.address)).toBe('40 Tu Xuong Street, Xuan Hoa Ward, Ho Chi Minh City');
  expect(englishAddress('12 Phố Huế, P. 7, Q. 3, TP. Hồ Chí Minh'))
    .toBe('12 Hue Street, 7 Ward, 3 District, Ho Chi Minh City');
  expect(englishAddress('252 Hồ Học Lãm, Xã Bình Chánh, Huyện Bình Chánh'))
    .toBe('252 Ho Hoc Lam, Binh Chanh Commune, Binh Chanh District');
  expect(englishAddress('40 Tú Xương, Phường Xuân Hòa', '40 Tú Xương'))
    .toBe('40 Tu Xuong Street, Xuan Hoa Ward');
  expect(englishAddress('5 Đường Street, Thị xã Sơn Tây, Thị trấn Củ Chi, Tỉnh Long An'))
    .toBe('5 Street, Son Tay Town, Cu Chi Township, Long An Province');
});

test('EN description uses provider while name and address need no provider calls', async () => {
  await service.translate(source.id, { targetLanguages: ['en'] });
  expect(provider.translate).toHaveBeenCalledTimes(2);
  expect(provider.translate).toHaveBeenCalledWith('Hu Tieu là món ăn quen thuộc của miền Nam.', 'vi', 'en');
  const english = (await request(app).get('/api/pois?lang=en')).body[0];
  expect(english).toMatchObject({ name: 'Hu Tieu',
    address: '40 Tu Xuong Street, Xuan Hoa Ward, Ho Chi Minh City',
    description: 'Hu Tieu is a familiar dish in Southern Vietnam.' });
  await service.translate(source.id, { targetLanguages: ['en'] });
  expect(provider.translate).toHaveBeenCalledTimes(2);
});

test('legacy EN values are hidden and repaired without recreating the POI', async () => {
  await rows.save({ poiId: source.id, language: 'en', name: 'Hue Noodle Soup',
    address: '40 Street Street', description: source.description,
    nameSourceHash: hash(source.name), addressSourceHash: hash(source.address),
    descriptionSourceHash: hash(source.description), nameManual: false,
    addressManual: false, descriptionManual: false });
  const before = (await request(app).get('/api/pois?lang=en')).body[0];
  expect(before).toMatchObject({ name: 'Hu Tieu',
    address: '40 Tu Xuong Street, Xuan Hoa Ward, Ho Chi Minh City',
    description: source.description });
  const admin = (await adminRequest(app).get('/api/admin/pois')).body;
  expect(admin[0].resolvedTranslations.en.name).toBe('Hu Tieu');
  await service.translate(source.id, { targetLanguages: ['en'] });
  const after = (await rows.findByPoiIds([source.id]))[0];
  expect(after).toMatchObject({ name: 'Hu Tieu',
    address: '40 Tu Xuong Street, Xuan Hoa Ward, Ho Chi Minh City',
    description: 'Hu Tieu is a familiar dish in Southern Vietnam.' });
  expect(pois.findById(source.id)).toMatchObject(source);
});

test('legacy descriptions that lose the POI dish name remain visible as unverified', async () => {
  await rows.save({ poiId: source.id, language: 'en', name: 'Hu Tieu',
    address: englishAddress(source.address), description: 'A noodle shop in Southern Vietnam.',
    nameSourceHash: hash(source.name), addressSourceHash: hash(source.address),
    descriptionSourceHash: hash(source.description), nameManual: false,
    addressManual: false, descriptionManual: false });
  const view = (await request(app).get('/api/pois?lang=en')).body[0];
  expect(view.description).toBe('A noodle shop in Southern Vietnam.');
  expect(view.translationStatus.en.description).toBe('unverified');
  expect(view.translationFallback.en).toBe(false);
  expect((await rows.findByPoiIds([source.id]))[0].description)
    .toBe('A noodle shop in Southern Vietnam.');
});

test('saved description with the wrong target language is rejected and falls back', async () => {
  await rows.save({ poiId: source.id, language: 'ja', name: 'Hu Tieu',
    address: '40 Tu Xuong 通り', description: 'This is an English description.',
    nameSourceHash: hash(source.name), addressSourceHash: hash(source.address),
    descriptionSourceHash: hash(source.description), nameManual: false,
    addressManual: false, descriptionManual: false });
  const view = (await request(app).get(`/api/pois/${source.id}?lang=ja`)).body;
  expect(view.description).toBe(source.description);
  expect(view.translationStatus.ja.description).toBe('rejected');
  expect(view.translationFallback.ja).toBe(true);
});

test('invalid provider output cannot replace a saved translation', async () => {
  await service.translate(source.id, { targetLanguages: ['en'] });
  pois.update(source.id, { description: 'Món ăn mới ở Sài Gòn.' });
  provider.translate.mockResolvedValue({ text: 'Mon an moi o Sai Gon.' });
  await expect(service.translate(source.id, { targetLanguages: ['en'] })).rejects.toMatchObject({ statusCode: 502 });
  const row = (await rows.findByPoiIds([source.id]))[0];
  expect(row.description).toBe('Hu Tieu is a familiar dish in Southern Vietnam.');
  expect((await request(app).get('/api/pois?lang=en')).body[0].description).toBe('Món ăn mới ở Sài Gòn.');
});

test('low-fidelity back translation is saved with unverified status', async () => {
  provider.translate.mockImplementation(async (_text, from) => ({ text: from === 'en'
    ? 'Hủ Tiếu ở đó.' : 'Hu Tieu is a familiar dish in Southern Vietnam.' }));
  await service.translate(source.id, { targetLanguages: ['en'] });
  const view = (await request(app).get('/api/pois?lang=en')).body[0];
  expect(view.description).toBe('Hu Tieu is a familiar dish in Southern Vietnam.');
  expect(view.translationStatus.en.description).toBe('unverified');
  expect(view.translationFallback.en).toBe(false);
  expect((await rows.findByPoiIds([source.id]))).toHaveLength(1);
});

test('usable EN, JA and KO descriptions stay visible with unverified status', async () => {
  provider.translate.mockImplementation(async (_text, _source, target) => ({ text: target === 'vi'
    ? 'Hủ Tiếu ở đó.' : { en: 'Hu Tieu is a familiar dish in Southern Vietnam.',
      ja: 'Hu Tieu はベトナム南部の料理です。',
      ko: 'Hu Tieu는 베트남 남부 음식입니다.' }[target] }));
  await service.translate(source.id, { targetLanguages: ['en', 'ja', 'ko'] });
  for (const language of ['en', 'ja', 'ko']) {
    const view = (await request(app).get(`/api/pois/${source.id}?lang=${language}`)).body;
    expect(view.description).not.toBe(source.description);
    expect(view.description).toContain('Hu Tieu');
    expect(view.translationStatus[language].description).toBe('unverified');
    expect(view.translationFallback[language]).toBe(false);
  }
  expect((await rows.findByPoiIds([source.id]))).toHaveLength(3);
});

test('English provider receives protected POI name and culinary broth term', async () => {
  pois.update(source.id, { description: 'Hủ Tiếu có nước dùng thơm ngon ở miền Nam Việt Nam.' });
  provider.translate.mockImplementation(async (_text, from) => ({ text: from === 'en'
    ? 'Hủ Tiếu có nước dùng thơm ngon ở miền Nam Việt Nam.'
    : 'Hu Tieu has delicious broth in Southern Vietnam.' }));
  await service.translate(source.id, { targetLanguages: ['en'] });
  expect(provider.translate).toHaveBeenCalledWith('Hu Tieu có broth thơm ngon ở miền Nam Việt Nam.', 'vi', 'en');
  expect((await rows.findByPoiIds([source.id]))[0].description)
    .toBe('Hu Tieu has delicious broth in Southern Vietnam.');
});

test('JA and KO use the same Latin Vietnamese name as EN', async () => {
  for (const language of ['ja', 'ko']) {
    await rows.save({ poiId: source.id, language, name: 'Hu Tieu',
      nameSourceHash: hash(source.name), nameManual: false });
    const view = (await request(app).get(`/api/pois/${source.id}?lang=${language}`)).body;
    expect(view.name).toBe('Hu Tieu');
  }
  const admin = (await adminRequest(app).get(`/api/admin/pois/${source.id}`)).body;
  expect(admin.translations.ja.stale.name).toBe(false);
  expect(admin.translations.ko.stale.name).toBe(false);
  expect((await request(app).get('/api/pois?lang=ja')).body[0].address)
    .toBe('40 Tu Xuong 通り, Xuan Hoa 坊, Ho Chi Minh 市');
  expect((await request(app).get('/api/pois?lang=ko')).body[0].address)
    .toBe('40 Tu Xuong 거리, Xuan Hoa 프엉, Ho Chi Minh 시');
});
