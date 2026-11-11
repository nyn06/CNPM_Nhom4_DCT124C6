/* Run only with DB_INTEGRATION=1 against AutoNarrationDBTest. */
const crypto = require('crypto');
require('dotenv').config();
process.env.DB_INTEGRATION = '1';
const { sql, getPool, closePool } = require('../src/database/connection');
const request = require('supertest');
const app = require('../src/app');
const accounts = require('../src/repositories/account.repository');
const auth = require('../src/repositories/auth.repository');
const pois = require('../src/repositories/poi.repository');
const translationJobs = require('../src/repositories/poi-translation-job.repository');
const access = require('../src/repositories/access.repository');
const accessService = require('../src/services/access.service');
const purchase = require('../src/repositories/purchase.repository');

const id = () => crypto.randomUUID();
const hash = () => crypto.randomBytes(32).toString('hex');
const now = () => new Date().toISOString();

beforeAll(async () => {
  if (process.env.DB_NAME !== 'AutoNarrationDBTest') throw new Error('Integration target must be AutoNarrationDBTest');
  const db = await (await getPool()).request().query('SELECT DB_NAME() AS name');
  if (db.recordset[0].name !== 'AutoNarrationDBTest') throw new Error('Integration connection target mismatch');
  const state = await (await getPool()).request().query(`SELECT
    (SELECT COUNT(*) FROM dbo.SchemaMigrations WHERE Version = '007_voucher_purchases.sql') AS migrationCount,
    OBJECT_ID('dbo.VoucherPayments', 'U') AS paymentsTable,
    (SELECT state_desc FROM sys.databases WHERE name='AutoNarrationDB') AS mainState,
    (SELECT state_desc FROM sys.databases WHERE name='AutoNarrationDBTest') AS testState,
    (SELECT COUNT(*) FROM dbo.Vouchers) AS vouchers,
    (SELECT COUNT(*) FROM dbo.GuestSessions) AS sessions,
    (SELECT COUNT(*) FROM dbo.VoucherPayments) AS payments`);
  const status = state.recordset[0];
  if (status.migrationCount !== 1 || !status.paymentsTable || status.mainState !== 'ONLINE'
    || status.testState !== 'ONLINE' || status.vouchers !== 59 || status.sessions !== 44 || status.payments !== 0)
    throw new Error('SQL integration baseline does not match the approved AutoNarrationDBTest snapshot');
  if (process.env.DEMO_PAYMENT_ENABLED !== 'true')
    throw new Error('SQL integration demo payment requires DEMO_PAYMENT_ENABLED=true');
});
afterAll(async () => { await closePool(); });

async function newPaymentVoucher() {
  const code = hash();
  const voucher = { id: id(), codeHash: crypto.createHash('sha256').update(code).digest('hex'),
    shortCodeHash: hash(), durationMinutes: null, status: 'unused', createdAt: now(),
    redeemedAt: null, expiresAt: null, sessionId: null };
  await access.createVoucher(voucher);
  return { code, voucher };
}

async function cleanupPaymentVoucher(voucher) {
  const tx = new sql.Transaction(await getPool());
  await tx.begin();
  try {
    const result = await new sql.Request(tx).input('id', sql.UniqueIdentifier, voucher.id)
      .query('SELECT CodeHash FROM dbo.Vouchers WITH (UPDLOCK) WHERE Id=@id');
    if (result.recordset.length !== 1 || result.recordset[0].CodeHash !== voucher.codeHash)
      throw new Error(`Refusing cleanup for voucher ${voucher.id}: fixture identity mismatch`);
    const input = () => new sql.Request(tx).input('id', sql.UniqueIdentifier, voucher.id);
    await input().query('UPDATE dbo.Vouchers SET SessionId=NULL WHERE Id=@id');
    await input().query('DELETE dbo.GuestSessions WHERE VoucherId=@id');
    await input().query('DELETE dbo.VoucherPayments WHERE VoucherId=@id');
    await input().query('DELETE dbo.Vouchers WHERE Id=@id');
    await tx.commit();
  } catch (error) {
    try { await tx.rollback(); } catch { /* Report the original cleanup error. */ }
    console.error(`SQL fixture cleanup failed for voucher ${voucher.id}`);
    throw error;
  }
}

