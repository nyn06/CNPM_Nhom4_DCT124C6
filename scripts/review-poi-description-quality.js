require('dotenv').config();

const { createHash } = require('crypto');
const { sql, getPool } = require('../src/database/repository');
const { closePool } = require('../src/database/connection');
const pois = require('../src/repositories/poi.repository');
const translations = require('../src/repositories/poi-translation.repository');
const provider = require('../src/integrations/translation/translation.provider');
const quality = require('../src/services/poi-description-quality');
const service = require('../src/services/poi-translation.service');

const hash = (value) => createHash('sha256').update(value || '', 'utf8').digest('hex');
const args = process.argv.slice(2);
const ids = args.filter((arg) => arg.startsWith('--id=')).map((arg) => arg.slice(5));
const languages = args.filter((arg) => arg.startsWith('--lang=')).map((arg) => arg.slice(7));
const applyPlan = args.find((arg) => arg.startsWith('--apply='))?.slice(8);
const retryPlan = args.find((arg) => arg.startsWith('--retry='))?.slice(8);
const targets = languages.length ? languages : ['en', 'ja', 'ko'];

async function main() {
  if (ids.some((id) => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
    || targets.some((language) => !['en', 'ja', 'ko'].includes(language)))
    throw new Error('Use POI UUIDs and en, ja, or ko language codes.');
  if ((applyPlan || retryPlan) && (!ids.length || !languages.length))
    throw new Error('A write requires explicit --id and --lang scope plus the reviewed plan hash.');
  if (applyPlan && retryPlan) throw new Error('Choose either --apply or --retry.');
  const all = await pois.findAll();
  const selected = ids.length ? all.filter((poi) => ids.includes(poi.id)) : all;
  if (ids.length !== selected.length && ids.length) throw new Error('One or more POI IDs do not exist.');
  const rows = await translations.findByPoiIds(selected.map((poi) => poi.id));
  const records = [];
  const flagged = [];
  for (const poi of selected) for (const language of targets) {
    const row = rows.find((item) => item.poiId === poi.id && item.language === language);
    let result;
    if (!row?.description) result = { status: 'missing' };
    else if (row.descriptionSourceHash !== hash(poi.description)
      && row.descriptionSourceHash !== hash(`unverified:${poi.description || ''}`))
      result = { status: 'stale' };
    else if (row.descriptionManual) result = { status: 'manual' };
    else {
      try {
        const back = (await provider.translate(row.description, language, 'vi')).text;
        result = quality.assess(poi.description, row.description, language, back, poi.name);
        if (row.descriptionSourceHash === hash(`unverified:${poi.description || ''}`)
          && result.status === 'ready') result = { status: 'unverified', reason: 'stored_unverified' };
      } catch {
        result = { status: 'provider_unavailable' };
      }
    }
    records.push({ poiId: poi.id, language, status: result.status, reason: result.reason || null,
      retention: result.retention ?? null });
    if (result.status === 'rejected' || result.reason === 'vietnamese_text_remaining')
      flagged.push({ poiId: poi.id, language, description: row.description,
        sourceHash: row.descriptionSourceHash });
  }
  const plan = hash(JSON.stringify(records.map((record) => {
    const row = rows.find((item) => item.poiId === record.poiId && item.language === record.language);
    const poi = selected.find((item) => item.id === record.poiId);
    return { ...record, sourceHash: hash(poi.description),
      savedDescriptionHash: hash(row?.description), savedSourceHash: row?.descriptionSourceHash };
  })));
  const counts = records.reduce((result, row) => {
    result[row.status] = (result[row.status] || 0) + 1;
    return result;
  }, {});
  process.stdout.write(`${JSON.stringify({ mode: applyPlan ? 'apply' : retryPlan ? 'retry' : 'dry-run',
    poiCount: selected.length, counts, plan, records }, null, 2)}\n`);
  if (!applyPlan && !retryPlan) return;
  if ((applyPlan || retryPlan) !== plan || records.some((row) => row.status === 'provider_unavailable'))
    throw new Error('Audit changed or provider was unavailable. Review a new dry-run plan first.');
  if (retryPlan) {
    const results = [];
    for (const poi of selected) for (const language of targets) {
      const record = records.find((item) => item.poiId === poi.id && item.language === language);
      if (!record || ['ready', 'manual'].includes(record.status)) continue;
      try {
        await service.translate(poi.id, { targetLanguages: [language] });
        results.push({ poiId: poi.id, language, result: 'translated' });
      } catch (error) {
        results.push({ poiId: poi.id, language, result: 'failed',
          code: error.code || 'TRANSLATION_FAILED' });
      }
    }
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
    if (results.some((item) => item.result === 'failed')) process.exitCode = 1;
    return;
  }
  const tx = new sql.Transaction(await getPool());
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    for (const row of flagged) {
      const result = await new sql.Request(tx)
        .input('id', sql.UniqueIdentifier, row.poiId)
        .input('language', sql.VarChar(2), row.language)
        .input('description', sql.NVarChar(sql.MAX), row.description)
        .input('hash', sql.VarChar(64), row.sourceHash)
        .query(`UPDATE dbo.POITranslations SET DescriptionSourceHash=NULL
          WHERE POIId=@id AND Language=@language AND Description=@description
            AND DescriptionSourceHash=@hash AND DescriptionManual=0`);
      if (result.rowsAffected[0] !== 1)
        throw new Error('A translation changed during review; no updates committed.');
    }
    await tx.commit();
    process.stdout.write(`Invalidated ${flagged.length} scoped descriptions; the original text remains stored.\n`);
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

main().catch((error) => { console.error(`Description review failed: ${error.code || error.message}`);
  process.exitCode = 1; }).finally(closePool);
