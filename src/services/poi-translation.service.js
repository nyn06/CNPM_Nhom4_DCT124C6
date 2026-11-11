const { createHash } = require('crypto');
const poiRepository = require('../repositories/poi.repository');
const translationsRepository = require('../repositories/poi-translation.repository');
const jobsRepository = require('../repositories/poi-translation-job.repository');
const provider = require('../integrations/translation/translation.provider');
const { englishName, localizedAddress, invalidEnglishDescription } = require('./poi-english');
const descriptionQuality = require('./poi-description-quality');

const fields = ['name', 'description', 'address'];
const languages = ['vi', 'en', 'ja', 'ko'];
const hash = (value) => createHash('sha256').update(value || '', 'utf8').digest('hex');
const unverifiedHash = (value) => hash(`unverified:${value || ''}`);
const currentHash = (poi, row, field) => row[sourceKey(field)] === hash(poi[field])
  || field === 'description' && row[sourceKey(field)] === unverifiedHash(poi[field]);
const sourceKey = (field) => `${field}SourceHash`;
const manualKey = (field) => `${field}Manual`;
const fail = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code });
async function checkDescription(source, translated, language, poiName) {
  const structural = descriptionQuality.assess(source, translated, language, null, poiName);
  if (structural.status === 'rejected')
    throw fail('Bản dịch mô tả không hợp lệ.', 502, 'UNTRUSTED_TRANSLATION');
  const back = (await provider.translate(translated, language, 'vi'))?.text;
  const result = descriptionQuality.assess(source, translated, language, back || '', poiName);
  if (result.status === 'rejected')
    throw fail('Bản dịch mô tả không hợp lệ.', 502, 'UNTRUSTED_TRANSLATION');
  return result;
}

function inspect(poi, row) {
  if (!row) return null;
  const preliminary = row.description && !row.descriptionManual && currentHash(poi, row, 'description')
    ? descriptionQuality.assess(poi.description, row.description, row.language, null, poi.name) : null;
  const qualityWarning = preliminary && (preliminary.status === 'rejected'
    || preliminary.reason === 'vietnamese_text_remaining')
    ? preliminary.reason : null;
  return { ...row, stale: Object.fromEntries(fields.map((field) => {
    const expected = field === 'name' ? englishName(poi.name)
      : field === 'address' ? localizedAddress(poi.address, row.language, poi.streetAddress) : null;
    const stale = !!row[field] && (!currentHash(poi, row, field)
      || field === 'description' && row.language === 'en' && !row.descriptionManual
        && invalidEnglishDescription(poi.description, row.description)
      || field === 'description' && !!qualityWarning
      || expected !== null && !row[manualKey(field)] && row[field] !== expected);
    return [field, stale];
  })), qualityWarning, descriptionRejected: preliminary?.status === 'rejected',
  descriptionUnverified: row.descriptionSourceHash === unverifiedHash(poi.description)
    || preliminary?.reason === 'dish_name_missing' };
}

function display(poi, language, rows) {
  if (language === 'vi') return poi;
  const row = inspect(poi, rows.find((entry) => entry.poiId === poi.id && entry.language === language));
  return { ...poi, ...Object.fromEntries(fields.map((field) =>
    [field, field === 'name' ? englishName(poi.name)
      : field === 'address' ? localizedAddress(poi.address, language, poi.streetAddress)
        : row?.[field] && !row.stale[field] ? row[field] : poi[field]])) };
}

class PoiTranslationService {
  language(value) {
    const language = value || 'vi';
    if (!languages.includes(language)) throw fail('Ngôn ngữ POI không được hỗ trợ.', 400);
    return language;
  }

