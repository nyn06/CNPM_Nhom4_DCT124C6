const request = require('supertest');
const crypto = require('crypto');
const QRCode = require('qrcode');
const app = require('../src/app');
const service = require('../src/services/access.service');
const repository = require('../src/repositories/access.repository');
const initialEnv = { ...process.env };
const origin = 'http://localhost:3000';
const create = (minutes = 60) => request(app).post('/api/access/vouchers').send({ durationMinutes: minutes });
const redeem = (code, extra = {}) => request(app).post('/api/access/redeem').send({ code, ...extra });
const session = (token) => request(app).get('/api/access/session').set('Authorization', `Bearer ${token}`);

beforeEach(() => {
  repository.clear();
  process.env.DEMO_ADMIN_ENABLED = 'true';
  process.env.NODE_ENV = 'test';
  delete process.env.PUBLIC_ORIGIN;
});
afterEach(() => { jest.restoreAllMocks(); process.env = { ...initialEnv }; });

it.each([15, 60, 120])('creates %i minute voucher with metadata, random code and local QR', async (minutes) => {
  const response = await create(minutes);
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({
    durationMinutes: minutes, status: 'unused', redeemedAt: null, expiresAt: null,
    code: expect.stringMatching(/^[a-f0-9]{64}$/), id: expect.any(String),
    demoOnly: true, mobileReady: false,
  });
  const url = new URL(response.body.activationUrl);
  expect(url.searchParams.get('voucher')).toBe(response.body.code);
  expect(url.pathname).toBe('/');
  expect(url.searchParams.has('accessToken')).toBe(false);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.qrSvg).toBe(await QRCode.toString(url.href, { type: 'svg', errorCorrectionLevel: 'M', margin: 4 }));
});

it.each([0, 1, 30, 240, -15, '60', null, {}, []])('rejects duration %j without creating a voucher', async (minutes) => {
  await create(minutes).expect(400);
  expect(repository.findAllVouchers()).toHaveLength(0);
});

it('uses secure randomness with no duplicate codes; repository does not store raw secrets', () => {
  const random = jest.spyOn(crypto, 'randomBytes');
  const codes = Array.from({ length: 100 }, () => service.createVoucher({ durationMinutes: 15 }, origin).code);
  expect(new Set(codes).size).toBe(100);
  expect(random).toHaveBeenCalledWith(32);
  for (const voucher of repository.findAllVouchers()) {
    expect(voucher).not.toHaveProperty('code');
    expect(codes).not.toContain(voucher.codeHash);
  }
});

it('list exposes statuses without codes, QR, activation URLs, token hashes or session IDs', async () => {
  const voucher = (await create()).body;
  const activated = (await redeem(voucher.code)).body;
  const list = await request(app).get('/api/access/vouchers');
  expect(list.body).toEqual([expect.objectContaining({ id: voucher.id, status: 'redeemed' })]);
  expect(JSON.stringify(list.body)).not.toContain(voucher.code);
  expect(JSON.stringify(list.body)).not.toContain(activated.accessToken);
  for (const key of ['code', 'codeHash', 'tokenHash', 'activationUrl', 'qrSvg', 'sessionId']) expect(list.body[0]).not.toHaveProperty(key);
});

it('redeems once, issues a separate opaque session token and accepts valid session', async () => {
  const voucher = (await create()).body;
  const response = await redeem(voucher.code, { durationMinutes: 120, expiresAt: '2099-01-01' });
  expect(response.status).toBe(200);
  expect(response.body.accessToken).toMatch(/^[a-f0-9]{64}$/);
  expect(response.body.accessToken).not.toBe(voucher.code);
  expect(response.body.durationMinutes).toBe(60);
  expect(Date.parse(response.body.expiresAt) - Date.parse(response.body.startedAt)).toBe(3600000);
  const checked = await session(response.body.accessToken).expect(200);
  expect(checked.body).not.toHaveProperty('accessToken');
  await redeem(voucher.code).expect(409);
  expect(repository.findSession(crypto.createHash('sha256').update(voucher.code).digest('hex'))).toBeNull();
});

it('ten concurrent redeems have exactly one success and one session creation', async () => {
  const voucher = (await create()).body;
  const random = jest.spyOn(crypto, 'randomBytes');
  const responses = await Promise.all(Array.from({ length: 10 }, () => redeem(voucher.code)));
  expect(responses.filter((res) => res.status === 200)).toHaveLength(1);
  expect(responses.filter((res) => res.status === 409)).toHaveLength(9);
  expect(random).toHaveBeenCalledTimes(1);
});

it.each([undefined, '', 'TICKET001', 42, {}, 'a'.repeat(64)])('invalid voucher %j does not allocate any session token', async (code) => {
  const random = jest.spyOn(crypto, 'randomBytes');
  const response = await redeem(code);
  expect(response.status).toBe(400);
  expect(random).not.toHaveBeenCalled();
  expect(JSON.stringify(response.body)).not.toMatch(/stack|token|codeHash/i);
});

it('starts duration at redemption and rejects the exact expiry boundary using the server clock', async () => {
  let now = Date.parse('2026-10-13T00:00:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const voucher = service.createVoucher({ durationMinutes: 15 }, origin);
  now += 7200000;
  const result = await redeem(voucher.code);
  expect(result.body.startedAt).toBe('2026-10-13T02:00:00.000Z');
  now += 15 * 60000 - 1;
  await session(result.body.accessToken).expect(200);
  now++;
  const expired = await session(result.body.accessToken).expect(401);
  expect(expired.body.code).toBe('ACCESS_EXPIRED');
  const list = await request(app).get('/api/access/vouchers');
  expect(list.body[0].status).toBe('expired');
  await redeem(voucher.code).expect(409);
});

it.each([null, 'Bearer wrong', `Bearer ${'a'.repeat(64)}`, 'Basic secret'])('rejects missing/invalid authorization %s', async (header) => {
  let req = request(app).get('/api/access/session');
  if (header) req = req.set('Authorization', header);
  const res = await req.expect(401);
  expect(JSON.stringify(res.body)).not.toContain('secret');
});

it('uses configured public HTTPS origin and encodes only the voucher, not a session', async () => {
  process.env.PUBLIC_ORIGIN = 'https://tour.example.test';
  const qr = jest.spyOn(QRCode, 'toString');
  const res = await create();
  expect(new URL(res.body.activationUrl).origin).toBe(process.env.PUBLIC_ORIGIN);
  expect(res.body.mobileReady).toBe(true);
  expect(qr).toHaveBeenCalledWith(res.body.activationUrl, expect.objectContaining({ type: 'svg' }));
  expect(res.body).not.toHaveProperty('accessToken');
});

it.each(['javascript:alert(1)', 'https://user:secret@host.test', 'https://host.test/path', 'https://host.test/?key=secret'])('rejects unsafe PUBLIC_ORIGIN %s', async (publicOrigin) => {
  process.env.PUBLIC_ORIGIN = publicOrigin;
  const res = await create().expect(503);
  expect(JSON.stringify(res.body)).not.toContain('secret');
  expect(repository.findAllVouchers()).toHaveLength(0);
});

it('opening a QR URL does not redeem or consume the voucher', async () => {
  const voucher = (await create()).body;
  const res = await request(app).get(`/?voucher=${voucher.code}`).expect(200);
  expect(res.headers['referrer-policy']).toBe('no-referrer');
  expect(service.listVouchers()[0].status).toBe('unused');
  await redeem(voucher.code).expect(200);
});
