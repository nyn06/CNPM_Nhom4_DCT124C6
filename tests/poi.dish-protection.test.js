jest.mock('../src/integrations/translation/translation.provider', () => ({ translate: jest.fn() }));

const { createHash } = require('crypto');
const pois = require('../src/repositories/poi.repository');
const translations = require('../src/repositories/poi-translation.repository');
const service = require('../src/services/poi-translation.service');
const provider = require('../src/integrations/translation/translation.provider');
const { verifiedHash } = require('../src/services/poi-description-hash');

const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const base = { id: 'protected-dish', category: 'food', address: '40 Tú Xương',
  latitude: 10, longitude: 106, geofenceRadius: 50, isActive: true };
const cases = [
  ['Bánh Canh Cua Sài Gòn', 'Quán phục vụ bánh canh với nước dùng cua.', 'banh canh'],
  ['Phở Hà Nội', 'Phở có nước dùng bò.', 'pho'],
  ['Bún Bò Huế Xưa', 'Quán phục vụ bún bò Huế cay.', 'bun bo hue'],
  ['Bánh Mì Việt', 'Quán bán bánh mì giòn.', 'banh mi'],
  ['Cơm Tấm Sài Gòn', 'Quán phục vụ cơm tấm với sườn.', 'com tam'],
];

beforeEach(() => {
  pois.clear();
  translations.clear();
  provider.translate.mockReset();
});

test.each(cases)('protects %s through EN, JA and KO translation', async (name, description, dish) => {
  pois.create({ ...base, name, description });
  provider.translate.mockImplementation(async (text, _from, target) => {
    if (target === 'vi') return { text: description };
    const token = text.match(/ZXQFOOD\d+ZXQ/)?.[0];
    expect(token).toBeTruthy();
    return { text: { en: `The restaurant serves ${token} with broth.`,
      ja: `この店は ${token} を提供します。`, ko: `이 식당은 ${token}를 제공합니다.` }[target] };
  });
  await service.translate(base.id, { targetLanguages: ['en', 'ja', 'ko'] });
  const rows = await translations.findByPoiIds([base.id]);
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    expect(row.description.toLowerCase()).toContain(dish);
    expect(row.description).not.toContain('ZXQFOOD');
    expect(row.descriptionSourceHash).toBe(verifiedHash(description));
  }
});

test('rejects a translation that drops the protected dish token without saving it', async () => {
  pois.create({ ...base, name: cases[0][0], description: cases[0][1] });
  provider.translate.mockResolvedValue({ text: 'The restaurant serves soup.' });
  await expect(service.translate(base.id, { targetLanguages: ['en'] })).rejects.toMatchObject({
    code: 'UNTRUSTED_TRANSLATION', translationLanguage: 'en', translationRule: 'protected_term_missing' });
  expect(await translations.findByPoiIds([base.id])).toHaveLength(0);
});

test.each([
  ['repeated', (token) => `${token} and ${token}`, 'protected_term_repeated'],
  ['unknown', (token) => `${token} and ZXQFOOD9ZXQ`, 'protected_term_corrupted'],
  ['fragment', (token) => `${token} and ZXQ`, 'protected_term_corrupted'],
  ['altered', () => 'ZXQFOOD0ZX and broth', 'protected_term_missing'],
])('does not persist a %s protected token', async (_case, output, reason) => {
  pois.create({ ...base, name: cases[0][0], description: cases[0][1] });
  provider.translate.mockImplementation(async (text) => ({
    text: output(text.match(/ZXQFOOD\d+ZXQ/)[0]) }));
  await expect(service.translate(base.id, { targetLanguages: ['en'] })).rejects.toMatchObject({
    code: 'UNTRUSTED_TRANSLATION', translationLanguage: 'en', translationRule: reason });
  expect(await translations.findByPoiIds([base.id])).toHaveLength(0);
});

