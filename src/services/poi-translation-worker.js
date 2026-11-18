const { createHash } = require('crypto');
const pois = require('../repositories/poi.repository');
const translations = require('../repositories/poi-translation.repository');
const jobs = require('../repositories/poi-translation-job.repository');
const service = require('./poi-translation.service');
const { verifiedHash, unverifiedHash, displayableUnverifiedHash } = require('./poi-description-hash');

const fields = ['name', 'description', 'address'];
const languages = ['en', 'ja', 'ko'];
const hash = (value) => createHash('sha256').update(value || '', 'utf8').digest('hex');
const matchesSource = (poi, row, field) => row?.[`${field}SourceHash`] === hash(poi[field])
  || field === 'description' && [unverifiedHash(poi.description),
    verifiedHash(poi.description), displayableUnverifiedHash(poi.description)]
    .includes(row?.descriptionSourceHash);
let timer;
let active;
let lastQueueError;
let lastQueueLogAt = 0;
let suppressedQueueErrors = 0;

function logQueueError(error, stage) {
  const code = /^[A-Z][A-Z0-9_]{1,40}$/.test(error?.code || '') ? error.code : 'UNKNOWN';
  const number = Number.isInteger(error?.number) ? ` sql=${error.number}` : '';
  const signature = `${stage}:${code}:${number}`;
  const now = Date.now();
  if (signature === lastQueueError && now - lastQueueLogAt < 60000) {
    suppressedQueueErrors++;
    return;
  }
  const repeated = suppressedQueueErrors ? ` repeated=${suppressedQueueErrors}` : '';
  console.error(`POI translation worker failed: stage=${stage} code=${code}${number}${repeated}`);
  lastQueueError = signature;
  lastQueueLogAt = now;
  suppressedQueueErrors = 0;
}

function logTranslationFailure(poiId, language, error) {
  const id = /^[0-9a-f-]{36}$/i.test(poiId) ? poiId : 'unknown';
  const code = /^[A-Z][A-Z0-9_]{1,40}$/.test(error?.code || '') ? error.code : 'UNKNOWN';
  const rule = /^[a-z][a-z0-9_]{1,40}$/.test(error?.translationRule || '')
    ? error.translationRule : 'unknown';
  console.error(`POI translation failed: poiId=${id} language=${language} rule=${rule} code=${code}`);
}

async function reconcile() {
  const all = await pois.findAll();
  const rows = await translations.findByPoiIds(all.map((poi) => poi.id));
  for (const poi of all) {
    const needed = languages.some((language) => {
      const row = rows.find((entry) => entry.poiId === poi.id && entry.language === language);
      return fields.some((field) => poi[field] && !row?.[`${field}Manual`]
        && (!row?.[field] || !matchesSource(poi, row, field)));
    });
    if (needed) await jobs.enqueue(poi.id, true);
  }
}

async function runOnce() {
  const job = await jobs.claim();
  if (!job) return false;
  try {
    let failure = null;
    for (const language of languages) {
      try {
        const result = await service.translate(job.poiId, { targetLanguages: [language],
          skipDisplayableDescription: true });
        const row = result.translations?.[language];
        if (row?.descriptionUnverified) {
          const error = new Error('Description translation has not been verified.');
          error.code = 'UNVERIFIED_TRANSLATION';
          error.translationRule = row.descriptionQualityReason || 'unverified';
          throw error;
        }
      } catch (error) {
        if (['UNTRUSTED_TRANSLATION', 'UNVERIFIED_TRANSLATION'].includes(error?.code))
          logTranslationFailure(job.poiId, language, error);
        failure ||= error;
        if (['PROVIDER_AUTH', 'PROVIDER_QUOTA', 'PROVIDER_CONFIG',
          'PROVIDER_RATE_LIMIT'].includes(error?.code)) break;
      }
    }
    if (failure) throw failure;
    await jobs.complete(job);
  } catch (error) {
    const code = ['UNTRUSTED_TRANSLATION', 'UNVERIFIED_TRANSLATION', 'PROVIDER_AUTH',
      'PROVIDER_RATE_LIMIT', 'PROVIDER_QUOTA', 'PROVIDER_CONFIG',
      'PROVIDER_HTTP_ERROR', 'PROVIDER_INVALID_RESPONSE',
      'PROVIDER_NETWORK', 'PROVIDER_TIMEOUT'].includes(error?.code) ? error.code
      : error?.statusCode === 503 ? 'PROVIDER_UNAVAILABLE'
        : error?.statusCode === 504 ? 'PROVIDER_TIMEOUT'
          : error?.statusCode === 409 ? 'SOURCE_CHANGED' : 'TRANSLATION_FAILED';
    await jobs.fail(job, code);
  }
  return true;
}

function start() {
  if (timer) return;
  let ticks = 0;
  async function tick() {
    if (active) return;
    active = (async () => {
      let stage = 'reconcile';
      try {
        if (ticks++ % 12 === 0) await reconcile();
        stage = 'queue';
        await runOnce();
        lastQueueError = undefined;
        suppressedQueueErrors = 0;
      } catch (error) {
        logQueueError(error, stage);
      }
    })();
    try { await active; } finally { active = null; }
  }
  timer = setInterval(tick, 5000);
  timer.unref?.();
  tick();
}

async function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  if (active) await active;
}
module.exports = { reconcile, runOnce, start, stop };