const postAccess = (route, body) => request(app).post(`/api/access/${route}`).send(body);
const fixtureCount = async (table, voucherId) => {
  const allowed = { GuestSessions: 'dbo.GuestSessions', VoucherPayments: 'dbo.VoucherPayments' };
  const result = await (await getPool()).request().input('id', sql.UniqueIdentifier, voucherId)
    .query(`SELECT COUNT(*) AS total FROM ${allowed[table]} WHERE VoucherId=@id`);
  return result.recordset[0].total;
};

test.each([15, 30, 60])('SQL purchase API covers %i minutes, price, activation and reuse', async (minutes) => {
  const { code, voucher } = await newPaymentVoucher();
  try {
    expect((await postAccess('inspect', { code })).body).toMatchObject({ status: 'unselected', legacy: false });
    expect((await postAccess('redeem', { code })).status).toBe(409);
    expect((await postAccess('start', { code })).status).toBe(409);
    const chosen = await postAccess('choose', { code, durationMinutes: minutes, amountVnd: 1 });
    expect(chosen.status).toBe(200);
    expect(chosen.body.payment).toMatchObject({ durationMinutes: minutes, amountVnd: minutes * 1000, status: 'pending' });
    expect(await fixtureCount('VoucherPayments', voucher.id)).toBe(1);
    expect(await fixtureCount('GuestSessions', voucher.id)).toBe(0);
    expect((await postAccess('start', { code })).status).toBe(409);
    const paid = await postAccess('demo-pay', { code });
    expect(paid.status).toBe(200);
    expect(paid.body.payment).toMatchObject({ status: 'paid', startedAt: null });
    expect(await fixtureCount('GuestSessions', voucher.id)).toBe(0);
    expect((await postAccess('inspect', { code })).body.payment.status).toBe('paid');
    const started = await postAccess('start', { code });
    expect(started.status).toBe(200);
    expect(Date.parse(started.body.expiresAt) - Date.parse(started.body.startedAt)).toBe(minutes * 60000);
    expect(await fixtureCount('GuestSessions', voucher.id)).toBe(1);
    expect((await postAccess('start', { code })).status).toBe(409);
    expect((await postAccess('choose', { code, durationMinutes: 15 })).status).toBe(409);
    expect((await postAccess('demo-pay', { code })).status).toBe(409);
    expect((await postAccess('redeem', { code })).status).toBe(409);
  } finally { await cleanupPaymentVoucher(voucher); }
});

test('concurrent SQL payment and Start create one payment and one GuestSession', async () => {
  const { code, voucher } = await newPaymentVoucher();
  try {
    expect((await postAccess('choose', { code, durationMinutes: 30 })).status).toBe(200);
    const pays = await Promise.all([postAccess('demo-pay', { code }), postAccess('demo-pay', { code })]);
    expect(pays.map((response) => response.status)).toEqual([200, 200]);
    expect(await fixtureCount('VoucherPayments', voucher.id)).toBe(1);
    const starts = await Promise.all([postAccess('start', { code }), postAccess('start', { code })]);
    expect(starts.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await fixtureCount('GuestSessions', voucher.id)).toBe(1);
  } finally { await cleanupPaymentVoucher(voucher); }
});

