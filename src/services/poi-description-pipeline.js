const { englishName } = require('./poi-english');
const quality = require('./poi-description-quality');
const protectedTokens = require('./poi-protected-tokens');

const englishGlossary = [
  { source: 'nước dùng sánh', target: 'thick broth' },
].sort((left, right) => right.source.length - left.source.length);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function protectEnglishTerms(source) {
  let providerSource = source;
  const protectedTerms = [];
  let index = 0;
  for (const term of englishGlossary) {
    const phrase = term.source.split(/\s+/u).map(escape).join('\\s+');
    const pattern = new RegExp(`(?<![\\p{L}\\p{M}])${phrase}(?![\\p{L}\\p{M}])`, 'giu');
    providerSource = providerSource.replace(pattern, () => {
      let token;
      do { token = `ZXQTERM${index++}ZXQ`; }
      while (source.includes(token) || providerSource.includes(token));
      protectedTerms.push({ token, value: term.target });
      return token;
    });
  }
  return { providerSource, protectedTerms };
}

function prepare(source, poiName, language) {
  const protectedName = language === 'en' ? englishName(poiName) : null;
  const namedSource = protectedName && poiName
    ? source.replace(new RegExp(poiName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), protectedName)
    : source;
  const dish = quality.dishTermInSource(poiName, namedSource);
  let protectedDish = null;
  if (dish && !(dish.fullName && language === 'en')) {
    let index = 0;
    let token;
    do { token = `ZXQFOOD${index++}ZXQ`; } while (namedSource.includes(token));
    protectedDish = { token, name: dish.fullName ? englishName(poiName) : dish.name };
  }
  const tokenized = protectedDish
    ? `${namedSource.slice(0, dish.start)}${protectedDish.token}${namedSource.slice(dish.end)}`
    : namedSource;
  const protectedEnglish = language === 'en'
    ? protectEnglishTerms(tokenized) : { providerSource: tokenized, protectedTerms: [] };
  const providerSource = language === 'en'
    ? protectedEnglish.providerSource.replace(/nước dùng/giu, 'broth')
    : protectedEnglish.providerSource;
  return { originalSource: source, namedSource, protectedName, protectedDish,
    protectedTerms: protectedEnglish.protectedTerms, providerSource };
}

function restore(translated, prepared) {
  let value = translated;
  const entries = [
    ...(prepared.protectedDish
      ? [{ token: prepared.protectedDish.token, value: prepared.protectedDish.name }] : []),
    ...(prepared.protectedTerms || []),
  ];
  if (entries.length) {
    const restored = protectedTokens.restore(value, entries);
    if (restored.reason) return { text: null, reason: restored.reason, stage: 'token' };
    value = restored.text;
  }
  if (prepared.namedSource !== prepared.originalSource
    && !value.toLowerCase().includes(prepared.protectedName.toLowerCase()))
    return { text: null, reason: 'place_name_missing', stage: 'place' };
  return { text: value, reason: null, stage: null };
}

module.exports = { prepare, restore };
