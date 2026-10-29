/* Run only with DB_INTEGRATION=1 against a disposable database ending in Test. */
const crypto = require('crypto');
process.env.DB_INTEGRATION = '1';
const { getPool, closePool } = require('../src/database/connection');
const accounts = require('../src/repositories/account.repository');
const auth = require('../src/repositories/auth.repository');
const pois = require('../src/repositories/poi.repository');
const translationJobs = require('../src/repositories/poi-translation-job.repository');
const access = require('../src/repositories/access.repository');
const accessService = require('../src/services/access.service');
const { migrate } = require('../database/migrate');

const id = () => crypto.randomUUID();
const hash = () => crypto.randomBytes(32).toString('hex');
const now = () => new Date().toISOString();

beforeAll(async () => {
  if (!process.env.DB_NAME?.endsWith('Test')) throw new Error('Integration database name must end with Test');
  await migrate();
});
afterAll(async () => { await closePool(); });

test('migration removes only the two empty legacy tables', async () => {
  const result = await (await getPool()).request().query(`SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo') ORDER BY name`);
  const names = result.recordset.map((row) => row.name);
  expect(names).toEqual(['Accounts', 'AdminSessions', 'GuestSessions', 'LoginChallenges', 'POINarrations',
    'POIs', 'POITranslationJobs', 'POITranslations', 'SchemaMigrations', 'Vouchers']);
});

test('account, session, POI and multilingual audio metadata survive pool restart', async () => {
  const account = { id: id(), username: `test_${hash().slice(0, 20)}`, passwordHash: '$2b$12$abcdefghijklmnopqrstuu5dQLxvVdTZfxdZLzRqqxwPqDxhIGj9y',
    role: 'ADMIN', isLocked: false, version: 1, createdAt: now(), updatedAt: now() };
  const poi = { id: id(), name: "SQL test'); DELETE FROM dbo.POIs; --", description: 'Tiếng Việt', category: 'food',
    address: 'Hà Nội', streetAddress: 'Đường kiểm thử', ward: 'Phường kiểm thử', city: 'Hà Nội',
    latitude: 21.02, longitude: 105.85, geofenceRadius: 50, isActive: true,
    createdAt: now(), updatedAt: now() };
  const tokenHash = hash();
  try {
    await accounts.create(account);
    await auth.createSession({ tokenHash, userId: account.id, accountVersion: 1, csrfToken: hash(), expiresAt: Date.now() + 60000 });
    await pois.create(poi);
    await pois.update(poi.id, { narrations: { vi: { text: 'Xin chào', audioFile: 'demo.wav' }, ja: { text: 'こんにちは' }, ko: { text: '안녕하세요' }, en: { text: 'Hello' } }, updatedAt: now() });
    await closePool();
    expect((await accounts.findById(account.id)).username).toBe(account.username);
    expect((await auth.findSession(tokenHash)).userId).toBe(account.id);
    expect((await pois.findById(poi.id)).narrations).toEqual({
      vi: { text: 'Xin chào', audioFile: 'demo.wav' }, ja: { text: 'こんにちは' },
      ko: { text: '안녕하세요' }, en: { text: 'Hello' },
    });
    expect((await pois.findById(poi.id))).toMatchObject({ name: poi.name, streetAddress: poi.streetAddress,
      ward: poi.ward, city: poi.city, latitude: poi.latitude, longitude: poi.longitude });
    await expect(accounts.update(account.id, { isLocked: true })).rejects.toMatchObject({ statusCode: 409 });
  } finally {
    const pool = await getPool();
    await pool.request().input('id', poi.id).query('DELETE dbo.POIs WHERE Id=TRY_CONVERT(uniqueidentifier, @id)');
    await pool.request().input('id', account.id).query('DELETE dbo.AdminSessions WHERE AccountId=TRY_CONVERT(uniqueidentifier, @id)');
    await pool.request().input('id', account.id).query('DELETE dbo.Accounts WHERE Id=TRY_CONVERT(uniqueidentifier, @id)');
  }
});

