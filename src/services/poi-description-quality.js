const { englishName, descriptionRetention } = require('./poi-english');

const words = (value) => englishName(value).toLowerCase().match(/[a-z0-9]+/g) || [];
const numbers = (value) => (String(value).match(/\d+(?:[.,]\d+)?/g) || []).sort().join('|');

function dishNameInSource(name, source) {
  const nameWords = words(name);
  const sourceWords = words(source);
  for (let length = nameWords.length; length >= 2; length--) {
    const term = nameWords.slice(0, length);
    if (sourceWords.some((_, index) => term.every((word, offset) => sourceWords[index + offset] === word)))
      return term.join(' ');
  }
  return null;
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
  if (/__POI_|ZXQFOOD|<\/?span\b|\{\{[^}]*\}\}/iu.test(output))
    return { status: 'rejected', reason: 'placeholder_leaked' };
  if (numbers(source) !== numbers(output)) return { status: 'rejected', reason: 'numbers_changed' };
  const outputWords = words(output);
  if (outputWords.some((word, index) => index >= 2 && word === outputWords[index - 1]
    && word === outputWords[index - 2]))
    return { status: 'rejected', reason: 'repeated_words' };
  const score = descriptionRetention(source, backTranslation);
  if (backTranslation != null && score === 0 && output.length < String(source).length / 2)
    return { status: 'rejected', reason: 'severely_truncated_meaning' };
  const dish = dishNameInSource(poiName, source);
  if (dish && !words(output).join(' ').includes(dish))
    return { status: 'unverified', reason: 'dish_name_missing' };
  if (score === null || score < 0.5)
    return { status: 'unverified', reason: 'insufficient_semantic_evidence', retention: score };
  return { status: 'ready', retention: score };
}

module.exports = { assess, dishNameInSource };
