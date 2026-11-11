require('dotenv').config();

const { createHash } = require('crypto');
const pois = require('../src/repositories/poi.repository');
const translations = require('../src/repositories/poi-translation.repository');
const service = require('../src/services/poi-translation.service');
const provider = require('../src/integrations/translation/translation.provider');
const { englishName, englishAddress, invalidEnglishDescription, descriptionRetention } = require('../src/services/poi-english');
const { closePool } = require('../src/database/connection');

const hash = (value) => createHash('sha256').update(value || '', 'utf8').digest('hex');
const sourceMatches = (poi, row, field) => row?.[`${field}SourceHash`] === hash(poi[field])
  || field === 'description' && row?.descriptionSourceHash === hash(`unverified:${poi.description || ''}`);
const fields = ['name', 'address', 'description'];
const apply = process.argv.includes('--apply');
const verifyDescriptions = process.argv.includes('--verify-descriptions');
const ids = process.argv.filter((arg) => arg.startsWith('--id=')).map((arg) => arg.slice(5));

async function main() {
  if (apply && (!ids.length || ids.some((id) => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))) {
    throw new Error('Use --apply with one or more explicit --id=<POI UUID> values after reviewing the dry-run report.');
  }
  const all = await pois.findAll();
  const chosen = ids.length ? all.filter((poi) => ids.includes(poi.id)) : all;
  if (ids.length && ids.length !== chosen.length) throw new Error('One or more requested POI IDs do not exist.');
  const rows = await translations.findByPoiIds(chosen.map((poi) => poi.id));
  const report = chosen.map((poi) => {
    const english = rows.find((row) => row.poiId === poi.id && row.language === 'en');
    const expected = { name: englishName(poi.name), address: englishAddress(poi.address, poi.streetAddress) };
    const changes = {};
    for (const field of fields) {
      const current = english?.[field] || null;
      const stale = !!poi[field] && !sourceMatches(poi, english, field);
      const invalid = field === 'description'
        ? invalidEnglishDescription(poi.description, current)
        : !!current && current !== expected[field];
      if (!poi[field] || english?.[`${field}Manual`]) continue;
      if (!current || stale || invalid) changes[field] = { current, sourceChanged: stale,
        ...(field === 'description' ? { providerTranslationRequired: true }
          : { proposed: expected[field] }) };
    }
    return { id: poi.id, sourceName: poi.name, changes,
      otherLanguages: Object.fromEntries(['ja', 'ko'].map((language) => {
        const row = rows.find((entry) => entry.poiId === poi.id && entry.language === language);
        return [language, Object.fromEntries(fields.map((field) => [field,
          !row?.[field] ? 'missing' : !sourceMatches(poi, row, field) ? 'stale'
            : field === 'name' && !row.nameManual && englishName(poi.name) !== poi.name
              && row.name === englishName(poi.name) ? 'latin-fallback' : 'present']))];
      })) };
  });
  if (verifyDescriptions) for (const entry of report) {
    const poi = chosen.find((item) => item.id === entry.id);
    const english = rows.find((row) => row.poiId === entry.id && row.language === 'en');
    if (!english?.description || !poi.description) continue;
    try {
      const back = (await provider.translate(english.description, 'en', 'vi'))?.text || '';
      const score = descriptionRetention(poi.description, back);
      if (score !== null && score < 0.5) entry.descriptionReview = { retention: Number(score.toFixed(2)) };
    } catch { entry.descriptionReview = { verificationUnavailable: true }; }
  }
  const flagged = report.filter((entry) => Object.keys(entry.changes).length || entry.descriptionReview
    || Object.values(entry.otherLanguages).some((parts) => Object.values(parts).some((status) => status !== 'present')));
  process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scanned: chosen.length,
    needsReview: flagged.length, records: flagged }, null, 2)}\n`);
  if (apply) {
    for (const entry of flagged) {
      if (!Object.keys(entry.changes).length) continue;
      await service.translate(entry.id, { targetLanguages: ['en'] });
      process.stdout.write(`Updated EN translation for ${entry.id}\n`);
    }
  }
}

main().catch((error) => { console.error(`POI translation audit failed: ${error.code || error.message}`); process.exitCode = 1; })
  .finally(() => closePool());