  async list(pois, language, admin = false, includePublicTranslations = false) {
    const chosen = this.language(language);
    const rows = await translationsRepository.findByPoiIds(pois.map((poi) => poi.id));
    const jobs = await jobsRepository.findByPoiIds(pois.map((poi) => poi.id));
    return pois.map((poi) => {
      const localized = display(poi, chosen, rows);
      const job = jobs.find((entry) => entry.poiId === poi.id);
      const translationStatus = Object.fromEntries(languages.slice(1).map((target) => {
        const row = inspect(poi, rows.find((entry) => entry.poiId === poi.id && entry.language === target));
        return [target, Object.fromEntries(fields.map((field) => {
          if (!poi[field] || field !== 'description') return [field, 'ready'];
          if (row?.[field] && !row.stale[field]) return [field,
            row.descriptionUnverified ? 'unverified' : 'ready'];
          if (row?.qualityWarning) return [field, row.descriptionRejected ? 'rejected' : 'unverified'];
          if (row?.description) {
            if (job?.status === 'processing') return [field, 'processing'];
            if (job?.status === 'pending' && !job.lastErrorCode) return [field, 'pending'];
            return [field, 'unverified'];
          }
          if (job?.status === 'processing') return [field, 'processing'];
          if (job?.lastErrorCode === 'UNTRUSTED_TRANSLATION') return [field, 'rejected'];
          if (job?.lastErrorCode === 'UNVERIFIED_TRANSLATION') return [field, 'unverified'];
          if (job?.lastErrorCode || job?.status === 'failed') return [field, 'failed'];
          return [field, job ? 'pending' : 'missing'];
        }))];
      }));
      const translationPending = languages.slice(1).some((target) =>
        ['missing', 'pending', 'processing'].includes(translationStatus[target].description));
      const translationFallback = Object.fromEntries(languages.slice(1).map((target) => {
        const row = inspect(poi, rows.find((entry) => entry.poiId === poi.id && entry.language === target));
        return [target, !!poi.description && !(!row?.stale.description && row?.description)];
      }));
      if (!admin) {
        if (!includePublicTranslations) return chosen === 'vi' ? localized
          : { ...localized, translationStatus, translationFallback };
        return { ...localized, translationPending, translationStatus, translationFallback,
          translations: Object.fromEntries(languages.slice(1).map((target) => {
          const view = display(poi, target, rows);
          return [target, Object.fromEntries(fields.map((field) => [field, view[field]]))];
        })) };
      }
      return { ...localized, translationPending, translationStatus, translationFallback,
        original: Object.fromEntries(fields.map((field) => [field, poi[field]])),
        resolvedTranslations: Object.fromEntries(languages.slice(1).map((target) => [target,
          Object.fromEntries(fields.map((field) => [field, display(poi, target, rows)[field]]))])),
        translations: Object.fromEntries(rows.filter((row) => row.poiId === poi.id)
          .map((row) => [row.language, inspect(poi, row)])) };
    });
  }

  async get(id) {
    const poi = await poiRepository.findById(id);
    if (!poi) throw fail('Không tìm thấy POI.', 404);
    return poi;
  }

  async details(id) {
    const poi = await this.get(id);
    const rows = await translationsRepository.findByPoiIds([id]);
    return { poiId: id, translations: Object.fromEntries(rows.map((row) => [row.language, inspect(poi, row)])) };
  }

