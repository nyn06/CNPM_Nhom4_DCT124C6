jest.mock('../src/integrations/translation/translation.provider', () => ({ translate: jest.fn() }));

const pois = require('../src/repositories/poi.repository');
const translations = require('../src/repositories/poi-translation.repository');
const jobs = require('../src/repositories/poi-translation-job.repository');
const poiService = require('../src/services/poi.service');
const worker = require('../src/services/poi-translation-worker');
const provider = require('../src/integrations/translation/translation.provider');
const request = require('supertest');
const app = require('../src/app');

const input = { name: 'Hủ Tiếu', description: 'Món ăn Việt', category: 'Món ăn',
  address: '40 Tú Xương', latitude: 10, longitude: 106, geofenceRadius: 50 };

beforeEach(() => {
  pois.clear();
  translations.clear();
  jobs.clear();
  provider.translate.mockReset().mockImplementation(async (text, _source, language) => ({
    text: language === 'vi' ? pois.findAll()[0]?.description || text
      : language === 'ja' ? 'ベトナム料理' : language === 'ko' ? '베트남 요리' : 'Vietnamese dish',
  }));
});

test('create queues EN/JA/KO without provider work during save', async () => {
  const poi = poiService.createPoi(input);
  expect(provider.translate).not.toHaveBeenCalled();
  expect(jobs.get(poi.id).status).toBe('pending');
  await worker.runOnce();
  expect(provider.translate).toHaveBeenCalledTimes(6);
  expect(jobs.get(poi.id).status).toBe('done');
  expect((await translations.findByPoiIds([poi.id]))).toHaveLength(3);
});

test('update queues only changed fields and preserves manual translations', async () => {
  const poi = poiService.createPoi(input);
  await worker.runOnce();
  const translationService = require('../src/services/poi-translation.service');
  await translationService.save(poi.id, 'en', { name: 'Manual name' });
  provider.translate.mockClear();
  poiService.updatePoi(poi.id, { name: 'Hủ Tiếu Nam Vang' });
  await worker.runOnce();
  expect(provider.translate).not.toHaveBeenCalled();
  const rows = await translations.findByPoiIds([poi.id]);
  expect(rows.find((row) => row.language === 'en').name).toBe('Manual name');
  expect(rows.find((row) => row.language === 'en').nameManual).toBe(true);
  const revision = jobs.get(poi.id).revision;
  poiService.updatePoi(poi.id, { geofenceRadius: 75 });
  expect(jobs.get(poi.id).revision).toBe(revision);
});

test('provider failure keeps Vietnamese and stops after three attempts', async () => {
  const poi = poiService.createPoi(input);
  provider.translate.mockRejectedValue(Object.assign(new Error('secret'), { statusCode: 503 }));
  for (let attempt = 0; attempt < 3; attempt++) {
    jobs.get(poi.id).nextAttemptAt = 0;
    await worker.runOnce();
  }
  expect(jobs.get(poi.id)).toMatchObject({ status: 'failed', attempts: 3,
    lastErrorCode: 'PROVIDER_UNAVAILABLE' });
  await worker.reconcile();
  expect(jobs.get(poi.id).status).toBe('failed');
  expect(pois.findById(poi.id).name).toBe(input.name);
  expect(await translations.findByPoiIds([poi.id])).toHaveLength(0);
  const fallback = await request(app).get(`/api/pois/${poi.id}?lang=en`);
  expect(fallback.body).toMatchObject({ description: input.description,
    translationStatus: { en: { description: 'failed' } } });
});

test('bad short descriptions are rejected for each language', async () => {
  const poi = poiService.createPoi({ ...input, description: 'Nay báo cáo ổn nha' });
  provider.translate.mockImplementation(async (_text, source, target) => ({
    text: target === 'vi' ? 'Chỉ đường' : { en: 'Now', ja: 'お問い合わせ', ko: '오시는 길' }[target],
  }));
  await worker.runOnce();
  expect(jobs.get(poi.id).lastErrorCode).toBe('UNTRUSTED_TRANSLATION');
  expect(await translations.findByPoiIds([poi.id])).toHaveLength(0);
  const view = (await request(app).get('/api/pois?lang=en')).body.find((item) => item.id === poi.id);
  expect(view).toMatchObject({ description: 'Nay báo cáo ổn nha', translationPending: false,
    translationStatus: { en: { description: 'rejected' } } });
});

