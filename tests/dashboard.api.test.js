const crypto = require('crypto');
const supertest = require('supertest');
const app = require('../src/app');
const adminRequest = require('./helpers/auth-request');
const { login } = require('./helpers/auth-session');
const pois = require('../src/repositories/poi.repository');
const vouchers = require('../src/repositories/access.repository');
const accounts = require('../src/repositories/account.repository');

const createVoucher = (status = 'unused', startedAt = null, expiresAt = null, createdAt = new Date().toISOString()) => {
  const id = crypto.randomUUID();
  const codeHash = crypto.randomBytes(32).toString('hex');
  vouchers.createVoucher({ id, codeHash, shortCodeHash: crypto.randomBytes(32).toString('hex'),
    durationMinutes: 60, status: 'unused', createdAt,
    redeemedAt: null, expiresAt: null, sessionId: null });
  if (status === 'redeemed') vouchers.redeemOnce(codeHash, () => ({
    accessToken: 'test-token',
    session: { id: crypto.randomUUID(), tokenHash: crypto.randomBytes(32).toString('hex'), voucherId: id,
      durationMinutes: 60, startedAt, expiresAt, revokedAt: null },
  }));
  return id;
};

beforeEach(() => { pois.clear(); vouchers.clear(); });

test('Dashboard tổng hợp đúng POI, voucher và 2 phiên gần đây mà không lộ bí mật', async () => {
  pois.create({ id: 'poi-1', isActive: true });
  pois.create({ id: 'poi-2', isActive: false });
  createVoucher();
  const now = Date.now();
  const expiredId = createVoucher('redeemed', new Date(now - 7200000).toISOString(), new Date(now - 3600000).toISOString());
  const activeId = createVoucher('redeemed', new Date(now - 60000).toISOString(), new Date(now + 3600000).toISOString());
  const res = await adminRequest(app).get('/api/admin/dashboard').expect(200).expect('Cache-Control', 'no-store');
  expect(res.body.poi).toEqual({ total: 2, active: 1 });
  expect(res.body.vouchers).toEqual({ total: 3, unused: 1, active: 1, expired: 1 });
  expect(res.body.accounts.total).toBe(accounts.findAll().length);
  expect(res.body.recentActivations.map((item) => item.voucherId)).toEqual([activeId, expiredId]);
  expect(res.body.recentActivations.map((item) => item.status)).toEqual(['active', 'expired']);
  expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|codeHash|shortCodeHash|accessToken|activationCode|passwordHash/);
});

test('voucher chưa kích hoạt vẫn là unused dù đã tạo từ lâu; danh sách rỗng trả số 0 thật', async () => {
  const empty = await adminRequest(app).get('/api/admin/dashboard').expect(200);
  expect(empty.body.vouchers).toEqual({ total: 0, unused: 0, active: 0, expired: 0 });
  expect(empty.body.recentActivations).toEqual([]);
  createVoucher('unused', null, null, new Date(2000, 0, 1).toISOString());
  // Status is determined by redemption, not the age of the unused voucher.
  const res = await adminRequest(app).get('/api/admin/dashboard').expect(200);
  expect(res.body.vouchers).toEqual({ total: 1, unused: 1, active: 0, expired: 0 });
});

test('Dashboard chỉ dành cho ADMIN, không có phiên trả 401 và POI_MANAGER trả 403', async () => {
  await supertest(app).get('/api/admin/dashboard').expect(401);
  const fixture = adminRequest.fixture();
  const admin = accounts.findById(fixture.user.id);
  accounts.create({ ...admin, id: crypto.randomUUID(), username: 'dashboard_manager', role: 'POI_MANAGER' });
  const manager = await login(app, 'dashboard_manager', fixture.password);
  expect(manager.response.status).toBe(200);
  await supertest(app).get('/api/admin/dashboard').set('Cookie', manager.cookie).expect(403);
});