  async save(id, language, data) {
    if (!languages.slice(1).includes(language)) throw fail('Chỉ lưu bản dịch en, ja, ko.', 400);
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || !fields.some((field) => Object.hasOwn(data, field))) throw fail('Cần ít nhất một trường bản dịch.', 400);
    const poi = await this.get(id);
    const current = (await translationsRepository.findByPoiIds([id])).find((row) => row.language === language) || {};
    const item = { poiId: id, language };
    for (const field of fields) {
      const supplied = Object.hasOwn(data, field);
      const value = supplied ? data[field] : current[field] || null;
      if (supplied && (typeof value !== 'string' || !value.trim()
        || (field === 'name' && value.length > 255) || (field === 'address' && value.length > 500))) {
        throw fail(`Bản dịch ${field} không hợp lệ.`, 400);
      }
      item[field] = supplied ? value.trim() : value;
      item[sourceKey(field)] = supplied ? hash(poi[field]) : current[sourceKey(field)] || null;
      item[manualKey(field)] = supplied ? true : !!current[manualKey(field)];
    }
    await translationsRepository.save(item);
    return inspect(poi, item);
  }

  async translate(id, data = {}) {
    const targets = data.targetLanguages || languages.slice(1);
    if (!Array.isArray(targets) || !targets.length || new Set(targets).size !== targets.length
      || targets.some((language) => !languages.slice(1).includes(language))) {
      throw fail('targetLanguages chỉ nhận en, ja, ko, không trùng lặp.', 400);
    }
    if (data.overwriteManual !== undefined && typeof data.overwriteManual !== 'boolean')
      throw fail('overwriteManual phải là boolean.', 400);
    const poi = await this.get(id);
    const previous = await translationsRepository.findByPoiIds([id]);
    const updates = [];
    for (const language of targets) {
      const current = previous.find((row) => row.language === language) || {};
      const warning = inspect(poi, current)?.qualityWarning;
      const item = { poiId: id, language };
      const changed = [];
      for (const field of fields) {
        item[field] = current[field] || null;
        item[sourceKey(field)] = current[sourceKey(field)] || null;
        item[manualKey(field)] = !!current[manualKey(field)];
        const deterministicValue = field === 'name' ? englishName(poi.name)
          : field === 'address' ? localizedAddress(poi.address, language, poi.streetAddress) : null;
        if (!poi[field] || (item[field] && currentHash(poi, item, field)
          && (deterministicValue === null || item[field] === deterministicValue)
          && !(field === 'description' && warning)
          && !(language === 'en' && field === 'description'
            && invalidEnglishDescription(poi.description, item.description)))
          || (item[manualKey(field)] && !data.overwriteManual)) continue;
        changed.push(field);
      }
      for (const field of changed) {
        const protectedName = language === 'en' && field === 'description' ? englishName(poi.name) : null;
        const namedSource = protectedName && poi.name
          ? poi[field].replace(new RegExp(poi.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), protectedName)
          : poi[field];
        const providerSource = language === 'en' && field === 'description'
          ? namedSource.replace(/nước dùng/giu, 'broth') : namedSource;
        const value = field === 'name' ? englishName(poi.name)
          : field === 'address' ? localizedAddress(poi.address, language, poi.streetAddress)
            : (await provider.translate(providerSource, 'vi', language))?.text?.trim();
        if (!value || (field === 'name' && value.length > 255) || (field === 'address' && value.length > 500))
          throw fail('Dịch vụ trả bản dịch POI không hợp lệ.', 502);
        if (field === 'description' && namedSource !== poi[field]
          && !value.toLowerCase().includes(protectedName.toLowerCase()))
          throw fail('Bản dịch mô tả làm mất tên địa điểm.', 502, 'UNTRUSTED_TRANSLATION');
        const quality = field === 'description'
          ? await checkDescription(poi[field], value, language, poi.name) : null;
        item[field] = value;
        item[sourceKey(field)] = quality?.status === 'unverified'
          ? unverifiedHash(poi[field]) : hash(poi[field]);
        item[manualKey(field)] = false;
      }
      updates.push({ item, changed });
    }
    const latest = await this.get(id);
    if (fields.some((field) => latest[field] !== poi[field]))
      throw fail('Thông tin tiếng Việt đã thay đổi trong khi dịch.', 409);
    const latestRows = await translationsRepository.findByPoiIds([id]);
    for (const { item, changed } of updates) {
      if (!changed.length) continue;
      const latestRow = latestRows.find((row) => row.language === item.language);
      const originalRow = previous.find((row) => row.language === item.language);
      if (changed.some((field) => latestRow?.[field] !== originalRow?.[field]
        || latestRow?.[sourceKey(field)] !== originalRow?.[sourceKey(field)]
        || (latestRow?.[manualKey(field)] && !data.overwriteManual)))
        throw fail('Bản dịch đã được Admin chỉnh sửa trong khi dịch.', 409);
      for (const field of fields.filter((name) => !changed.includes(name))) {
        item[field] = latestRow?.[field] || null;
        item[sourceKey(field)] = latestRow?.[sourceKey(field)] || null;
        item[manualKey(field)] = !!latestRow?.[manualKey(field)];
      }
    }
    for (const { item, changed } of updates) if (changed.length) await translationsRepository.save(item);
    return this.details(id);
  }
}

module.exports = new PoiTranslationService();
