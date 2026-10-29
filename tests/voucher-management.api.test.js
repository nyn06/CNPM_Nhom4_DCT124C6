const crypto = require('crypto');
const supertest = require('supertest');
const app = require('../src/app');
const adminRequest = require('./helpers/auth-request');
const { login } = require('./helpers/auth-session');
const access = require('../src/repositories/access.repository');
const accounts = require('../src/repositories/account.repository');

function voucher(createdAt, startedAt = null, expiresAt = null) {
  const id = crypto.randomUUID();
  const codeHash = crypto.randomBytes(32).toString('hex');
  access.createVoucher({ id, codeHash, shortCodeHash: crypto.randomBytes(32).toString('hex'),
    durationMinutes: 60, status: 'unused', createdAt, redeemedAt: null, expiresAt: null, sessionId: null });
  let sessionId = null;
  if (startedAt) {
    sessionId = crypto.randomUUID();
    access.redeemOnce(codeHash, () => ({ accessToken: 'secret-token', session: {
      id: sessionId, tokenHash: crypto.randomBytes(32).toString('hex'), voucherId: id,
      durationMinutes: 60, startedAt, expiresAt, revokedAt: null,
    } }));
  }
  return { id, sessionId };
}

beforeEach(() => access.clear());

test('overview phân trang và thống kê nhất quán với Dashboard, không trả bí mật', async () => {
  const now = Date.now();
  for (let i = 0; i < 12; i++) voucher(new Date(now - i * 1000).toISOString());
  const active = voucher(new Date(now - 20000).toISOString(), new Date(now - 1000).toISOString(), new Date(now + 60000).toISOString());
  voucher(new Date(now - 30000).toISOString(), new Date(now - 7200000).toISOString(), new Date(now - 3600000).toISOString());
  const first = await adminRequest(app).get('/api/access/vouchers/overview?page=1').expect(200);
  const second = await adminRequest(app).get('/api/access/vouchers/overview?page=2').expect(200);
  const dashboard = await adminRequest(app).get('/api/admin/dashboard').expect(200);
  expect(first.body.stats).toEqual({ total: 14, unused: 12, active: 1, expired: 1 });
  expect(first.body.stats).toEqual(dashboard.body.vouchers);
  expect(first.body.items).toHaveLength(10);
  expect(second.body.items).toHaveLength(4);
  expect(first.body.items[0].createdAt >= first.body.items[1].createdAt).toBe(true);
  expect(first.body.items[0].id).not.toBe(active.id);
  expect(JSON.stringify(first.body)).not.toMatch(/codeHash|shortCodeHash|activationCode|tokenHash|accessToken|secret-token/);
  expect(first.headers['cache-control']).toBe('no-store');
  const filtered = await adminRequest(app).get(`/api/access/vouchers/overview?status=active&search=${active.id.slice(0, 8)}`).expect(200);
  expect(filtered.body.items.map((item) => item.id)).toEqual([active.id]);
});

test('lịch sử sắp xếp theo kích hoạt, lọc và tìm mã phiên/vé, không trả token', async () => {
  const now = Date.now();
  const older = voucher(new Date(now - 100000).toISOString(), new Date(now - 7200000).toISOString(), new Date(now - 3600000).toISOString());
  const newer = voucher(new Date(now - 200000).toISOString(), new Date(now - 1000).toISOString(), new Date(now + 60000).toISOString());
  const res = await adminRequest(app).get('/api/access/vouchers/activations').expect(200);
  expect(res.body.items.map((item) => item.voucherId)).toEqual([newer.id, older.id]);
  expect(res.body.items.map((item) => item.status)).toEqual(['active', 'expired']);
  expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|accessToken|codeHash|activationCode|secret-token/);
  const search = await adminRequest(app).get(`/api/access/vouchers/activations?status=active&search=${newer.sessionId.slice(0, 8)}`).expect(200);
  expect(search.body.items.map((item) => item.id)).toEqual([newer.sessionId]);
  const empty = await adminRequest(app).get('/api/access/vouchers/activations?status=revoked').expect(200);
  expect(empty.body).toMatchObject({ total: 0, totalPages: 0, items: [] });
});

test('lịch sử phân trang 10 bản ghi và giới hạn bộ lọc', async () => {
  const now = Date.now();
  for (let i = 0; i < 12; i++) voucher(new Date(now - i * 1000).toISOString(),
    new Date(now - i * 1000).toISOString(), new Date(now + 60000).toISOString());
  const second = await adminRequest(app).get('/api/access/vouchers/activations?page=2').expect(200);
  expect(second.body).toMatchObject({ page: 2, total: 12, totalPages: 2 });
  expect(second.body.items).toHaveLength(2);
  for (const query of ['page=0', 'page=100001', 'page=1.5', 'search=not-a-voucher', `search=${'a'.repeat(37)}`, 'status=unused']) {
    await adminRequest(app).get(`/api/access/vouchers/activations?${query}`).expect(400);
  }
});

test('API quản lý chỉ cho ADMIN', async () => {
  for (const path of ['/api/access/vouchers/overview', '/api/access/vouchers/activations']) {
    await supertest(app).get(path).expect(401);
  }
  const fixture = adminRequest.fixture();
  const admin = accounts.findById(fixture.user.id);
  accounts.create({ ...admin, id: crypto.randomUUID(), username: 'history_manager', role: 'POI_MANAGER' });
  const manager = await login(app, 'history_manager', fixture.password);
  for (const path of ['/api/access/vouchers/overview', '/api/access/vouchers/activations']) {
    await supertest(app).get(path).set('Cookie', manager.cookie).expect(403);
  }
});