test('quality failure logs the language and rule without logging source or provider text', async () => {
  const poi = poiService.createPoi({ ...input, name: 'Bánh Canh Cua Sài Gòn',
    description: 'Quán phục vụ bánh canh với nước dùng cua.' });
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  provider.translate.mockResolvedValue({ text: 'A generic soup restaurant.' });
  try {
    await worker.runOnce();
    expect(jobs.get(poi.id).lastErrorCode).toBe('UNTRUSTED_TRANSLATION');
    expect(log.mock.calls.map(([message]) => message)).toEqual(expect.arrayContaining([
      expect.stringContaining('language=en rule=protected_term_missing code=UNTRUSTED_TRANSLATION'),
      expect.stringContaining('language=ja rule=protected_term_missing code=UNTRUSTED_TRANSLATION'),
      expect.stringContaining('language=ko rule=protected_term_missing code=UNTRUSTED_TRANSLATION'),
    ]));
    expect(JSON.stringify(log.mock.calls)).not.toContain('Quán phục vụ');
    expect(JSON.stringify(log.mock.calls)).not.toContain('A generic soup restaurant');
  } finally { log.mockRestore(); }
});

test('unverified descriptions remain drafts and do not complete the translation job', async () => {
  const poi = poiService.createPoi(input);
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  provider.translate.mockImplementation(async (_text, _from, target) => ({ text: target === 'vi'
    ? 'Chỉ đường đến quán.' : target === 'ja' ? 'ベトナム料理'
      : target === 'ko' ? '베트남 요리' : 'Vietnamese dish' }));
  try {
    await worker.runOnce();
    expect(jobs.get(poi.id)).toMatchObject({ status: 'failed', lastErrorCode: 'UNVERIFIED_TRANSLATION' });
    const rows = await translations.findByPoiIds([poi.id]);
    expect(rows.find((row) => row.language === 'en').descriptionSourceHash)
      .not.toBe(require('crypto').createHash('sha256').update(input.description).digest('hex'));
    expect(log.mock.calls.map(([message]) => message)).toEqual(expect.arrayContaining([
      expect.stringContaining('language=en rule=insufficient_semantic_evidence code=UNVERIFIED_TRANSLATION'),
    ]));
  } finally { log.mockRestore(); }
});

test('new safe unverified descriptions display automatically in EN/JA/KO, then become stale on VI edit', async () => {
  const source = 'Quán phục vụ bánh mì với thịt và rau.';
  const poi = poiService.createPoi({ ...input, name: 'Bánh Mì Việt', description: source });
  provider.translate.mockImplementation(async (_text, _from, target) => ({ text: target === 'vi'
    ? 'Quán phục vụ món ăn trong một câu giải thích rất dài và khác.'
    : target === 'ja' ? 'この店はZXQFOOD0ZXQと肉を提供します。'
      : target === 'ko' ? '이 식당은 ZXQFOOD0ZXQ와 고기를 제공합니다.'
        : 'The restaurant serves ZXQFOOD0ZXQ with meat.' }));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try { await worker.runOnce(); } finally { log.mockRestore(); }
  expect(jobs.get(poi.id).lastErrorCode).toBe('UNVERIFIED_TRANSLATION');
  const { displayableUnverifiedHash } = require('../src/services/poi-description-hash');
  const rows = await translations.findByPoiIds([poi.id]);
  expect(rows).toHaveLength(3);
  expect(rows.every((row) => row.descriptionSourceHash === displayableUnverifiedHash(source))).toBe(true);
  await worker.reconcile();
  expect(jobs.get(poi.id).status).toBe('failed');
  for (const language of ['en', 'ja', 'ko']) {
    const detail = (await request(app).get(`/api/pois/${poi.id}?lang=${language}`).expect(200)).body;
    const list = (await request(app).get(`/api/pois?lang=${language}`).expect(200)).body[0];
    expect(detail.description).toBe(rows.find((row) => row.language === language).description);
    expect(list.description).toBe(detail.description);
    expect(detail.translationStatus[language].description).toBe('unverified');
    expect(detail.translationFallback[language]).toBe(false);
  }
  const updated = `${source} Mô tả mới.`;
  poiService.updatePoi(poi.id, { ...input, name: poi.name, description: updated });
  expect(jobs.get(poi.id).status).toBe('pending');
  for (const language of ['en', 'ja', 'ko']) {
    const detail = (await request(app).get(`/api/pois/${poi.id}?lang=${language}`).expect(200)).body;
    expect(detail.description).toBe(updated);
    expect(detail.translationFallback[language]).toBe(true);
  }
  const relog = jest.spyOn(console, 'error').mockImplementation(() => {});
  try { await worker.runOnce(); } finally { relog.mockRestore(); }
  for (const language of ['en', 'ja', 'ko']) {
    const detail = (await request(app).get(`/api/pois/${poi.id}?lang=${language}`).expect(200)).body;
    expect(detail.description).toContain('banh mi');
    expect(detail.translationStatus[language].description).toBe('unverified');
    expect(detail.translationFallback[language]).toBe(false);
  }
});