test('SQL Start rolls back on insert error and production blocks demo payment', async () => {
  const { code, voucher } = await newPaymentVoucher();
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    expect((await postAccess('choose', { code, durationMinutes: 15 })).status).toBe(200);
    process.env.NODE_ENV = 'production';
    expect((await postAccess('demo-pay', { code })).status).toBe(403);
    expect((await postAccess('inspect', { code })).body.payment.status).toBe('pending');
    expect(await fixtureCount('GuestSessions', voucher.id)).toBe(0);
    process.env.NODE_ENV = previousNodeEnv;
    expect((await postAccess('demo-pay', { code })).status).toBe(200);
    const invalidSession = (v, payment) => ({ accessToken: hash(), session: {
      id: id(), tokenHash: hash(), voucherId: v.id, durationMinutes: 999,
      startedAt: now(), expiresAt: new Date(Date.now() + payment.durationMinutes * 60000).toISOString(), revokedAt: null,
    } });
    await expect(purchase.start(voucher.codeHash, invalidSession)).rejects.toThrow();
    expect(await fixtureCount('GuestSessions', voucher.id)).toBe(0);
    expect((await postAccess('inspect', { code })).body.payment).toMatchObject({ status: 'paid', startedAt: null });
    expect((await postAccess('start', { code })).status).toBe(200);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    await cleanupPaymentVoucher(voucher);
  }
});

test('migration removes only the two empty legacy tables', async () => {
  const result = await (await getPool()).request().query(`SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo') ORDER BY name`);
  const names = result.recordset.map((row) => row.name);
  expect(names).toEqual(['Accounts', 'AdminSessions', 'GuestSessions', 'LoginChallenges', 'POINarrations',
    'POIs', 'POITranslationJobs', 'POITranslations', 'SchemaMigrations', 'VoucherPayments', 'Vouchers']);
});

test('new voucher payment and concurrent start stay atomic in SQL Server', async () => {
  const voucher = { id: id(), codeHash: hash(), shortCodeHash: hash(), durationMinutes: null,
    status: 'unused', createdAt: now(), redeemedAt: null, expiresAt: null, sessionId: null };
  await access.createVoucher(voucher);
  try {
    expect((await access.redeemOnce(voucher.codeHash, () => { throw new Error('Must not redeem'); })).failure).toBe('payment');
    const selected = await purchase.choose(voucher.codeHash, { id: id(), durationMinutes: 30,
      amountVnd: 30000, status: 'pending', createdAt: now() });
    expect(selected.payment.amountVnd).toBe(30000);
    expect((await purchase.start(voucher.codeHash, () => { throw new Error('Must not start'); })).failure).toBe('unpaid');
    await purchase.pay(voucher.codeHash, now());
    await expect(purchase.start(voucher.codeHash, () => { throw new Error('Injected failure'); }))
      .rejects.toThrow('Injected failure');
    expect((await purchase.inspect(voucher.codeHash)).payment).toMatchObject({ status: 'paid', startedAt: null });
    const issue = (v, payment) => {
      const accessToken = hash();
      const startedAt = now();
      return { accessToken, session: { id: id(), tokenHash: hash(), voucherId: v.id,
        durationMinutes: payment.durationMinutes, startedAt,
        expiresAt: new Date(Date.parse(startedAt) + payment.durationMinutes * 60000).toISOString(), revokedAt: null } };
    };
    const results = await Promise.all([purchase.start(voucher.codeHash, issue), purchase.start(voucher.codeHash, issue)]);
    expect(results.filter((result) => result.session)).toHaveLength(1);
    expect(results.filter((result) => result.failure === 'used')).toHaveLength(1);
    const state = await purchase.inspect(voucher.codeHash);
    expect(state.payment.startedAt).toBe(results.find((result) => result.session).session.startedAt);
  } finally {
    const pool = await getPool();
    await pool.request().input('id', voucher.id).query('UPDATE dbo.Vouchers SET SessionId=NULL WHERE Id=TRY_CONVERT(uniqueidentifier, @id)');
    await pool.request().input('id', voucher.id).query('DELETE dbo.GuestSessions WHERE VoucherId=TRY_CONVERT(uniqueidentifier, @id)');
    await pool.request().input('id', voucher.id).query('DELETE dbo.VoucherPayments WHERE VoucherId=TRY_CONVERT(uniqueidentifier, @id)');
    await pool.request().input('id', voucher.id).query('DELETE dbo.Vouchers WHERE Id=TRY_CONVERT(uniqueidentifier, @id)');
  }
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
    await expect(accounts.update(account.id, { isLocked: true }, 0)).rejects.toMatchObject({ statusCode: 409 });
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
