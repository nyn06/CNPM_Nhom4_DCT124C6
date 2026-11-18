const pipeline = require('../src/services/poi-description-pipeline');
const quality = require('../src/services/poi-description-quality');

const name = 'Bánh Canh Cua Sài Gòn';
const source = 'Quán bánh canh với sợi bánh mềm dai, nước dùng sánh và hương vị cua.';

test('EN protects the longest culinary phrase before the shorter broth rule', () => {
  const prepared = pipeline.prepare(`${source} Nước dùng cua cũng được phục vụ.`, name, 'en');
  expect(prepared.providerSource).toContain('ZXQTERM0ZXQ');
  expect(prepared.providerSource).toContain('broth cua');
  expect(prepared.providerSource).not.toContain('broth sánh');
  expect(prepared.protectedTerms).toEqual([{ token: 'ZXQTERM0ZXQ', value: 'thick broth' }]);
  expect(prepared.protectedDish).toMatchObject({ token: 'ZXQFOOD0ZXQ', name: 'banh canh' });
  expect(prepared.originalSource).toBe(`${source} Nước dùng cua cũng được phục vụ.`);
});

test('each occurrence receives its own token and is restored exactly once', () => {
  const prepared = pipeline.prepare('Nước dùng sánh và nước dùng sánh.', name, 'en');
  expect(prepared.protectedTerms).toEqual([
    { token: 'ZXQTERM0ZXQ', value: 'thick broth' },
    { token: 'ZXQTERM1ZXQ', value: 'thick broth' },
  ]);
  expect(pipeline.restore('ZXQTERM0ZXQ and ZXQTERM1ZXQ.', prepared))
    .toEqual({ text: 'thick broth and thick broth.', reason: null, stage: null });
});

test.each([
  ['missing', 'The ZXQFOOD0ZXQ restaurant serves broth.', 'protected_term_missing'],
  ['repeated', 'ZXQFOOD0ZXQ with ZXQTERM0ZXQ and ZXQTERM0ZXQ.', 'protected_term_repeated'],
  ['unknown', 'ZXQFOOD0ZXQ with ZXQTERM0ZXQ and ZXQTERM9ZXQ.', 'protected_term_corrupted'],
  ['fragment', 'ZXQFOOD0ZXQ with ZXQTERM0ZXQ and ZXQTERM.', 'protected_term_corrupted'],
  ['altered', 'ZXQFOOD0ZXQ with ZXQTERM0ZX.', 'protected_term_missing'],
])('rejects a %s glossary token', (_case, output, reason) => {
  expect(pipeline.restore(output, pipeline.prepare(source, name, 'en')))
    .toMatchObject({ text: null, reason, stage: 'token' });
});

test('restored thick broth passes the unchanged display rule, rich broth fails', () => {
  const prepared = pipeline.prepare(source, name, 'en');
  const translated = pipeline.restore('The ZXQFOOD0ZXQ restaurant serves soft, chewy noodles '
    + 'with ZXQTERM0ZXQ and crab flavor.', prepared);
  expect(translated.reason).toBeNull();
  expect(quality.assessDisplay(source, translated.text, 'en', name))
    .toEqual({ allowed: true });
  expect(quality.assessDisplay(source,
    'The banh canh restaurant serves soft, chewy noodles with rich broth and crab flavor.',
    'en', name)).toMatchObject({ allowed: false, reason: 'required_fact_missing' });
  expect(quality.assess(source, translated.text, 'en', null, name))
    .toMatchObject({ status: 'unverified', reason: 'insufficient_semantic_evidence' });
});

test('JA and KO input remains untouched by the EN glossary', () => {
  for (const language of ['ja', 'ko']) {
    const prepared = pipeline.prepare(source, name, language);
    expect(prepared.providerSource).toContain('nước dùng sánh');
    expect(prepared.providerSource).not.toContain('ZXQTERM');
    expect(prepared.protectedTerms).toEqual([]);
  }
  expect(quality.assessDisplay(source,
    'banh canhというお店は、柔らかくてコシのある麺、とろみのあるスープ、そしてカニの風味が特徴です。',
    'ja', name)).toEqual({ allowed: true });
  expect(quality.assessDisplay(source,
    'banh canh 식당은 쫄깃하고 부드러운 면과 걸쭉한 국물, 게의 풍미가 특징입니다.',
    'ko', name)).toEqual({ allowed: true });
});
