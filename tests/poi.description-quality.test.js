const { assess, dishNameInSource } = require('../src/services/poi-description-quality');

const source = 'Quán phục vụ bánh mì với thịt, rau và nước sốt.';
const good = 'The restaurant serves banh mi with meat, vegetables, and sauce.';

test('finds a food name from the POI name without hardcoding a POI', () => {
  expect(dishNameInSource('Bánh Mì Việt', source)).toBe('banh mi');
  expect(dishNameInSource('Bún Bò Huế Xưa', 'Quán giới thiệu bún bò Huế.')).toBe('bun bo hue');
});

test('retains a plausible translation when the back translation is informative', () => {
  expect(assess(source, good, 'en', source, 'Bánh Mì Việt')).toMatchObject({ status: 'ready' });
  expect(assess('40 phần ăn', '40 portions', 'en', '40 phần ăn')).toMatchObject({ status: 'ready' });
});

test('does not reject a plausible forward translation solely because back translation is poor', () => {
  expect(assess(source, good, 'en', 'Địa điểm bán đồ ăn.', 'Bánh Mì Việt'))
    .toMatchObject({ status: 'unverified', reason: 'insufficient_semantic_evidence' });
});

test('requires preservation of a food name found in the source', () => {
  expect(assess(source, 'The restaurant serves bread with meat, vegetables, and sauce.',
    'en', source, 'Bánh Mì Việt')).toMatchObject({ status: 'unverified', reason: 'dish_name_missing' });
});

test.each([
  ['', 'empty'],
  [source, 'source_unchanged'],
  ['40 portions', 'numbers_changed'],
  ['__POI_TERM_0__ serves food', 'placeholder_leaked'],
  ['Food food food', 'repeated_words'],
])('rejects structurally unsafe result: %s', (candidate, reason) => {
  const original = candidate === '40 portions' ? '41 phần ăn' : source;
  expect(assess(original, candidate, 'en', original))
    .toMatchObject({ status: 'rejected', reason });
});

test('requires Japanese and Korean scripts, and does not accept Vietnamese with an English prefix', () => {
  expect(assess(source, 'Translated banh mi', 'ja', source, 'Bánh Mì Việt'))
    .toMatchObject({ status: 'rejected', reason: 'wrong_language' });
  expect(assess(source, 'Translated banh mi', 'ko', source, 'Bánh Mì Việt'))
    .toMatchObject({ status: 'rejected', reason: 'wrong_language' });
  expect(assess(source, 'English: Quán phục vụ bánh mì', 'en', source, 'Bánh Mì Việt'))
    .toMatchObject({ status: 'unverified', reason: 'vietnamese_text_remaining' });
});
