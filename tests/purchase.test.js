const request = require('supertest');
const app = require('../src/app');
const access = require('../src/services/access.service');
const repository = require('../src/repositories/access.repository.memory');

beforeEach(() => { repository.clear(); process.env.DEMO_PAYMENT_ENABLED = 'true';
  process.env.ACTIVATION_CODE_SECRET = 'test-only-secret-32-characters-long'; });
afterAll(() => { delete process.env.DEMO_PAYMENT_ENABLED; });
const post = (path, body) => request(app).post(`/api/access/${path}`).send(body);

it.each([15, 30, 60])('new QR selects %i minutes at the backend price and starts only after payment', async (minutes) => {
  const voucher = access.createVoucher({}, 'http://localhost:3000');
  expect(voucher.durationMinutes).toBeNull();
  expect((await post('inspect', { code: voucher.code }).expect(200)).body.status).toBe('unselected');
  await post('redeem', { code: voucher.code }).expect(409);
  await post('start', { code: voucher.code }).expect(409);
  const chosen = await post('choose', { code: voucher.code, durationMinutes: minutes, amountVnd: 1 }).expect(200);
  expect(chosen.body.payment).toMatchObject({ durationMinutes: minutes, amountVnd: minutes * 1000, status: 'pending' });
  await post('start', { code: voucher.code }).expect(409);
  const paid = await post('demo-pay', { code: voucher.code }).expect(200);
  expect(paid.body).toMatchObject({ status: 'paid', payment: { amountVnd: minutes * 1000, startedAt: null } });
  await post('redeem', { code: voucher.code }).expect(409);
  expect((await post('inspect', { code: voucher.code }).expect(200)).body.payment).toMatchObject({
    id: chosen.body.payment.id, status: 'paid', startedAt: null });
  await post('choose', { code: voucher.code, durationMinutes: 15 }).expect(409);
  const started = await post('start', { code: voucher.code, durationMinutes: 120 }).expect(200);
  expect(started.body.durationMinutes).toBe(minutes);
  expect(Date.parse(started.body.expiresAt) - Date.parse(started.body.startedAt)).toBe(minutes * 60000);
  await post('start', { code: voucher.code }).expect(409);
  expect((await post('inspect', { code: voucher.code }).expect(200)).body.status).toBe('active');
  const memoryVoucher = repository.findVoucherByCodeHash(require('crypto').createHash('sha256').update(voucher.code).digest('hex'));
  expect(memoryVoucher.expiresAt).toBeTruthy();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(memoryVoucher.expiresAt) + 1);
  try { expect((await post('inspect', { code: voucher.code }).expect(200)).body.status).toBe('expired'); }
  finally { clock.mockRestore(); }
});

it('concurrent start requests create exactly one session', async () => {
  const voucher = access.createVoucher({}, 'http://localhost:3000');
  await post('choose', { code: voucher.activationCode, durationMinutes: 30 }).expect(200);
  await post('demo-pay', { code: voucher.code }).expect(200);
  const results = await Promise.all(Array.from({ length: 10 }, () => post('start', { code: voucher.code })));
  expect(results.filter((result) => result.status === 200)).toHaveLength(1);
  expect(repository.findAllDashboardSessions()).toHaveLength(1);
});

it('payment and start racing cannot create an unpaid session; retry starts once', async () => {
  const voucher = access.createVoucher({}, 'http://localhost:3000');
  await post('choose', { code: voucher.code, durationMinutes: 30 }).expect(200);
  const results = await Promise.all([post('demo-pay', { code: voucher.code }), post('start', { code: voucher.code })]);
  expect(results[0].status).toBe(200);
  expect([200, 409]).toContain(results[1].status);
  if (results[1].status === 409) await post('start', { code: voucher.code }).expect(200);
  expect(repository.findAllDashboardSessions()).toHaveLength(1);
});

it('failed start leaves a paid voucher available for retry', async () => {
  const voucher = access.createVoucher({}, 'http://localhost:3000');
  await post('choose', { code: voucher.code, durationMinutes: 15 }).expect(200);
  await post('demo-pay', { code: voucher.code }).expect(200);
  const purchaseRepository = require('../src/repositories/purchase.repository.memory');
  await expect(purchaseRepository.start(require('crypto').createHash('sha256').update(voucher.code).digest('hex'),
    () => { throw new Error('Injected failure'); })).rejects.toThrow('Injected failure');
  expect((await post('inspect', { code: voucher.code }).expect(200)).body.status).toBe('paid');
  expect(repository.findAllDashboardSessions()).toHaveLength(0);
  await post('start', { code: voucher.code }).expect(200);
});

it('production and disabled demo mode never confirm payment', async () => {
  const voucher = access.createVoucher({}, 'http://localhost:3000');
  await post('choose', { code: voucher.code, durationMinutes: 15 }).expect(200);
  process.env.DEMO_PAYMENT_ENABLED = 'false';
  await post('demo-pay', { code: voucher.code }).expect(403);
  process.env.NODE_ENV = 'production';
  process.env.DEMO_PAYMENT_ENABLED = 'true';
  expect((await request(app).get('/api/access/packages').expect(200)).body.demoEnabled).toBe(false);
  await post('demo-pay', { code: voucher.code }).expect(403);
  process.env.NODE_ENV = 'test';
});

it('legacy voucher remains directly redeemable with its original duration', async () => {
  const voucher = access.createVoucher({ durationMinutes: 120 }, 'http://localhost:3000');
  expect((await post('inspect', { code: voucher.code }).expect(200)).body.legacy).toBe(true);
  await post('choose', { code: voucher.code, durationMinutes: 15 }).expect(409);
  expect((await post('redeem', { code: voucher.code }).expect(200)).body.durationMinutes).toBe(120);
});
