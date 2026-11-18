jest.mock('../src/integrations/translation/translation.provider', () => ({ translate: jest.fn() }));

const pois = require('../src/repositories/poi.repository');
const rows = require('../src/repositories/poi-translation.repository');
const service = require('../src/services/poi-translation.service');
const provider = require('../src/integrations/translation/translation.provider');
const { hash, unverifiedHash, displayableUnverifiedHash } = require('../src/services/poi-description-hash');
const reviewTool = require('../scripts/review-poi-description-quality');

const id = '904e5832-5d53-4bb2-8337-ccab5fab7f2d';
const poi = { id, name: 'Bánh Canh Cua Sài Gòn',
  description: 'Quán phục vụ bánh canh với nước dùng cua.', address: '40 Tú Xương' };

beforeEach(() => { pois.clear(); rows.clear(); provider.translate.mockReset(); pois.create(poi); });

test('dry run reads one POI and language without calling provider or translating', async () => {
  await rows.save({ poiId: id, language: 'en', description: 'The restaurant serves banh canh with crab broth.',
    descriptionSourceHash: unverifiedHash(poi.description), descriptionManual: false });
  const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const translate = jest.spyOn(service, 'translate');
  try {
    await reviewTool.main([`--id=${id}`, '--lang=en', '--field=description']);
    const plan = JSON.parse(output.mock.calls[0][0]);
    expect(plan).toMatchObject({ mode: 'dry-run', field: 'description', record: {
      poiId: id, language: 'en', status: 'unverified', sourceHash: hash(poi.description),
      savedSourceHash: unverifiedHash(poi.description),
      writeColumns: ['Description', 'DescriptionSourceHash'] } });
    expect(provider.translate).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
  } finally { output.mockRestore(); translate.mockRestore(); }
});

test('a current safe displayable unverified result is idempotent and needs no retry', () => {
  const row = { description: 'The restaurant serves banh canh with crab broth.',
    descriptionSourceHash: displayableUnverifiedHash(poi.description), descriptionManual: false };
  expect(reviewTool.review(poi, row, 'en')).toMatchObject({ status: 'unverified',
    action: 'none', writeColumns: [] });
});

test('hash invalidation preview lists only DescriptionSourceHash and makes no API call', async () => {
  await rows.save({ poiId: id, language: 'en', description: 'The restaurant serves banh canh with water.',
    descriptionSourceHash: unverifiedHash(poi.description), descriptionManual: false });
  const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await reviewTool.main([`--id=${id}`, '--lang=en']);
    expect(JSON.parse(output.mock.calls[0][0]).record).toMatchObject({
      status: 'rejected', action: 'invalidate_hash', writeColumns: ['DescriptionSourceHash'] });
    expect(provider.translate).not.toHaveBeenCalled();
  } finally { output.mockRestore(); }
});

test('retry scope requires one POI, one language, Description field and a matching plan', async () => {
  expect(() => reviewTool.parseScope([`--id=${id}`, '--lang=en', '--lang=ja']))
    .toThrow('Use exactly one');
  expect(() => reviewTool.parseScope([`--id=${id}`, '--lang=en', '--retry=plan']))
    .toThrow('Retry requires');
  const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const translate = jest.spyOn(service, 'translate').mockResolvedValue({});
  try {
    await reviewTool.main([`--id=${id}`, '--lang=ja', '--field=description']);
    const plan = JSON.parse(output.mock.calls[0][0]);
    expect(plan.record).toMatchObject({ status: 'missing', action: 'retry_description',
      savedSourceHash: null, savedDescriptionHash: null });
    output.mockClear();
    await reviewTool.main([`--id=${id}`, '--lang=ja', '--field=description', `--retry=${plan.plan}`]);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledWith(id, { targetLanguages: ['ja'], descriptionOnly: true });
    pois.update(id, { description: `${poi.description} Mới.` });
    translate.mockClear();
    await expect(reviewTool.main([`--id=${id}`, '--lang=ja', '--field=description',
      `--retry=${plan.plan}`])).rejects.toThrow('plan changed');
    expect(translate).not.toHaveBeenCalled();
  } finally { output.mockRestore(); translate.mockRestore(); }
});