test('an intact dish token cannot approve a mistranslated broth', async () => {
  pois.create({ ...base, name: cases[0][0], description: cases[0][1] });
  provider.translate.mockImplementation(async (text) => ({
    text: `The restaurant serves ${text.match(/ZXQFOOD\d+ZXQ/)[0]} with mixed water.` }));
  await expect(service.translate(base.id, { targetLanguages: ['en'] })).rejects.toMatchObject({
    code: 'UNTRUSTED_TRANSLATION', translationLanguage: 'en', translationRule: 'culinary_term_changed' });
  expect(await translations.findByPoiIds([base.id])).toHaveLength(0);
});

test('protects a full Vietnamese dish name in Japanese and Korean', async () => {
  const description = 'Hủ Tiếu là món ăn quen thuộc của miền Nam.';
  pois.create({ ...base, name: 'Hủ Tiếu', description });
  provider.translate.mockImplementation(async (text, _from, target) => {
    if (target === 'vi') return { text: description };
    const token = text.match(/ZXQFOOD\d+ZXQ/)?.[0];
    expect(token).toBeTruthy();
    return { text: target === 'ja' ? `この店は ${token} を提供します。`
      : `이 식당은 ${token}를 제공합니다.` };
  });
  await service.translate(base.id, { targetLanguages: ['ja', 'ko'] });
  const rows = await translations.findByPoiIds([base.id]);
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row.description).toContain('Hu Tieu');
    expect(row.descriptionSourceHash).toBe(verifiedHash(description));
  }
});

test('keeps the target-script check after restoring a protected dish name', async () => {
  const description = cases[0][1];
  pois.create({ ...base, name: cases[0][0], description });
  provider.translate.mockImplementation(async (text) => ({ text: `${text.match(/ZXQFOOD\d+ZXQ/)[0]} in English only.` }));
  await expect(service.translate(base.id, { targetLanguages: ['ja'] })).rejects.toMatchObject({
    code: 'UNTRUSTED_TRANSLATION', translationLanguage: 'ja', translationRule: 'wrong_language' });
  expect(await translations.findByPoiIds([base.id])).toHaveLength(0);
});

test('keeps numeric checks after restoring a protected dish name', async () => {
  const description = 'Quán phục vụ 40 tô bánh canh mỗi ngày.';
  pois.create({ ...base, name: cases[0][0], description });
  provider.translate.mockImplementation(async (text) => ({ text: `The restaurant serves 41 bowls of ${text.match(/ZXQFOOD\d+ZXQ/)[0]}.` }));
  await expect(service.translate(base.id, { targetLanguages: ['en'] })).rejects.toMatchObject({
    code: 'UNTRUSTED_TRANSLATION', translationLanguage: 'en', translationRule: 'numbers_changed' });
  expect(await translations.findByPoiIds([base.id])).toHaveLength(0);
});

test('an explicit retry rechecks an unverified description instead of treating its hash as ready', async () => {
  const description = cases[0][1];
  pois.create({ ...base, name: cases[0][0], description });
  let backTranslation = 'Không liên quan đến món ăn.';
  provider.translate.mockImplementation(async (text, _from, target) => {
    if (target === 'vi') return { text: backTranslation };
    return { text: `The restaurant serves ${text.match(/ZXQFOOD\d+ZXQ/)[0]} with crab broth.` };
  });
  await service.translate(base.id, { targetLanguages: ['en'] });
  expect((await translations.findByPoiIds([base.id]))[0].descriptionSourceHash).not.toBe(hash(description));
  backTranslation = description;
  provider.translate.mockClear();
  await service.translate(base.id, { targetLanguages: ['en'] });
  expect(provider.translate).toHaveBeenCalledTimes(2);
  expect((await translations.findByPoiIds([base.id]))[0].descriptionSourceHash).toBe(verifiedHash(description));
});

