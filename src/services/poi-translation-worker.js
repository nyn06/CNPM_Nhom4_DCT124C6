const { createHash } = require('crypto');
const pois = require('../repositories/poi.repository');
const translations = require('../repositories/poi-translation.repository');
const jobs = require('../repositories/poi-translation-job.repository');
const service = require('./poi-translation.service');

const fields = ['name', 'description', 'address'];
const languages = ['en', 'ja', 'ko'];
const hash = (value) => createHash('sha256').update(value || '', 'utf8').digest('hex');
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

async function reconcile() {
  const all = await pois.findAll();
  const rows = await translations.findByPoiIds(all.map((poi) => poi.id));
  for (const poi of all) {
    const needed = languages.some((language) => {
      const row = rows.find((entry) => entry.poiId === poi.id && entry.language === language);
      return fields.some((field) => poi[field] && !row?.[`${field}Manual`]
        && (!row?.[field] || row[`${field}SourceHash`] !== hash(poi[field])));
    });
    if (needed) await jobs.enqueue(poi.id, true);
  }
}

async function runOnce() {
  const job = await jobs.claim();
  if (!job) return false;
  try {
    await service.translate(job.poiId);
    await jobs.complete(job);
  } catch (error) {
    const code = error?.code === 'UNTRUSTED_TRANSLATION' ? 'UNTRUSTED_TRANSLATION'
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
