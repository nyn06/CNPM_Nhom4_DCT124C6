const { englishName, descriptionRetention, descriptionEvidence } = require('./poi-english');

const words = (value) => englishName(value).toLowerCase().match(/[a-z0-9]+/g) || [];
const numbers = (value) => (String(value).match(/\d+(?:[.,]\d+)?/g) || []).sort().join('|');
const culinaryConflicts = [
  { source: /bánh phở/iu, output: { en: /\b(?:cake|bread)\b/iu,
    ja: /ケーキ|パン/u, ko: /케이크|빵/u } },
  { source: /nước dùng/iu, output: { en: /\bwater\b/iu, ja: /水/u } },
];

function dishTermInSource(name, source) {
  const nameWords = words(name);
  const sourceWords = [...String(source || '').matchAll(/[\p{L}\p{M}\p{N}]+/gu)]
    .map((match) => ({ word: englishName(match[0]).toLowerCase(),
      start: match.index, end: match.index + match[0].length }));
  for (let length = nameWords.length; length >= 1; length--) {
    // A single generic word such as "bánh" is not enough to identify a dish.
    if (length === 1 && nameWords[0] !== 'pho') continue;
    const term = nameWords.slice(0, length);
    for (let index = 0; index <= sourceWords.length - length; index++) {
      if (term.every((word, offset) => sourceWords[index + offset].word === word))
        return { name: term.join(' '), start: sourceWords[index].start,
          end: sourceWords[index + length - 1].end, fullName: length === nameWords.length };
    }
  }
  return null;
}
const dishNameInSource = (name, source) => dishTermInSource(name, source)?.name || null;

