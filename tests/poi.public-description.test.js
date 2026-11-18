const { createHash } = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const pois = require('../src/repositories/poi.repository');
const translations = require('../src/repositories/poi-translation.repository');
const jobs = require('../src/repositories/poi-translation-job.repository');
const { verifiedHash, displayableUnverifiedHash } = require('../src/services/poi-description-hash');

const source = { id: 'public-description-poi', name: 'Bánh Canh Cua Sài Gòn',
  description: 'Quán phục vụ bánh canh với nước dùng cua.', address: '40 Tú Xương',
  category: 'food', latitude: 10, longitude: 106, geofenceRadius: 50, isActive: true };
const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const candidates = {
  en: 'The restaurant serves banh canh with crab broth.',
  ja: 'この店はカニのスープを使った banh canh を提供します。',
  ko: '이 식당은 게 육수로 만든 banh canh를 제공합니다.',
};

beforeEach(() => { pois.clear(); translations.clear(); jobs.clear(); pois.create(source); });

test.each(['en', 'ja', 'ko'])('%s public detail and list show eligible descriptions', async (language) => {
  const candidate = candidates[language];
  const states = [
    { name: 'ready', description: candidate, sourceHash: verifiedHash(source.description),
      status: 'ready', fallback: false, expected: candidate },
    { name: 'displayable unverified', description: candidate,
      sourceHash: displayableUnverifiedHash(source.description),
      status: 'unverified', fallback: false, expected: candidate },
    { name: 'legacy auto', description: candidate, sourceHash: hash(source.description),
      status: 'unverified', fallback: true, expected: source.description },
    { name: 'existing manual edit', description: candidate, sourceHash: hash(source.description),
      manual: true, status: 'ready', fallback: false, expected: candidate },
    { name: 'unverified', description: candidate,
      sourceHash: hash(`unverified:${source.description}`),
      status: 'unverified', fallback: false, expected: candidate },
    { name: 'stale', description: candidate, sourceHash: null,
      status: 'unverified', fallback: true, expected: source.description },
    { name: 'stale displayable', description: candidate,
      sourceHash: displayableUnverifiedHash('Mô tả tiếng Việt cũ.'),
      status: 'unverified', fallback: true, expected: source.description },
    { name: 'rejected', description: language === 'en' ? source.description : 'English text only.',
      sourceHash: hash(source.description),
      status: 'rejected', fallback: true, expected: source.description },
    { name: 'missing', description: null, sourceHash: null,
      status: 'missing', fallback: true, expected: source.description },
  ];
  for (const state of states) {
    translations.clear();
    if (state.description) await translations.save({ poiId: source.id, language,
      description: state.description, descriptionSourceHash: state.sourceHash,
      descriptionManual: !!state.manual });
    const detail = await request(app).get(`/api/pois/${source.id}`).query({ lang: language });
    const list = await request(app).get('/api/pois').query({ lang: language });
    expect(detail.status).toBe(200);
    expect(list.status).toBe(200);
    for (const view of [detail.body, list.body[0]]) {
      expect(view.description).toBe(state.expected);
      expect(view.translationStatus[language].description).toBe(state.status);
      expect(view.translationFallback[language]).toBe(state.fallback);
    }
    expect(list.body[0].translations[language].description).toBe(state.expected);
    if (state.name === 'unverified')
      expect((await translations.findByPoiIds([source.id]))[0].description).toBe(candidate);
  }
});

test.each(['en', 'ja', 'ko'])('%s displayable hash still blocks damaged tokens and wrong language', async (language) => {
  for (const candidate of ['ZXQFOOD', language === 'en' ? '한국어만' : 'English only.']) {
    for (const sourceHash of [displayableUnverifiedHash(source.description),
      hash(`unverified:${source.description}`)]) {
      translations.clear();
      await translations.save({ poiId: source.id, language, description: candidate,
        descriptionSourceHash: sourceHash, descriptionManual: false });
      for (const url of [`/api/pois/${source.id}?lang=${language}`, `/api/pois?lang=${language}`]) {
        const response = await request(app).get(url).expect(200);
        const view = Array.isArray(response.body) ? response.body[0] : response.body;
        expect(view.description).toBe(source.description);
        expect(view.translationFallback[language]).toBe(true);
        expect(view.translationStatus[language].description).toBe('rejected');
      }
    }
  }
});

test.each(['en', 'ja', 'ko'])('%s old displayable hash becomes stale after Vietnamese edit', async (language) => {
  await translations.save({ poiId: source.id, language, description: candidates[language],
    descriptionSourceHash: displayableUnverifiedHash(source.description), descriptionManual: false });
  const changed = `${source.description} Mới.`;
  pois.update(source.id, { description: changed });
  const view = (await request(app).get(`/api/pois/${source.id}?lang=${language}`).expect(200)).body;
  expect(view.description).toBe(changed);
  expect(view.translationFallback[language]).toBe(true);
});

test('changing the Vietnamese source makes a previously ready translation stale', async () => {
  await translations.save({ poiId: source.id, language: 'en',
    description: candidates.en, descriptionSourceHash: verifiedHash(source.description),
    descriptionManual: false });
  expect((await request(app).get(`/api/pois/${source.id}?lang=en`)).body.description)
    .toBe(candidates.en);
  const changed = 'Quán phục vụ bánh canh với nước dùng cua đậm đà.';
  pois.update(source.id, { description: changed });
  const view = (await request(app).get(`/api/pois/${source.id}?lang=en`)).body;
  expect(view).toMatchObject({ description: changed,
    translationStatus: { en: { description: 'unverified' } },
    translationFallback: { en: true } });
  expect((await translations.findByPoiIds([source.id]))[0].description).toBe(candidates.en);
});
