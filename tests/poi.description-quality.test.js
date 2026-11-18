const { assess, assessDisplay, dishNameInSource, dishTermInSource } = require('../src/services/poi-description-quality');

const source = 'Quán phục vụ bánh mì với thịt, rau và nước sốt.';
const good = 'The restaurant serves banh mi with meat, vegetables, and sauce.';

test('finds a food name from the POI name without hardcoding a POI', () => {
  expect(dishNameInSource('Bánh Mì Việt', source)).toBe('banh mi');
  expect(dishNameInSource('Bún Bò Huế Xưa', 'Quán giới thiệu bún bò Huế.')).toBe('bun bo hue');
});

test.each([
  ['Bánh Canh Cua Sài Gòn', 'Quán phục vụ bánh canh với nước dùng cua.', 'banh canh'],
  ['Phở Hà Nội', 'Phở được nấu với nước dùng bò.', 'pho'],
  ['Bún Bò Huế Xưa', 'Quán phục vụ bún bò Huế cay.', 'bun bo hue'],
  ['Bánh Mì Việt', 'Quán bán bánh mì giòn.', 'banh mi'],
  ['Cơm Tấm Sài Gòn', 'Quán phục vụ cơm tấm với sườn.', 'com tam'],
])('locates a partial Vietnamese dish name in %s', (name, description, expected) => {
  const found = dishTermInSource(name, description);
  expect(found).toMatchObject({ name: expected, fullName: false });
  expect(description.slice(found.start, found.end)).toBeTruthy();
  expect(dishNameInSource(name, description)).toBe(expected);
});

test('does not protect a generic single word from a longer dish name', () => {
  expect(dishTermInSource('Bánh Xèo Miền Tây', 'Quán bán bánh ngọt.')).toBeNull();
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
    'en', source, 'Bánh Mì Việt')).toMatchObject({ status: 'rejected', reason: 'dish_name_missing' });
});

test.each([
  ['', 'empty'],
  [source, 'source_unchanged'],
  ['40 portions', 'numbers_changed'],
  ['__POI_TERM_0__ serves food', 'placeholder_leaked'],
  ['ABCFOOD0ABC serves food', 'placeholder_leaked'],
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

test('rejects cake substituted for pho noodles despite high round-trip word overlap', () => {
  const original = 'Một quán phở phục vụ phở bò với nước dùng thơm và bánh phở mềm.';
  const translated = 'phoは、香りのよい水と柔らかさのケーキを添えています。';
  const back = 'pho phục vụ phở bò với nước thơm và bánh ngọt mềm.';
  expect(assess(original, translated, 'ja', back, 'Phở Hà Nội'))
    .toMatchObject({ status: 'rejected', reason: 'culinary_term_changed' });
});

test('does not mark the observed Korean banh canh fragment ready at 0.5 retention', () => {
  const original = 'Quán bánh canh với sợi bánh mềm dai, nước dùng sánh và hương vị cua.';
  const translated = 'banh canh와 부드럽고 쫄깃한 면, 걸쭉한 육수 및 게의 풍미.';
  const back = 'banh canh và bông mềm, thịt cay và hương vị cua.';
  expect(assess(original, translated, 'ko', back, 'Bánh Canh Cua Sài Gòn'))
    .toMatchObject({ status: 'unverified', reason: 'insufficient_semantic_evidence', retention: 0.5 });
});

test('round-trip word overlap alone cannot verify a changed culinary meaning', () => {
  const original = 'Quán phục vụ phở bò với nước dùng thơm.';
  const translated = 'The restaurant serves pho bo with fragrant water.';
  const back = 'Quán phục vụ phở bò với nước dùng thơm.';
  expect(assess(original, translated, 'en', back, 'Phở Hà Nội'))
    .toMatchObject({ status: 'rejected', reason: 'culinary_term_changed' });
});

test('preserving content words out of order is not sufficient evidence for ready', () => {
  const original = 'Bánh phở mềm và nước dùng thơm.';
  const translated = 'Soft pho noodles and fragrant broth.';
  const back = 'Nước dùng thơm và bánh phở mềm.';
  expect(assess(original, translated, 'en', back, 'Phở Hà Nội'))
    .toMatchObject({ status: 'unverified', reason: 'insufficient_semantic_evidence', retention: 1 });
});

test('display safety is separate from verified:v2', () => {
  expect(assess(source, good, 'en', 'Không liên quan.', 'Bánh Mì Việt').status).toBe('unverified');
  expect(assessDisplay(source, good, 'en', 'Bánh Mì Việt')).toEqual({ allowed: true });
});

test.each([
  ['Quán bánh canh có nước dùng cua.', 'banh canh has water.', 'en', 'Bánh Canh Cua Sài Gòn', 'culinary_term_changed'],
  ['Quán phục vụ chè.', '가게는 찹쌀죽을 제공합니다.', 'ko', 'Chè Ba Miền', 'culinary_term_changed'],
  ['Quán phục vụ hủ tiếu.', 'hu tieu is a restaurant.', 'en', 'Hủ Tiếu Nam Vang', 'dish_place_confusion'],
  ['Quán dùng nước mắm pha.', 'The restaurant serves mixed water.', 'en', 'Quán Việt', 'culinary_term_changed'],
  ['Phở bò với nước dùng thơm.', 'pho와 향긋한 육수.', 'ko', 'Phở Hà Nội', 'required_fact_missing'],
  ['Cơm tấm với nước mắm pha.', 'com tam와 누캉마.', 'ko', 'Cơm Tấm Sài Gòn', 'required_fact_missing'],
  ['Bánh canh với nước dùng sánh.', 'banh canh with rich broth.', 'en', 'Bánh Canh Cua Sài Gòn', 'required_fact_missing'],
  ['Bún bò Huế có sả thơm.', 'bun bo hue with dipping.', 'en', 'Bún Bò Huế Xưa', 'required_fact_missing'],
  ['Ốc được xào với tỏi.', 'Snails are fried with garlic.', 'en', 'Ốc Ngon Ven Phố', 'required_fact_missing'],
  ['Quán phục vụ bánh mì.', 'ZXQFOOD0ZXQ banh mi.', 'en', 'Bánh Mì Việt', 'placeholder_leaked'],
  ['Quán phục vụ bánh mì.', 'ZXQFOOD banh mi.', 'en', 'Bánh Mì Việt', 'protected_term_corrupted'],
  ['Quán phục vụ bánh mì.', '한국어 banh mi.', 'en', 'Bánh Mì Việt', 'wrong_language'],
])('blocks known unsafe public description: %s', (original, translated, language, name, reason) => {
  expect(assessDisplay(original, translated, language, name))
    .toMatchObject({ allowed: false, reason });
});