test('POI translation queue survives pool restart and guards job revision', async () => {
  const poi = { id: id(), name: 'Bún bò', description: 'Món ăn', category: 'Món ăn',
    address: 'Huế', streetAddress: '', ward: '', city: 'Huế', latitude: 16.46, longitude: 107.59, geofenceRadius: 50,
    isActive: true, createdAt: now(), updatedAt: now() };
  try {
    await pois.create(poi);
    await translationJobs.enqueue(poi.id);
    await closePool();
    const claimed = await translationJobs.claim();
    expect(claimed).toMatchObject({ poiId: poi.id, attempts: 1 });
    await translationJobs.enqueue(poi.id);
    await translationJobs.complete(claimed);
    const replacement = await translationJobs.claim();
    expect(replacement).toMatchObject({ poiId: poi.id, revision: claimed.revision + 1, attempts: 1 });
    await translationJobs.fail(replacement, 'PROVIDER_UNAVAILABLE');
    const pool = await getPool();
    const state = (await pool.request().input('id', poi.id).query(`SELECT Status, Attempts, LastErrorCode
      FROM dbo.POITranslationJobs WHERE POIId=TRY_CONVERT(uniqueidentifier, @id)`)).recordset[0];
    expect(state).toMatchObject({ Status: 'pending', Attempts: 1, LastErrorCode: 'PROVIDER_UNAVAILABLE' });
  } finally {
    const pool = await getPool();
    await pool.request().input('id', poi.id).query('DELETE dbo.POIs WHERE Id=TRY_CONVERT(uniqueidentifier, @id)');
  }
});

test('voucher redemption is atomic and rollback leaves voucher unused', async () => {
  const voucher = { id: id(), codeHash: hash(), durationMinutes: 15, status: 'unused', createdAt: now(),
    redeemedAt: null, expiresAt: null, sessionId: null };
  await access.createVoucher(voucher);
  const makeSession = (v) => {
    const startedAt = now();
    const accessToken = hash();
    const tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
    return { accessToken, session: { id: id(), tokenHash, voucherId: v.id,
      durationMinutes: v.durationMinutes, startedAt, expiresAt: new Date(Date.now() + 900000).toISOString(), revokedAt: null } };
  };
  try {
    await expect(access.redeemOnce(voucher.codeHash, () => { throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect((await access.findAllVouchers()).find((v) => v.id === voucher.id).status).toBe('unused');
    const results = await Promise.all([access.redeemOnce(voucher.codeHash, makeSession), access.redeemOnce(voucher.codeHash, makeSession)]);
    expect(results.filter((r) => r.session)).toHaveLength(1);
    expect(results.filter((r) => r.failure === 'used')).toHaveLength(1);
    await closePool();
    expect((await access.findAllVouchers()).find((v) => v.id === voucher.id).status).toBe('redeemed');
    const guest = await access.findSession(results.find((r) => r.session).session.tokenHash);
    expect(guest.voucherId).toBe(voucher.id);
    const accessToken = results.find((r) => r.session).accessToken;
    expect((await accessService.validateAuthorization(`Bearer ${accessToken}`)).id).toBe(guest.id);
    const pool = await getPool();
    await pool.request().input('id', guest.id).query('UPDATE dbo.GuestSessions SET ExpiresAt=DATEADD(second,-1,SYSUTCDATETIME()) WHERE Id=TRY_CONVERT(uniqueidentifier, @id)');
    await expect(accessService.validateAuthorization(`Bearer ${accessToken}`)).rejects.toMatchObject({ code: 'ACCESS_EXPIRED' });
  } finally {
    const pool = await getPool();
    await pool.request().input('id', voucher.id).query('UPDATE dbo.Vouchers SET SessionId=NULL WHERE Id=TRY_CONVERT(uniqueidentifier, @id)');
    await pool.request().input('id', voucher.id).query('DELETE dbo.GuestSessions WHERE VoucherId=TRY_CONVERT(uniqueidentifier, @id)');
    await pool.request().input('id', voucher.id).query('DELETE dbo.Vouchers WHERE Id=TRY_CONVERT(uniqueidentifier, @id)');
  }
});

test('POI cũ chỉ có Address và tọa độ vẫn đọc/sửa được sau migration 002', async () => {
  const poiId = id();
  const pool = await getPool();
  try {
    await pool.request().input('id', poiId).query(`INSERT dbo.POIs
      (Id, Name, Description, Category, Address, Latitude, Longitude, GeofenceRadius, IsActive)
      VALUES (TRY_CONVERT(uniqueidentifier, @id), N'POI cũ', N'Mô tả', N'food', N'Địa chỉ cũ', 10, 106, 50, 1)`);
    expect(await pois.findById(poiId)).toMatchObject({ address: 'Địa chỉ cũ', streetAddress: null,
      ward: null, city: null, latitude: 10, longitude: 106 });
    await pois.update(poiId, { name: 'POI đã sửa', updatedAt: now() });
    expect(await pois.findById(poiId)).toMatchObject({ name: 'POI đã sửa', address: 'Địa chỉ cũ',
      streetAddress: null, ward: null, city: null, latitude: 10, longitude: 106 });
  } finally {
    await pool.request().input('id', poiId).query('DELETE dbo.POIs WHERE Id=TRY_CONVERT(uniqueidentifier, @id)');
  }
});
