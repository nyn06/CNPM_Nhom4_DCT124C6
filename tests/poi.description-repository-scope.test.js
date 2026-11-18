jest.mock('../src/database/repository', () => ({
  sql: { UniqueIdentifier: 'uuid', Int: 'int', VarChar: jest.fn((length) => `varchar(${length})`),
    NVarChar: Object.assign(jest.fn((length) => `nvarchar(${length})`), { MAX: 'max' }),
    ISOLATION_LEVEL: { SERIALIZABLE: 'serializable' },
    Transaction: jest.fn(), Request: jest.fn() },
  getPool: jest.fn(),
}));

const { getPool, sql: sqlDriver } = require('../src/database/repository');
const repository = require('../src/repositories/sql/poi-translation.repository');
const jobs = require('../src/repositories/sql/poi-translation-job.repository');

test('SQL job completion and failure are fenced by claim attempt', async () => {
  const request = { input: jest.fn().mockReturnThis(),
    query: jest.fn().mockResolvedValue({ rowsAffected: [1] }) };
  getPool.mockResolvedValue({ request: () => request });
  const claim = { poiId: 'one-poi', revision: 3, attempts: 2 };
  await jobs.complete(claim);
  await jobs.fail(claim, 'PROVIDER_NETWORK');
  expect(request.query).toHaveBeenCalledTimes(2);
  for (const [query] of request.query.mock.calls)
    expect(query).toMatch(/Revision=@revision AND Attempts=@attempts AND Status='processing'/);
  expect(request.input.mock.calls.filter(([name]) => name === 'attempts'))
    .toEqual([['attempts', sqlDriver.Int, 2], ['attempts', sqlDriver.Int, 2]]);
});

test('description-only SQL write targets one row and only two description columns', async () => {
  const request = { input: jest.fn().mockReturnThis(),
    query: jest.fn().mockResolvedValue({ rowsAffected: [1] }) };
  getPool.mockResolvedValue({ request: () => request });
  await repository.saveDescription({ poiId: 'one-poi', language: 'ja',
    description: 'New description', descriptionSourceHash: 'new-hash' },
  { description: 'Old description', descriptionSourceHash: null });
  const sql = request.query.mock.calls[0][0];
  expect(sql).toMatch(/UPDATE dbo\.POITranslations SET Description=@description,\s*DescriptionSourceHash=@sourceHash/);
  expect(sql).toMatch(/WHERE POIId=@poiId AND Language=@language/);
  expect(sql).toMatch(/DescriptionManual=0/);
  expect(sql).not.toMatch(/SET[^]*\b(?:Name|Address|UpdatedAt)=@/);
  expect(request.input.mock.calls).toContainEqual(['poiId', 'uuid', 'one-poi']);
  expect(request.input.mock.calls).toContainEqual(['language', 'varchar(2)', 'ja']);
});

test('description-only SQL write rejects a changed row', async () => {
  const request = { input: jest.fn().mockReturnThis(),
    query: jest.fn().mockResolvedValue({ rowsAffected: [0] }) };
  getPool.mockResolvedValue({ request: () => request });
  await expect(repository.saveDescription({ poiId: 'one-poi', language: 'ja',
    description: 'New description', descriptionSourceHash: 'new-hash' },
  { description: 'Old description', descriptionSourceHash: null }))
    .rejects.toMatchObject({ code: 'TRANSLATION_CONFLICT', statusCode: 409 });
});

test('an existing row with NULL Description can be filled without touching Name or Address', async () => {
  const request = { input: jest.fn().mockReturnThis(),
    query: jest.fn().mockResolvedValue({ rowsAffected: [1] }) };
  getPool.mockResolvedValue({ request: () => request });
  await repository.saveDescription({ poiId: 'one-poi', language: 'en',
    description: 'New description', descriptionSourceHash: 'new-hash' },
  { description: null, descriptionSourceHash: null });
  const sql = request.query.mock.calls[0][0];
  expect(sql).toMatch(/Description IS NULL AND @previousDescription IS NULL/);
  expect(sql).not.toMatch(/SET[^]*\b(?:Name|Address)=@/);
});

test('missing language inserts only Description and its source hash', async () => {
  const tx = { begin: jest.fn(), commit: jest.fn(), rollback: jest.fn() };
  sqlDriver.Transaction.mockImplementation(() => tx);
  const request = { input: jest.fn().mockReturnThis(), query: jest.fn()
    .mockResolvedValueOnce({ recordset: [] }).mockResolvedValueOnce({ rowsAffected: [1] }) };
  sqlDriver.Request.mockImplementation(() => request);
  getPool.mockResolvedValue({});
  await repository.saveDescription({ poiId: 'one-poi', language: 'ja',
    description: 'New description', descriptionSourceHash: 'new-hash' });
  expect(tx.begin).toHaveBeenCalledWith('serializable');
  expect(tx.commit).toHaveBeenCalledTimes(1);
  expect(request.query).toHaveBeenCalledTimes(2);
  const insert = request.query.mock.calls[1][0];
  expect(insert).toMatch(/INSERT dbo\.POITranslations\s*\(POIId, Language, Description, DescriptionSourceHash\)/);
  expect(insert).not.toMatch(/\b(?:Name|Address|NameSourceHash|AddressSourceHash)\b/);
});