test('address edit does not retranslate a displayable unverified Description', async () => {
  const source = 'Quán phục vụ bánh mì với thịt và rau.';
  const poi = poiService.createPoi({ ...input, name: 'Bánh Mì Việt', description: source });
  provider.translate.mockImplementation(async (_text, _from, target) => ({ text: target === 'vi'
    ? 'Một câu dịch ngược khác dài nhưng không đủ chứng minh đầy đủ nội dung món ăn.'
    : target === 'ja' ? 'この店はZXQFOOD0ZXQと肉を提供します。'
      : target === 'ko' ? '이 식당은 ZXQFOOD0ZXQ와 고기를 제공합니다.'
        : 'The restaurant serves ZXQFOOD0ZXQ with meat.' }));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try { await worker.runOnce(); } finally { log.mockRestore(); }
  const { displayableUnverifiedHash } = require('../src/services/poi-description-hash');
  const originalRows = await translations.findByPoiIds([poi.id]);
  expect(originalRows).toHaveLength(3);
  expect(originalRows.every((row) => row.descriptionSourceHash === displayableUnverifiedHash(source))).toBe(true);
  provider.translate.mockClear();
  poiService.updatePoi(poi.id, { ...input, name: poi.name, description: source,
    address: 'Updated address' });
  const addressLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  try { await worker.runOnce(); } finally { addressLog.mockRestore(); }
  expect(provider.translate).not.toHaveBeenCalled();
  const rows = await translations.findByPoiIds([poi.id]);
  expect(rows.every((row) => row.descriptionSourceHash === displayableUnverifiedHash(source))).toBe(true);
  for (const language of ['en', 'ja', 'ko']) {
    const view = (await request(app).get(`/api/pois/${poi.id}?lang=${language}`).expect(200)).body;
    expect(view.translationFallback[language]).toBe(false);
  }
});

test('one unverified language does not discard two verified translations', async () => {
  const poi = poiService.createPoi(input);
  provider.translate.mockImplementation(async (text, _source, target) => ({
    text: target === 'vi' ? input.description
      : target === 'ja' ? 'Translated in English' : target === 'ko' ? '베트남 요리'
        : 'Vietnamese dish',
  }));
  await worker.runOnce();
  expect(jobs.get(poi.id)).toMatchObject({ status: 'failed', attempts: 1,
    lastErrorCode: 'UNTRUSTED_TRANSLATION' });
  const rows = await translations.findByPoiIds([poi.id]);
  expect(rows.map((row) => row.language).sort()).toEqual(['en', 'ko']);
  expect(pois.findById(poi.id).description).toBe(input.description);
  expect(await worker.runOnce()).toBe(false);
});

test('rate limit uses a longer backoff before the bounded retry', () => {
  jobs.enqueue('limited');
  const job = jobs.claim();
  const now = Date.now();
  jobs.fail(job, 'PROVIDER_RATE_LIMIT');
  expect(jobs.get('limited').status).toBe('pending');
  expect(jobs.get('limited').nextAttemptAt - now).toBeGreaterThanOrEqual(60000);
  expect(jobs.claim()).toBeNull();
});

test('a reclaimed lease cannot be completed or failed by an older attempt', () => {
  jobs.enqueue('leased');
  const first = jobs.claim();
  jobs.get('leased').leaseUntil = 0;
  const second = jobs.claim();
  expect(second.attempts).toBe(first.attempts + 1);
  jobs.complete(first);
  jobs.fail(first, 'PROVIDER_NETWORK');
  expect(jobs.get('leased')).toMatchObject({ status: 'processing', attempts: second.attempts,
    lastErrorCode: null });
  jobs.complete(second);
  expect(jobs.get('leased').status).toBe('done');
});