test('description-only retry preserves every other translation field and other POIs', async () => {
  const description = cases[0][1];
  pois.create({ ...base, name: cases[0][0], description });
  pois.create({ ...base, id: 'other-poi', name: 'Phở khác', description: 'Món phở khác.' });
  const before = { poiId: base.id, language: 'ja', name: 'Existing Name',
    address: 'Existing Address', description: 'Old description',
    nameSourceHash: 'old-name-hash', addressSourceHash: 'old-address-hash',
    descriptionSourceHash: null, nameManual: true, addressManual: true,
    descriptionManual: false, updatedAt: 'old-time' };
  const other = { ...before, poiId: 'other-poi', language: 'en' };
  await translations.save(before);
  await translations.save(other);
  provider.translate.mockImplementation(async (text, _from, target) => {
    if (target === 'vi') return { text: description };
    return { text: `この店は ${text.match(/ZXQFOOD\d+ZXQ/)[0]} を提供します。` };
  });
  await service.translate(base.id, { targetLanguages: ['ja'], descriptionOnly: true });
  const saved = (await translations.findByPoiIds([base.id]))[0];
  expect(saved).toMatchObject({ descriptionSourceHash: verifiedHash(description),
    name: before.name, address: before.address,
    nameSourceHash: before.nameSourceHash, addressSourceHash: before.addressSourceHash,
    nameManual: before.nameManual, addressManual: before.addressManual,
    descriptionManual: before.descriptionManual, updatedAt: before.updatedAt });
  expect(saved.description).toContain('banh canh');
  expect((await translations.findByPoiIds(['other-poi']))[0]).toEqual(other);
});

test('description-only retry does not overwrite a manual description', async () => {
  pois.create({ ...base, name: cases[0][0], description: cases[0][1] });
  const before = { poiId: base.id, language: 'en', description: 'Admin translation',
    descriptionSourceHash: null, descriptionManual: true };
  await translations.save(before);
  await expect(service.translate(base.id, { targetLanguages: ['en'], descriptionOnly: true }))
    .rejects.toMatchObject({ code: 'TRANSLATION_CONFLICT' });
  expect(provider.translate).not.toHaveBeenCalled();
  expect((await translations.findByPoiIds([base.id]))[0]).toEqual(before);
});

test('description-only retry fills NULL Description while keeping existing Name and Address', async () => {
  const description = cases[0][1];
  pois.create({ ...base, name: cases[0][0], description });
  await translations.save({ poiId: base.id, language: 'en', name: 'Existing Name',
    address: 'Existing Address', description: null, descriptionSourceHash: null,
    nameSourceHash: 'name-hash', addressSourceHash: 'address-hash',
    nameManual: true, addressManual: true, descriptionManual: false });
  provider.translate.mockImplementation(async (text, _from, target) => ({ text: target === 'vi'
    ? description : `The restaurant serves ${text.match(/ZXQFOOD\d+ZXQ/)[0]} with crab broth.` }));
  await service.translate(base.id, { targetLanguages: ['en'], descriptionOnly: true });
  expect((await translations.findByPoiIds([base.id]))[0]).toMatchObject({
    name: 'Existing Name', address: 'Existing Address', nameSourceHash: 'name-hash',
    addressSourceHash: 'address-hash', descriptionSourceHash: verifiedHash(description) });
});

test('normal retranslation after a Description edit writes only Description columns', async () => {
  const description = cases[0][1];
  pois.create({ ...base, name: cases[0][0], description });
  await translations.save({ poiId: base.id, language: 'en', name: 'Banh Canh Cua Sai Gon',
    address: '40 Tu Xuong', description: 'Old description',
    nameSourceHash: hash(base.name || cases[0][0]), addressSourceHash: hash(base.address),
    descriptionSourceHash: 'old-hash', nameManual: false, addressManual: false,
    descriptionManual: false });
  provider.translate.mockImplementation(async (text, _from, target) => ({ text: target === 'vi'
    ? description : `The restaurant serves ${text.match(/ZXQFOOD\d+ZXQ/)[0]} with crab broth.` }));
  const scoped = jest.spyOn(translations, 'saveDescription');
  const full = jest.spyOn(translations, 'save');
  try {
    await service.translate(base.id, { targetLanguages: ['en'] });
    expect(scoped).toHaveBeenCalledTimes(1);
    expect(full).not.toHaveBeenCalled();
    expect((await translations.findByPoiIds([base.id]))[0]).toMatchObject({
      name: 'Banh Canh Cua Sai Gon', address: '40 Tu Xuong',
      descriptionSourceHash: verifiedHash(description) });
  } finally { scoped.mockRestore(); full.mockRestore(); }
});
