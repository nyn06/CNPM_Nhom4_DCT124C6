jest.mock('../src/integrations/translation/translation.provider', () => ({ translate: jest.fn() }));

const selector = require('../src/integrations/translation/poi-description.provider');
const deepl = require('../src/integrations/translation/deepl.provider');
const libre = require('../src/integrations/translation/translation.provider');
const pois = require('../src/repositories/poi.repository');
const rows = require('../src/repositories/poi-translation.repository');
const service = require('../src/services/poi-translation.service');
const poiService = require('../src/services/poi.service');
const worker = require('../src/services/poi-translation-worker');
const jobs = require('../src/repositories/poi-translation-job.repository');
const { verifiedHash } = require('../src/services/poi-description-hash');
const request = require('supertest');
const app = require('../src/app');

let sequence = 0;
const config = (extra = {}) => ({ POI_DESCRIPTION_PROVIDER: 'deepl',
  DEEPL_ACCOUNT_PLAN: 'developer', DEEPL_API_ENDPOINT: deepl.endpoint,
  DEEPL_API_KEY: `unit-test-key-${++sequence}-012345678901234567890:fx`,
  DEEPL_REMAINING_CHARACTERS: '1000', DEEPL_MAX_RUN_CHARACTERS: '100',
  DEEPL_PRODUCTION_CONFIRMED: 'true', TRANSLATION_TIMEOUT_MS: '1000', ...extra });
const response = (status, value = 'Translated text') => ({ ok: status === 200, status,
  json: async () => ({ translations: [{ text: value, billed_characters: 15 }] }) });

beforeEach(() => { pois.clear(); rows.clear(); jobs.clear(); libre.translate.mockReset(); });

test('Description defaults to LibreTranslate without changing the narration provider', () => {
  expect(selector.createRun({})).toBe(libre);
  expect(selector.createRun({ POI_DESCRIPTION_PROVIDER: 'libretranslate' })).toBe(libre);
  expect(() => selector.createRun({ POI_DESCRIPTION_PROVIDER: 'other' }))
    .toThrow('Invalid POI_DESCRIPTION_PROVIDER.');
});

test.each([
  [{ DEEPL_API_KEY: '' }, 'PROVIDER_AUTH'],
  [{ DEEPL_ACCOUNT_PLAN: 'pro' }, 'PROVIDER_CONFIG'],
  [{ DEEPL_API_ENDPOINT: 'https://api.deepl.com/v2/translate' }, 'PROVIDER_CONFIG'],
  [{ DEEPL_PRODUCTION_CONFIRMED: 'false' }, 'PROVIDER_CONFIG'],
  [{ DEEPL_REMAINING_CHARACTERS: '0' }, 'PROVIDER_QUOTA'],
  [{ DEEPL_MAX_RUN_CHARACTERS: '1001' }, 'PROVIDER_QUOTA'],
  [{ TRANSLATION_TIMEOUT_MS: '0' }, 'PROVIDER_CONFIG'],
])('invalid DeepL config %j fails before sending', (override, code) => {
  const fetchImpl = jest.fn();
  expect(() => deepl.createRun({ env: config(override), fetchImpl })).toThrow(code);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('DeepL uses the free endpoint, explicit language, and shared forward/back budget', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(response(200));
  const run = deepl.createRun({ env: config({ DEEPL_MAX_RUN_CHARACTERS: '10' }), fetchImpl });
  expect(await run.translate('bánh', 'vi', 'en')).toEqual({ text: 'Translated text' });
  expect(await run.translate('beef', 'en', 'vi')).toEqual({ text: 'Translated text' });
  await expect(run.translate('longer', 'vi', 'ja')).rejects.toMatchObject({ code: 'PROVIDER_QUOTA' });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl.mock.calls[0][0]).toBe(deepl.endpoint);
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ text: ['bánh'],
    source_lang: 'VI', target_lang: 'EN' });
  expect(fetchImpl.mock.calls[0][1].headers.Authorization).toMatch(/^DeepL-Auth-Key /);
});