// Public display is a separate policy from verified:v2. This is a conservative
// technical/content guard, not a claim that the translation is semantically verified.
function assessDisplay(source, candidate, language, poiName = '') {
  const basic = assess(source, candidate, language, null, poiName);
  if (basic.status === 'rejected' || basic.reason === 'vietnamese_text_remaining')
    return { allowed: false, reason: basic.reason };
  const text = String(candidate || '');
  if (language === 'en' && /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3]/u.test(text)
    || language === 'ja' && /[\uac00-\ud7a3]/u.test(text)
    || language === 'ko' && /[\u3040-\u30ff\u3400-\u9fff]/u.test(text))
    return { allowed: false, reason: 'wrong_language' };
  const prepared = require('./poi-description-pipeline').prepare(source, poiName, language);
  const token = prepared.protectedDish?.token;
  if (token) {
    const parts = token.match(/^([A-Z]{3,})\d+([A-Z]{3,})$/u);
    if (parts && [parts[1], parts[2]].some((part) => text.toUpperCase().includes(part)))
      return { allowed: false, reason: 'protected_term_corrupted' };
  }
  // Block concrete errors observed in the saved LibreTranslate/DeepL corpus.
  if (/nước dùng/iu.test(source) && (language === 'ko' && /(?<![가-힣])물(?:을|이|은|과|로)?(?![가-힣])/u.test(text)))
    return { allowed: false, reason: 'culinary_term_changed' };
  if (/nước mắm/iu.test(source) && ({ en: /\b(?:mixed|seasoned) water\b/iu,
    ja: /混合された水|混ぜた水/u, ko: /혼합(?:된)? 물/u }[language]?.test(text)))
    return { allowed: false, reason: 'culinary_term_changed' };
  if (/(?<!\p{L})chè(?!\p{L})/iu.test(source) && ({ en: /\b(?:tea|wine|alcohol)\b/iu,
    ja: /紅茶|ワイン|アルコール/u, ko: /찹쌀죽|와인|알코올/u }[language]?.test(text)))
    return { allowed: false, reason: 'culinary_term_changed' };
  const dish = dishTermInSource(poiName, source);
  if (dish && language === 'en') {
    const escaped = dish.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\s+is\\s+(?:a\\s+)?(?:[\\w-]+\\s+){0,4}restaurant\\b`, 'iu').test(text))
      return { allowed: false, reason: 'dish_place_confusion' };
  }
  if (/\b[A-Za-z]{2,}QQ\b/u.test(text))
    return { allowed: false, reason: 'protected_term_corrupted' };
  const requiredFacts = [
    [/nước dùng/iu, { en: /\b(?:broth|stock|soup)\b/iu, ja: /スープ|だし|出汁/u,
      ko: /육수|국물/u }],
    [/nước cốt dừa/iu, { en: /coconut (?:milk|cream)/iu, ja: /ココナッツミルク/u,
      ko: /코코넛 (?:밀크|우유)/u }],
    [/nước mắm/iu, { en: /fish sauce/iu, ja: /魚醤|ヌクマム|ナンプラー/u,
      ko: /느억맘|피시 소스|피쉬 소스|액젓|생선 소스/u }],
    [/(?<!\p{L})sả(?!\p{L})/iu, { en: /lemongrass/iu, ja: /レモングラス/u,
      ko: /레몬그라스/u }],
    [/(?<!\p{L})giòn(?!\p{L})/iu, { en: /\b(?:crispy|crunchy)\b/iu,
      ja: /サクサク|カリカリ/u, ko: /바삭/u }],
    [/(?<!\p{L})mềm(?!\p{L})/iu, { en: /\b(?:soft|tender)\b/iu,
      ja: /柔らか|やわらか/u, ko: /부드러/u }],
    [/(?<!\p{L})dai(?!\p{L})/iu, { en: /\bchewy\b/iu,
      ja: /コシ|もちもち/u, ko: /쫄깃/u }],
    [/(?<!\p{L})sánh(?!\p{L})/iu, { en: /\b(?:thick|viscous)\b/iu,
      ja: /とろみ/u, ko: /걸쭉/u }],
    [/(?<!\p{L})nhân(?!\p{L})/iu, { en: /\bfillings?\b/iu,
      ja: /具材|具/u, ko: /속재료|속/u }],
    [/Nam Vang/iu, { en: /\b(?:Nam Vang|Phnom Penh)\b/iu,
      ja: /ナムヴァン|プノンペン|Nam Vang/u, ko: /남방|프놈펜|Nam Vang/u }],
    [/(?<!\p{L})xào(?!\p{L})/iu, { en: /\bstir[- ](?:fry|fried)\b/iu,
      ja: /炒/u, ko: /볶/u }],
  ];
  const missingFact = requiredFacts.find(([sourceFact, targets]) => sourceFact.test(source)
    && !targets[language].test(text));
  if (missingFact)
    return { allowed: false, reason: 'required_fact_missing', sourceFact: missingFact[0].source };
  const sourceWithoutDish = dish ? `${source.slice(0, dish.start)}${source.slice(dish.end)}` : source;
  if (/(?<!\p{L})bò(?!\p{L})/iu.test(sourceWithoutDish)
    && !{ en: /\bbeef\b/iu, ja: /牛肉|ビーフ/u,
      ko: /소고기|쇠고기/u }[language].test(text))
    return { allowed: false, reason: 'required_fact_missing' };
  return { allowed: true };
}

function assess(source, candidate, language, backTranslation, poiName = '') {
  const output = String(candidate || '').trim();
  if (!output) return { status: 'rejected', reason: 'empty' };
  if (englishName(output).toLowerCase() === englishName(source).trim().toLowerCase())
    return { status: 'rejected', reason: 'source_unchanged' };
  if (language === 'ja' && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(output)
    || language === 'ko' && !/[\uac00-\ud7a3]/u.test(output))
    return { status: 'rejected', reason: 'wrong_language' };
  if (language === 'en' && /[ăâêôơưđáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/iu.test(output))
    return { status: 'unverified', reason: 'vietnamese_text_remaining' };
  if (/__[A-Z][A-Z0-9_]*__|[A-Z]{3,}[A-Z0-9]*\d+[A-Z]{3,}|<\/?span\b|\{\{[^}]*\}\}/u.test(output))
    return { status: 'rejected', reason: 'placeholder_leaked' };
  if (numbers(source) !== numbers(output)) return { status: 'rejected', reason: 'numbers_changed' };
  if (culinaryConflicts.some((rule) => rule.source.test(source)
    && rule.output[language]?.test(output)))
    return { status: 'rejected', reason: 'culinary_term_changed' };
  const outputWords = words(output);
  if (outputWords.some((word, index) => index >= 2 && word === outputWords[index - 1]
    && word === outputWords[index - 2]))
    return { status: 'rejected', reason: 'repeated_words' };
  const score = descriptionRetention(source, backTranslation);
  if (backTranslation != null && score === 0 && output.length < String(source).length / 2)
    return { status: 'rejected', reason: 'severely_truncated_meaning' };
  const dish = dishNameInSource(poiName, source);
  if (dish && !words(output).join(' ').includes(dish))
    return { status: 'rejected', reason: 'dish_name_missing' };
  if (!descriptionEvidence(source, backTranslation))
    return { status: 'unverified', reason: 'insufficient_semantic_evidence', retention: score };
  return { status: 'ready', retention: score };
}

module.exports = { assess, assessDisplay, dishNameInSource, dishTermInSource };
