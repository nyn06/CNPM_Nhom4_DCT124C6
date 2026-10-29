const { createHash } = require('crypto');
const poiRepository = require('../repositories/poi.repository');
const translationsRepository = require('../repositories/poi-translation.repository');
const provider = require('../integrations/translation/translation.provider');

const fields = ['name', 'description', 'address'];
const languages = ['vi', 'en', 'ja', 'ko'];
const hash = (value) => createHash('sha256').update(value || '', 'utf8').digest('hex');
const sourceKey = (field) => `${field}SourceHash`;
const manualKey = (field) => `${field}Manual`;
const fail = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code });
const latin = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
const nameWords = (value) => latin(value).toLowerCase().match(/[a-z0-9]+/g) || [];
const sharesName = (source, candidate) => {
  const sourceWords = nameWords(source);
  const candidateWords = nameWords(candidate);
  return sourceWords.length > 0 && sourceWords.filter((word) => candidateWords.includes(word)).length
    >= Math.ceil(sourceWords.length / 2);
};
async function safeName(source, translated, language) {
  const unreliable = () => fail('Bản dịch tên địa điểm không đủ tin cậy.', 502, 'UNTRUSTED_TRANSLATION');
  if (/[?\uFFFD]/u.test(translated)
    || translated.trim().toLocaleLowerCase('vi-VN') === source.trim().toLocaleLowerCase('vi-VN')) throw unreliable();
  // Preserve place names that the provider transliterates. Semantic translations
  // such as "Cơm gà" -> "Chicken rice" need a round trip instead of word overlap.
  if (sharesName(source, translated)) return translated;
  const back = await provider.translate(translated, language, 'vi');
  if (!sharesName(source, back.text)) throw unreliable();
  return translated;
}
const addressTypes = [
  { pattern: /^(?:Đường|Duong)\s+/i, label: { en: 'Street', ja: '通り', ko: '거리' } },
  { pattern: /^(?:Phường|Phuong)\s+/i, label: { en: 'Ward', ja: '区', ko: '동' } },
  { pattern: /^(?:Quận|Quan)\s+/i, label: { en: 'District', ja: '区', ko: '구' } },
  { pattern: /^(?:Thành phố|Thanh pho|TP\.)\s*/i, label: { en: 'City', ja: '市', ko: '시' } },
  { pattern: /^(?:Tỉnh|Tinh)\s+/i, label: { en: 'Province', ja: '県', ko: '도' } },
];
function safeAddress(source, language) {
  return source.split(',').map((part, index) => {
    const raw = part.trim();
    const number = index === 0 ? raw.match(/^(\d+(?:[/-]\d+)*\s*(?:Bis\s+)?)/i)?.[0] || '' : '';
    const rest = raw.slice(number.length).trim();
    const kind = addressTypes.find((entry) => entry.pattern.test(rest));
    const name = latin(kind ? rest.replace(kind.pattern, '') : rest).trim();
    const label = kind?.label[language] || (index === 0 && number
      ? { en: 'Street', ja: '通り', ko: '거리' }[language] : '');
    return [number.trim(), name, label].filter(Boolean).join(' ');
  }).join(', ');
}
function addressIsFaithful(source, translated) {
  const numbers = (text) => (text.match(/\d+/g) || []).sort().join('|');
  if (numbers(source) !== numbers(translated)) return false;
  const output = latin(translated).toLocaleLowerCase('vi-VN');
  return source.split(',').every((part) => {
    const kind = addressTypes.find((entry) => entry.pattern.test(part.trim()));
    const name = latin(kind ? part.trim().replace(kind.pattern, '') : part.trim())
      .replace(/\d+/g, '').trim().toLocaleLowerCase('vi-VN');
    return !name || output.includes(name);
  });
}

function inspect(poi, row) {
  if (!row) return null;
  return { ...row, stale: Object.fromEntries(fields.map((field) =>
    [field, !!row[field] && row[sourceKey(field)] !== hash(poi[field])])) };
}

function display(poi, language, rows) {
  if (language === 'vi') return poi;
  const row = inspect(poi, rows.find((entry) => entry.poiId === poi.id && entry.language === language));
  return { ...poi, ...Object.fromEntries(fields.map((field) =>
    [field, row?.[field] && !row.stale[field] ? row[field] : poi[field]])) };
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
    return pois.map((poi) => {
      const localized = display(poi, chosen, rows);
      const translationPending = languages.slice(1).some((target) => {
        const row = rows.find((entry) => entry.poiId === poi.id && entry.language === target);
        return fields.some((field) => poi[field] && !row?.[manualKey(field)]
          && (!row?.[field] || row[sourceKey(field)] !== hash(poi[field])));
      });
      if (!admin) {
        if (!includePublicTranslations) return localized;
        return { ...localized, translationPending, translations: Object.fromEntries(languages.slice(1).map((target) => {
          const view = display(poi, target, rows);
          return [target, Object.fromEntries(fields.map((field) => [field, view[field]]))];
        })) };
      }
      return { ...localized, original: Object.fromEntries(fields.map((field) => [field, poi[field]])),
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
      const item = { poiId: id, language };
      const changed = [];
      for (const field of fields) {
        item[field] = current[field] || null;
        item[sourceKey(field)] = current[sourceKey(field)] || null;
        item[manualKey(field)] = !!current[manualKey(field)];
        if (!poi[field] || (item[field] && item[sourceKey(field)] === hash(poi[field]))
          || (item[manualKey(field)] && !data.overwriteManual)) continue;
        changed.push(field);
      }
      for (const field of changed) {
        const value = (await provider.translate(poi[field], 'vi', language))?.text?.trim();
        if (!value || (field === 'name' && value.length > 255) || (field === 'address' && value.length > 500))
          throw fail('Dịch vụ trả bản dịch POI không hợp lệ.', 502);
        if (field === 'description' && value === poi[field] && latin(value) !== value)
          throw fail('Bản dịch mô tả chưa thay đổi ngôn ngữ.', 502);
        item[field] = field === 'name' ? await safeName(poi[field], value, language)
          : field === 'address' && !addressIsFaithful(poi[field], value)
            ? safeAddress(poi[field], language) : value;
        item[sourceKey(field)] = hash(poi[field]);
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