test('DeepL reserves the configured remaining allowance across separate translation runs', async () => {
  const env = config({ DEEPL_REMAINING_CHARACTERS: '7', DEEPL_MAX_RUN_CHARACTERS: '7' });
  const fetchImpl = jest.fn().mockResolvedValue(response(200));
  await deepl.createRun({ env, fetchImpl }).translate('beef', 'en', 'vi');
  await expect(deepl.createRun({ env, fetchImpl }).translate('soup', 'en', 'vi'))
    .rejects.toMatchObject({ code: 'PROVIDER_QUOTA' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test.each([[401, 'PROVIDER_AUTH'], [403, 'PROVIDER_AUTH'],
  [429, 'PROVIDER_RATE_LIMIT'], [456, 'PROVIDER_QUOTA'],
  [500, 'PROVIDER_HTTP_ERROR']])('DeepL HTTP %i maps to %s', async (status, code) => {
  const run = deepl.createRun({ env: config(), fetchImpl: jest.fn().mockResolvedValue(response(status)) });
  await expect(run.translate('món ăn', 'vi', 'en')).rejects.toMatchObject({ code });
});

test('DeepL timeout aborts without revealing the key', async () => {
  const env = config({ TRANSLATION_TIMEOUT_MS: '1' });
  const fetchImpl = jest.fn((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const run = deepl.createRun({ env, fetchImpl });
  const failure = await run.translate('món ăn', 'vi', 'en').catch((error) => error);
  expect(failure).toMatchObject({ code: 'PROVIDER_TIMEOUT', statusCode: 504 });
  expect(JSON.stringify(failure)).not.toContain(env.DEEPL_API_KEY);
});

test('selected DeepL translates only Description in both directions and saves verified hash', async () => {
  const env = config({ DEEPL_MAX_RUN_CHARACTERS: '300' });
  const saved = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  const source = 'Quán phục vụ bánh canh với nước dùng cua.';
  const poi = pois.create({ id: 'deepl-description', name: 'Bánh Canh Cua Sài Gòn',
    description: source, address: '40 Tú Xương', isActive: true, latitude: 10, longitude: 106 });
  const oldFetch = global.fetch;
  global.fetch = jest.fn(async (_url, options) => {
    const body = JSON.parse(options.body);
    return response(200, body.target_lang === 'VI' ? source
      : 'The restaurant serves ZXQFOOD0ZXQ with crab broth.');
  });
  try {
    await service.translate(poi.id, { targetLanguages: ['en'], descriptionOnly: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(libre.translate).not.toHaveBeenCalled();
    const row = (await rows.findByPoiIds([poi.id]))[0];
    expect(row).toMatchObject({ descriptionSourceHash: verifiedHash(source),
      name: null, address: null, descriptionManual: false });
    expect(row.description).toContain('banh canh');
    await service.translate(poi.id, { targetLanguages: ['en'], descriptionOnly: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    pois.update(poi.id, { description: `${source} Mới.` });
    const stale = (await request(app).get(`/api/pois/${poi.id}?lang=en`).expect(200)).body;
    expect(stale.description).toBe(`${source} Mới.`);
    expect(stale.translationFallback.en).toBe(true);
  } finally {
    global.fetch = oldFetch;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('DeepL Description EN restores the thick-broth glossary before display', async () => {
  const env = config({ DEEPL_MAX_RUN_CHARACTERS: '500' });
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const source = 'Quán bánh canh với sợi bánh mềm dai, nước dùng sánh và hương vị cua.';
  const poi = pois.create({ id: 'deepl-thick-broth', name: 'Bánh Canh Cua Sài Gòn',
    description: source, address: '40 Tú Xương', isActive: true, latitude: 10, longitude: 106 });
  const oldFetch = global.fetch;
  global.fetch = jest.fn(async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.target_lang === 'VI') return response(200,
      'Quán bánh canh có sợi bánh mềm dai và nước dùng sánh mang hương vị cua.');
    expect(body.text[0]).toContain('ZXQFOOD0ZXQ');
    expect(body.text[0]).toContain('ZXQTERM0ZXQ');
    expect(body.text[0]).not.toContain('broth sánh');
    return response(200, 'The ZXQFOOD0ZXQ restaurant serves soft, chewy noodles '
      + 'with ZXQTERM0ZXQ and crab flavor.');
  });
  try {
    await service.translate(poi.id, { targetLanguages: ['en'], descriptionOnly: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const view = (await request(app).get(`/api/pois/${poi.id}?lang=en`).expect(200)).body;
    expect(view.description).toContain('thick broth');
    expect(view.description).not.toContain('ZXQ');
    expect(view.translationStatus.en.description).toBe('unverified');
    expect(view.translationFallback.en).toBe(false);
    expect(pois.findById(poi.id).description).toBe(source);
  } finally {
    global.fetch = oldFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('DeepL keeps unverified distinct from rejected and never saves a broken token', async () => {
  const env = config({ DEEPL_MAX_RUN_CHARACTERS: '300' });
  const saved = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  const source = 'Quán phục vụ bánh canh với nước dùng cua.';
  const first = pois.create({ id: 'deepl-unverified', name: 'Bánh Canh Cua Sài Gòn',
    description: source, address: '', isActive: true, latitude: 10, longitude: 106 });
  const second = pois.create({ ...first, id: 'deepl-rejected' });
  const oldFetch = global.fetch;
  let output = 'The restaurant serves ZXQFOOD0ZXQ with crab broth.';
  global.fetch = jest.fn(async (_url, options) => response(200,
    JSON.parse(options.body).target_lang === 'VI'
      ? 'Một câu khác rất dài nhưng không giải thích đủ nội dung món ăn.' : output));
  try {
    await service.translate(first.id, { targetLanguages: ['en'], descriptionOnly: true });
    const unverified = (await request(app).get(`/api/pois/${first.id}?lang=en`).expect(200)).body;
    expect(unverified.description).toContain('banh canh');
    expect(unverified.translationStatus.en.description).toBe('unverified');
    expect(unverified.translationFallback.en).toBe(false);
    output = 'The restaurant serves soup.';
    await expect(service.translate(second.id, { targetLanguages: ['en'], descriptionOnly: true }))
      .rejects.toMatchObject({ code: 'UNTRUSTED_TRANSLATION',
        translationRule: 'protected_term_missing' });
    expect(await rows.findByPoiIds([second.id])).toHaveLength(0);
  } finally {
    global.fetch = oldFetch;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('Admin Description edit queues DeepL EN/JA/KO, invalidates old hashes, then displays new text', async () => {
  const env = config({ DEEPL_MAX_RUN_CHARACTERS: '500' });
  const saved = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  const oldFetch = global.fetch;
  const original = 'Quán phục vụ món ăn Việt Nam.';
  const poi = poiService.createPoi({ name: 'Điểm ẩm thực', description: original,
    address: '40 Tú Xương', latitude: 10, longitude: 106, geofenceRadius: 50 });
  global.fetch = jest.fn(async (_url, options) => {
    const body = JSON.parse(options.body);
    const changed = pois.findById(poi.id).description !== original;
    const value = { EN: changed ? 'The restaurant serves new Vietnamese food.'
      : 'The restaurant serves Vietnamese food.',
    JA: changed ? 'この店は新しいベトナム料理を提供します。' : 'この店はベトナム料理を提供します。',
    KO: changed ? '이 식당은 새로운 베트남 음식을 제공합니다.' : '이 식당은 베트남 음식을 제공합니다.' };
    return response(200, body.target_lang === 'VI' ? pois.findById(poi.id).description
      : value[body.target_lang]);
  });
  try {
    expect(jobs.get(poi.id).status).toBe('pending');
    await worker.runOnce();
    expect(global.fetch).toHaveBeenCalledTimes(6);
    expect(libre.translate).not.toHaveBeenCalled();
    for (const language of ['en', 'ja', 'ko']) {
      const view = (await request(app).get(`/api/pois/${poi.id}?lang=${language}`).expect(200)).body;
      expect(view.translationFallback[language]).toBe(false);
    }
    const updated = `${original} Mới.`;
    poiService.updatePoi(poi.id, { name: poi.name, description: updated, address: poi.address,
      latitude: poi.latitude, longitude: poi.longitude, geofenceRadius: poi.geofenceRadius });
    expect(jobs.get(poi.id).status).toBe('pending');
    for (const language of ['en', 'ja', 'ko']) {
      const stale = (await request(app).get(`/api/pois/${poi.id}?lang=${language}`).expect(200)).body;
      expect(stale.description).toBe(updated);
      expect(stale.translationFallback[language]).toBe(true);
    }
    await worker.runOnce();
    expect(global.fetch).toHaveBeenCalledTimes(12);
    for (const language of ['en', 'ja', 'ko']) {
      const view = (await request(app).get(`/api/pois/${poi.id}?lang=${language}`).expect(200)).body;
      expect(view.description).not.toBe(updated);
      expect(view.translationFallback[language]).toBe(false);
      expect((await rows.findByPoiIds([poi.id])).find((row) => row.language === language)
        .descriptionSourceHash).toBe(verifiedHash(updated));
    }
  } finally {
    global.fetch = oldFetch;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('DeepL quota response stops the POI worker before other languages', async () => {
  const env = config();
  const saved = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  const oldFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue(response(456));
  const poi = poiService.createPoi({ name: 'Điểm ẩm thực', description: 'Quán phục vụ món ăn Việt Nam.',
    latitude: 10, longitude: 106, geofenceRadius: 50 });
  try {
    await worker.runOnce();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(jobs.get(poi.id)).toMatchObject({ status: 'failed', lastErrorCode: 'PROVIDER_QUOTA' });
    expect(await rows.findByPoiIds([poi.id])).toHaveLength(0);
  } finally {
    global.fetch = oldFetch;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
