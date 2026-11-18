require('dotenv').config();

const { closePool } = require('../src/database/connection');
const pois = require('../src/repositories/poi.repository');
const translations = require('../src/repositories/poi-translation.repository');
const quality = require('../src/services/poi-description-quality');
const { invalidEnglishDescription } = require('../src/services/poi-english');
const service = require('../src/services/poi-translation.service');
const { sql, getPool } = require('../src/database/repository');
const { hash, verifiedHash, unverifiedHash, displayableUnverifiedHash } =
  require('../src/services/poi-description-hash');

function parseScope(args) {
  if (args.some((arg) => !/^--(?:id|lang|field|retry|apply)=.+$/u.test(arg)))
    throw new Error('Unknown review option.');
  const option = (name) => args.filter((arg) => arg.startsWith(`${name}=`))
    .map((arg) => arg.slice(name.length + 1));
  const ids = option('--id');
  const languages = option('--lang');
  const retries = option('--retry');
  const applies = option('--apply');
  const fields = option('--field');
  if (ids.length !== 1 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ids[0])
    || languages.length !== 1 || !['en', 'ja', 'ko'].includes(languages[0]))
    throw new Error('Use exactly one --id=POI-UUID and one --lang=en|ja|ko.');
  if (fields.length > 1 || fields.length && fields[0] !== 'description'
    || retries.length > 1 || applies.length > 1 || retries.length && applies.length)
    throw new Error('Invalid --field, --retry or --apply options.');
  if (retries.length && fields[0] !== 'description')
    throw new Error('Retry requires --field=description.');
  if (applies.length && fields.length) throw new Error('--apply cannot use --field.');
  return { ids, languages, retries, applies, fields };
}

function review(poi, row, language) {
  const sourceHash = hash(poi.description);
  const savedSourceHash = row?.descriptionSourceHash || null;
  const preliminary = row?.description && !row.descriptionManual
    ? quality.assess(poi.description, row.description, language, null, poi.name) : null;
  const safety = row?.description && !row.descriptionManual
    && [unverifiedHash(poi.description), displayableUnverifiedHash(poi.description)]
      .includes(savedSourceHash)
    ? quality.assessDisplay(poi.description, row.description, language, poi.name) : null;
  const invalidEnglish = language === 'en' && row?.description
    && invalidEnglishDescription(poi.description, row.description);
  let status = 'missing';
  if (row?.descriptionManual) status = 'manual';
  else if (row?.description) {
    if (![sourceHash, verifiedHash(poi.description), unverifiedHash(poi.description),
      displayableUnverifiedHash(poi.description)].includes(savedSourceHash)) status = 'stale';
    else if (preliminary.status === 'rejected' || preliminary.reason === 'vietnamese_text_remaining'
      || invalidEnglish
      || safety && !safety.allowed) status = 'rejected';
    else if (savedSourceHash === verifiedHash(poi.description)) status = 'ready';
    else status = 'unverified';
  }
  const action = ['ready', 'manual'].includes(status)
    || status === 'unverified' && savedSourceHash === displayableUnverifiedHash(poi.description)
    ? 'none' : 'retry_description';
  return { poiId: poi.id, poiName: poi.name, language, status,
    reason: status === 'rejected' ? safety?.reason || (invalidEnglish
      ? 'invalid_english_description' : preliminary.reason) : null,
    sourceHash, savedSourceHash, savedDescriptionHash: row?.description ? hash(row.description) : null,
    writeColumns: action === 'none' ? [] : ['Description', 'DescriptionSourceHash'], action };
}

async function main(args = process.argv.slice(2)) {
  const { ids, languages, retries, applies, fields } = parseScope(args);
  if (process.env.NODE_ENV !== 'test') {
    const identity = (await (await getPool()).request()
      .query('SELECT DB_NAME() AS DatabaseName')).recordset[0];
    if (identity?.DatabaseName !== 'AutoNarrationDB')
      throw new Error('Expected AutoNarrationDB; no POI data was read.');
  }
  const all = await pois.findAll();
  const poi = all.find((item) => item.id.toLowerCase() === ids[0].toLowerCase());
  if (!poi) throw new Error('POI ID does not exist.');
  const row = (await translations.findByPoiIds([poi.id]))
    .find((item) => item.language === languages[0]);
  const preview = review(poi, row, languages[0]);
  const record = fields.length ? preview : { ...preview,
    action: preview.status === 'rejected' ? 'invalidate_hash' : 'none',
    writeColumns: preview.status === 'rejected' ? ['DescriptionSourceHash'] : [] };
  const plan = hash(JSON.stringify(record));
  const mode = retries.length ? 'retry' : applies.length ? 'apply' : 'dry-run';
  process.stdout.write(`${JSON.stringify({ mode, field: fields[0] || null, plan, record }, null, 2)}\n`);
  if (mode === 'dry-run') return;
  if ((retries[0] || applies[0]) !== plan)
    throw new Error('The review plan changed; run a new dry run first.');
  if (record.action === 'none') return;
  if (mode === 'retry') {
    await service.translate(poi.id, { targetLanguages: [languages[0]], descriptionOnly: true });
    process.stdout.write('Description retry completed for the selected POI and language.\n');
    return;
  }
  if (record.status !== 'rejected' || !row) return;
  const result = await (await getPool()).request()
    .input('id', sql.UniqueIdentifier, poi.id)
    .input('language', sql.VarChar(2), languages[0])
    .input('description', sql.NVarChar(sql.MAX), row.description)
    .input('sourceHash', sql.VarChar(64), row.descriptionSourceHash)
    .query(`UPDATE dbo.POITranslations SET DescriptionSourceHash=NULL
      WHERE POIId=@id AND Language=@language AND Description=@description
        AND DescriptionSourceHash=@sourceHash AND DescriptionManual=0`);
  if (result.rowsAffected[0] !== 1) throw new Error('Translation changed during review.');
  process.stdout.write('The selected rejected Description hash was invalidated.\n');
}

if (require.main === module) main().catch((failure) => {
  process.stderr.write(`Description review failed: ${failure.code || failure.message}\n`);
  process.exitCode = 1;
}).finally(closePool);

module.exports = { parseScope, review, main };