test('JA/KO names use Latin Vietnamese without invoking the provider', async () => {
  const poi = poiService.createPoi(input);
  provider.translate.mockImplementation(async (text, _source, language) => ({ text: language === 'ja'
    && text === input.name ? 'ログイン' : language === 'vi' ? input.description
      : language === 'ja' ? 'ベトナム料理' : language === 'ko' ? '베트남 요리' : 'Vietnamese dish' }));
  await worker.runOnce();
  expect(jobs.get(poi.id)).toMatchObject({ status: 'done', lastErrorCode: null });
  expect((await translations.findByPoiIds([poi.id])).map((row) => row.language).sort()).toEqual(['en', 'ja', 'ko']);
  provider.translate.mockClear();
  expect(provider.translate.mock.calls.every(([text]) => text !== input.name)).toBe(true);
  expect(pois.findById(poi.id).name).toBe(input.name);
});

test('semantic name translation is bypassed for deterministic names', async () => {
  const poi = poiService.createPoi({ ...input, name: 'Cơm gà' });
  provider.translate.mockImplementation(async (text, source, target) => {
    if (source === 'vi' && text === 'Cơm gà') return { text: { en: 'Chicken rice', ja: 'チキンライス', ko: '치킨 쌀' }[target] };
    if (target === 'vi') return { text: input.description };
    return { text: target === 'ja' ? 'ベトナム料理' : target === 'ko' ? '베트남 요리' : 'Vietnamese dish' };
  });
  await worker.runOnce();
  expect(jobs.get(poi.id).status).toBe('done');
  const rows = await translations.findByPoiIds([poi.id]);
  expect(rows).toHaveLength(3);
  expect(rows.find((row) => row.language === 'en').name).toBe('Com ga');
  expect(rows.find((row) => row.language === 'ja').name).toBe('Com ga');
  expect(rows.find((row) => row.language === 'ko').name).toBe('Com ga');
});

test('failed job stops after three attempts and a source edit requeues it', async () => {
  const poi = poiService.createPoi(input);
  provider.translate.mockRejectedValue(Object.assign(new Error('offline'), { statusCode: 503 }));
  for (let attempt = 0; attempt < 3; attempt++) {
    jobs.get(poi.id).nextAttemptAt = 0;
    await worker.runOnce();
  }
  expect(jobs.get(poi.id).status).toBe('failed');
  expect(jobs.get(poi.id).nextAttemptAt).toBeGreaterThan(Date.now());
  provider.translate.mockImplementation(async (text, _source, target) => ({ text: target === 'vi'
    ? pois.findById(poi.id).description
    : target === 'ja' ? 'ベトナム料理' : target === 'ko' ? '베트남 요리' : 'Vietnamese dish' }));
  expect(await worker.runOnce()).toBe(false);
  jobs.get(poi.id).nextAttemptAt = 0;
  expect(await worker.runOnce()).toBe(false);
  poiService.updatePoi(poi.id, { description: 'Món ăn Việt mới' });
  expect(await worker.runOnce()).toBe(true);
  expect(jobs.get(poi.id)).toMatchObject({ status: 'done', attempts: 1 });
});

test('reconcile restores missing job after a saved POI', async () => {
  const poi = pois.create({ id: 'missing-job', ...input });
  await worker.reconcile();
  expect(jobs.get(poi.id).status).toBe('pending');
  await worker.runOnce();
  expect(jobs.get(poi.id).status).toBe('done');
});

test('queue errors log a safe code without repeating every tick', async () => {
  jest.useFakeTimers();
  const originalClaim = jobs.claim;
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  jobs.claim = jest.fn().mockRejectedValue(Object.assign(new Error('sensitive detail'), { code: 'ESOCKET' }));
  try {
    worker.start();
    await jest.advanceTimersByTimeAsync(15000);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('stage=queue code=ESOCKET');
    expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive detail');
  } finally {
    await worker.stop();
    jobs.claim = originalClaim;
    log.mockRestore();
    jest.useRealTimers();
  }
});
