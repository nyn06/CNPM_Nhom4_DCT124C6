const latin = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D');

const types = [
  [/^(?:Đường|Duong|Phố|Pho)\s+/i, { en: 'Street', ja: '通り', ko: '거리' }],
  [/^(?:Phường|Phuong|P\.)\s*/i, { en: 'Ward', ja: '坊', ko: '프엉' }],
  [/^(?:Xã|Xa)\s+/i, { en: 'Commune', ja: 'コミューン', ko: '코뮌' }],
  [/^(?:Quận|Quan|Q\.)\s*/i, { en: 'District', ja: '区', ko: '구' }],
  [/^(?:Huyện|Huyen)\s+/i, { en: 'District', ja: '郡', ko: '현' }],
  [/^(?:Thành phố|Thanh pho|TP\.)\s*/i, { en: 'City', ja: '市', ko: '시' }],
  [/^(?:Tỉnh|Tinh)\s+/i, { en: 'Province', ja: '省', ko: '성' }],
  [/^(?:Thị xã|Thi xa)\s+/i, { en: 'Town', ja: '町', ko: '티싸' }],
  [/^(?:Thị trấn|Thi tran)\s+/i, { en: 'Township', ja: '町', ko: '티쩐' }],
];

function localizedAddress(source, language, streetAddress = '') {
  return String(source || '').split(',').map((part, index) => {
    const raw = part.trim();
    const number = raw.match(/^(\d+(?:[/-]\d+)*\s*(?:Bis\s+)?)/i)?.[0] || '';
    const rest = raw.slice(number.length).trim();
    const kind = types.find(([pattern]) => pattern.test(rest));
    const name = latin(kind ? rest.replace(kind[0], '') : rest).trim();
    const structuredStreet = index === 0 && !!String(streetAddress || '').trim()
      && latin(raw).toLowerCase() === latin(String(streetAddress).trim()).toLowerCase();
    const label = kind?.[1][language] || (structuredStreet ? types[0][1][language] : '');
    const suffix = label && !name.endsWith(label) ? label : '';
    return [number.trim(), name, suffix].filter(Boolean).join(' ');
  }).join(', ');
}

const invalidEnglishDescription = (source, candidate) => !!source && !!candidate
  && (candidate.trim().toLocaleLowerCase('vi-VN') === source.trim().toLocaleLowerCase('vi-VN')
    || candidate.trim().toLocaleLowerCase('vi-VN') === latin(source).trim().toLocaleLowerCase('vi-VN'));

function descriptionRetention(source, backTranslation) {
  const terms = (text) => (latin(text).toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((word) => !['la', 'voi', 'va', 'cua', 'nhung', 'cac', 'mot', 'co', 'cho', 'duoc', 'trong', 'o'].includes(word));
  const original = terms(source);
  if (original.length < 2) return null;
  const returned = new Set(terms(backTranslation));
  return original.filter((word) => returned.has(word)).length / original.length;
}

module.exports = { englishName: latin, englishAddress: (source, streetAddress) => localizedAddress(source, 'en', streetAddress),
  localizedAddress, invalidEnglishDescription, descriptionRetention };
