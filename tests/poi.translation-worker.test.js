jest.mock('../src/integrations/translation/translation.provider', () => ({ translate: jest.fn() }));

const pois = require('../src/repositories/poi.repository');
const translations = require('../src/repositories/poi-translation.repository');
const jobs = require('../src/repositories/poi-translation-job.repository');
const poiService = require('../src/services/poi.service');
const worker = require('../src/services/poi-translation-worker');
const provider = require('../src/integrations/translation/translation.provider');

const input = { name: 'Hủ Tiếu', description: 'Món ăn Việt', category: 'Món ăn',
  address: '40 Tú Xương', latitude: 10, longitude: 106, geofenceRadius: 50 };

beforeEach(() => {
  pois.clear();
  translations.clear();
  jobs.clear();
  provider.translate.mockReset().mockImplementation(async (text, _source, language) => ({ text: `${language}: ${text}` }));
});

test('create queues EN/JA/KO without provider work during save', async () => {
  const poi = poiService.createPoi(input);
  expect(provider.translate).not.toHaveBeenCalled();
  expect(jobs.get(poi.id).status).toBe('pending');
  await worker.runOnce();
  expect(provider.translate).toHaveBeenCalledTimes(9);
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
  expect(provider.translate).toHaveBeenCalledTimes(2);
  expect(provider.translate.mock.calls.every(([text]) => text === 'Hủ Tiếu Nam Vang')).toBe(true);
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
});

test('unrelated JA/KO name is not stored as a completed Latin fallback', async () => {
  const poi = poiService.createPoi(input);
  provider.translate.mockImplementation(async (text, _source, language) => ({ text: language === 'ja'
    && text === input.name ? 'ログイン' : `${language}: ${text}` }));
  await worker.runOnce();
  expect(jobs.get(poi.id)).toMatchObject({ status: 'pending', lastErrorCode: 'UNTRUSTED_TRANSLATION' });
  expect(await translations.findByPoiIds([poi.id])).toHaveLength(0);
  expect(pois.findById(poi.id).name).toBe(input.name);
});

test('semantic name translation is accepted after faithful back translation', async () => {
  const poi = poiService.createPoi({ ...input, name: 'Cơm gà' });
  provider.translate.mockImplementation(async (text, source, target) => {
    if (source === 'vi' && text === 'Cơm gà') return { text: { en: 'Chicken rice', ja: 'チキンライス', ko: '치킨 쌀' }[target] };
    if (target === 'vi') return { text: 'Cơm gà' };
    return { text: `${target}: ${text}` };
  });
  await worker.runOnce();
  expect(jobs.get(poi.id).status).toBe('done');
  const rows = await translations.findByPoiIds([poi.id]);
  expect(rows).toHaveLength(3);
  expect(rows.find((row) => row.language === 'en').name).toBe('Chicken rice');
  expect(rows.find((row) => row.language === 'ja').name).toBe('チキンライス');
  expect(rows.find((row) => row.language === 'ko').name).toBe('치킨 쌀');
});

test('failed job retries after cooldown when the provider recovers', async () => {
  const poi = poiService.createPoi(input);
  provider.translate.mockRejectedValue(Object.assign(new Error('offline'), { statusCode: 503 }));
  for (let attempt = 0; attempt < 3; attempt++) {
    jobs.get(poi.id).nextAttemptAt = 0;
    await worker.runOnce();
  }
  expect(jobs.get(poi.id).status).toBe('failed');
  expect(jobs.get(poi.id).nextAttemptAt).toBeGreaterThan(Date.now());
  provider.translate.mockResolvedValue({ text: 'Hủ Tiếu translated' });
  expect(await worker.runOnce()).toBe(false);
  jobs.get(poi.id).nextAttemptAt = 0;
  expect(await worker.runOnce()).toBe(true);
  expect(jobs.get(poi.id)).toMatchObject({ status: 'done', attempts: 4 });
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
