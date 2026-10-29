jest.mock('../src/integrations/tts/piperTts.provider', () => ({ synthesize: jest.fn() }));
jest.mock('../src/integrations/translation/translation.provider', () => ({ translate: jest.fn() }));
const request = require('supertest');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs/promises');
const path = require('path');
const app = require('../src/app');
const accountService = require('../src/services/account.service');
const authService = require('../src/services/auth.service');
const accounts = require('../src/repositories/account.repository');
const sessions = require('../src/repositories/auth.repository');
const pois = require('../src/repositories/poi.repository');
const access = require('../src/repositories/access.repository');
const poiService = require('../src/services/poi.service');
const piper = require('../src/integrations/tts/piperTts.provider');
const translator = require('../src/integrations/translation/translation.provider');
const { bootstrap, login } = require('./helpers/auth-session');
const config = require('../src/config/auth');
const audioRepository = require('../src/repositories/audio.repository');
jest.setTimeout(30000);
let fixture;
let seed;
let cachedRoot;
let cachedManager;
let poi;
const filename = `rbac_${crypto.randomUUID()}.wav`;
const audioPath = path.resolve(__dirname, '../public/audio', filename);
const initialEnv = { ...process.env };
const basePoi = { name: 'POI', description: 'Public description', latitude: 10, longitude: 106, geofenceRadius: 50 };

beforeAll(async () => {
  accounts.clear(); sessions.clear(); fixture = await bootstrap(app); seed = accounts.findById(fixture.user.id);
  await fs.mkdir(path.dirname(audioPath), { recursive: true }); await fs.writeFile(audioPath, Buffer.alloc(64));
}, 30000);
afterAll(async () => fs.unlink(audioPath));
beforeEach(() => {
  accounts.clear(); sessions.clear(); pois.clear(); access.clear();
  accounts.create(seed);
  accounts.create({ ...seed, id: 'manager', username: 'fixture_manager', role: 'POI_MANAGER' });
  cachedRoot = null; cachedManager = null;
  process.env.NODE_ENV = 'test'; delete process.env.ADMIN_ORIGIN;
  process.env.ACTIVATION_CODE_SECRET = 'test-only-secret-32-characters-long';
  poi = poiService.createPoi(basePoi);
  poiService.setVietnameseNarration(poi.id, { text: 'Protected narration' });
  piper.synthesize.mockReset().mockResolvedValue(filename);
  translator.translate.mockReset().mockImplementation(async (text, source, target) => ({ text: `Fixture ${target}` }));
});
afterEach(() => { jest.restoreAllMocks(); process.env = { ...initialEnv }; });
async function root() { if (!cachedRoot) cachedRoot = await login(app, fixture.username, fixture.password); return cachedRoot; }
async function manager() { if (!cachedManager) cachedManager = await login(app, 'fixture_manager', fixture.password); return cachedManager; }
function call(session, method, url, body) {
  const req = request(app)[method](url).set('Cookie', session.cookie);
  if (!['get', 'head'].includes(method)) req.set('X-CSRF-Token', session.csrf).set('Content-Type', 'application/json');
  return body === undefined ? req : req.send(body);
}

it.each([
  ['get', '/api/admin/pois'], ['get', '/api/admin/pois/missing'], ['post', '/api/pois'], ['put', '/api/pois/missing'], ['delete', '/api/pois/missing'],
  ['put', '/api/pois/missing/narrations/vi'], ['post', '/api/pois/missing/translations'], ['post', '/api/pois/missing/narrations/vi/audio'],
  ['get', '/api/admin/audio/file.wav'], ['head', '/api/admin/audio/file.wav'], ['get', '/api/access/vouchers'], ['post', '/api/access/vouchers'],
  ['get', '/api/accounts'], ['post', '/api/accounts'], ['patch', '/api/accounts/missing'], ['post', '/api/accounts/missing/password'],
])('admin API %s %s requires a real cookie despite localhost/demo settings', async (method, url) => {
  process.env.DEMO_ADMIN_ENABLED = 'true';
  const req = request(app)[method](url).set('X-Demo-Admin', 'true');
  if (!['get', 'head'].includes(method)) req.send({});
  await req.expect(401);
});

it('Admin HTML is protected and encoded static aliases cannot expose it', async () => {
  await request(app).get('/admin.html').expect(302).expect('Location', '/admin-login.html');
  await request(app).get('/%61dmin.html').expect(404);
  await request(app).get('/admin-login.html').expect(200);
  await call(await manager(), 'get', '/admin.html').expect(200);
});

it('POI_MANAGER creates/updates/deletes POIs, translates, generates four languages and previews WAV/Range', async () => {
  const session = await manager();
  await call(session, 'post', '/api/pois', basePoi).expect(201);
  await call(session, 'put', `/api/pois/${poi.id}`, { isActive: false }).expect(200);
  await call(session, 'put', `/api/pois/${poi.id}/narrations/vi`, { text: 'Nguồn VI' }).expect(200);
  await call(session, 'post', `/api/pois/${poi.id}/translations`, { targetLanguages: ['en', 'ja', 'ko'] }).expect(200);
  for (const language of ['vi', 'en', 'ja', 'ko']) {
    await call(session, 'post', `/api/pois/${poi.id}/narrations/${language}/audio`, {}).expect(200);
    await call(session, 'get', `/api/pois/${poi.id}/narrations/${language}`).expect(200);
  }
  const list = await call(session, 'get', '/api/admin/pois').expect(200);
  expect(list.body.find((item) => item.id === poi.id).narrations.vi.audioFile).toBe(filename);
  await call(session, 'get', `/api/admin/pois/${poi.id}`).expect(200);
  await call(session, 'get', `/api/admin/audio/${filename}`).expect(200).expect('Content-Type', /audio\/wav/);
  await call(session, 'get', `/api/admin/audio/${filename}`).set('Range', 'bytes=0-9').expect(206);
  await call(session, 'delete', `/api/pois/${poi.id}`).expect(204);
});

it.each([['get', '/api/access/vouchers'], ['post', '/api/access/vouchers'], ['get', '/api/accounts'], ['post', '/api/accounts'], ['patch', '/api/accounts/manager'], ['post', '/api/accounts/manager/password']])('POI_MANAGER cannot use %s %s even with correct CSRF', async (method, url) => {
  await call(await manager(), method, url, method === 'get' ? undefined : {}).expect(403);
});

it('ADMIN creates accounts with salted bcrypt hashes and list/API responses contain no credentials', async () => {
  const session = await root();
  const data = { username: 'New.Manager', role: 'POI_MANAGER', password: 'Test-only-long-password' };
  const created = await call(session, 'post', '/api/accounts', data).expect(201);
  expect(created.body.username).toBe('new.manager');
  expect(JSON.stringify(created.body)).not.toMatch(/password|version|token/);
  expect(await bcrypt.compare(data.password, accounts.findById(created.body.id).passwordHash)).toBe(true);
  const second = await call(session, 'post', '/api/accounts', { ...data, username: 'new.second' }).expect(201);
  expect(accounts.findById(created.body.id).passwordHash).not.toBe(accounts.findById(second.body.id).passwordHash);
  const list = await call(session, 'get', '/api/accounts').expect(200);
  expect(JSON.stringify(list.body)).not.toContain(data.password);
  expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  await call(session, 'post', '/api/accounts', { ...data, username: 'NEW.MANAGER' }).expect(409);
});

it.each([
  { username: 'valid_name', password: 'short', role: 'ADMIN' },
  { username: 'bad name', password: 'valid-long-password', role: 'ADMIN' },
  { username: 'valid_name', password: 'valid-long-password', role: 'SUPER_ADMIN' },
  { username: 'valid_name', password: '界'.repeat(25), role: 'ADMIN' },
  { username: 'valid_name', password: 'valid-long-password', role: 'ADMIN', isLocked: false },
])('rejects unsafe account creation %j', async (body) => {
  await call(await root(), 'post', '/api/accounts', body).expect(400);
  expect(accounts.findAll()).toHaveLength(2);
});

it.each([{ role: 'OWNER' }, { isLocked: 'false' }, { passwordHash: 'injected' }, { version: 0 }, {}])('prevents mass assignment/invalid patches %j', async (body) => {
  await call(await root(), 'patch', '/api/accounts/manager', body).expect(400);
});

it('role changes revoke sessions and enforce the current role immediately', async () => {
  const admin = await root(); const oldManager = await manager();
  await call(admin, 'patch', '/api/accounts/manager', { role: 'ADMIN' }).expect(200);
  await call(oldManager, 'get', '/api/admin/pois').expect(401);
  const elevated = await login(app, 'fixture_manager', fixture.password);
  await call(elevated, 'get', '/api/accounts').expect(200);
  await call(admin, 'patch', '/api/accounts/manager', { role: 'POI_MANAGER' }).expect(200);
  await call(elevated, 'post', '/api/access/vouchers', { durationMinutes: 60 }).expect(401);
  const newManager = await login(app, 'fixture_manager', fixture.password);
  await call(newManager, 'get', '/api/accounts').expect(403);
});

it('locking revokes existing sessions and denies login; unlocking permits a new login', async () => {
  const admin = await root(); const old = await manager();
  await call(admin, 'patch', '/api/accounts/manager', { isLocked: true }).expect(200);
  await call(old, 'get', '/api/admin/pois').expect(401);
  expect((await login(app, 'fixture_manager', fixture.password)).response.status).toBe(401);
  await call(admin, 'patch', '/api/accounts/manager', { isLocked: false }).expect(200);
  const fresh = await login(app, 'fixture_manager', fixture.password);
  await call(fresh, 'get', '/api/admin/pois').expect(200);
});

it('password reset revokes all sessions and accepts only the new password', async () => {
  const admin = await root(); const old = await manager();
  await call(admin, 'post', '/api/accounts/manager/password', { password: 'New-test-only-password' }).expect(200);
  await call(old, 'get', '/api/admin/pois').expect(401);
  expect((await login(app, 'fixture_manager', fixture.password)).response.status).toBe(401);
  const fresh = await login(app, 'fixture_manager', 'New-test-only-password');
  await call(fresh, 'get', '/api/admin/pois').expect(200);
});

it.each([{ role: 'POI_MANAGER' }, { isLocked: true }, { role: 'POI_MANAGER', isLocked: true }])('forbids an ADMIN changing their own role or lock state with %j', async (body) => {
  const admin = await root();
  await call(admin, 'patch', `/api/accounts/${seed.id}`, body).expect(403);
  await call(admin, 'get', '/api/accounts').expect(200);
});

it('repository cannot remove the last active ADMIN even with concurrent updates', async () => {
  accounts.create({ ...seed, id: 'second-admin', username: 'second_admin' });
  const responses = await Promise.allSettled([
    Promise.resolve().then(() => accounts.update(seed.id, { role: 'POI_MANAGER' })),
    Promise.resolve().then(() => accounts.update('second-admin', { role: 'POI_MANAGER' })),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect(accounts.findAll().filter((account) => account.role === 'ADMIN' && !account.isLocked)).toHaveLength(1);
});

it('a locked ADMIN does not count as a replacement for the last active ADMIN', async () => {
  accounts.create({ ...seed, id: 'locked-admin', username: 'locked_admin', isLocked: true });
  expect(() => accounts.update(seed.id, { isLocked: true })).toThrow();
});

it('ADMIN changes their own password only with the current password and loses old sessions', async () => {
  const admin = await root();
  await call(admin, 'post', `/api/accounts/${seed.id}/password`, { password: 'New-test-only-password' }).expect(403);
  await call(admin, 'post', '/api/accounts/me/password', { currentPassword: 'wrong', newPassword: 'New-test-only-password' }).expect(400);
  await call(admin, 'post', '/api/accounts/me/password', { currentPassword: fixture.password, newPassword: fixture.password }).expect(400);
  await call(admin, 'post', '/api/accounts/me/password', { currentPassword: fixture.password, newPassword: 'New-test-only-password' }).expect(200);
  await call(admin, 'get', '/api/accounts').expect(401);
  expect((await login(app, fixture.username, fixture.password)).response.status).toBe(401);
  await call(await login(app, fixture.username, 'New-test-only-password'), 'get', '/api/accounts').expect(200);
});

it('admin WAV revalidates session expiry after asynchronous filesystem lookup', async () => {
  const admin = await root();
  const lookup = audioRepository.resolveFile.bind(audioRepository);
  jest.spyOn(audioRepository, 'resolveFile').mockImplementation(async (file) => {
    const result = await lookup(file);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + config.SESSION_TTL_MS);
    return result;
  });
  await call(admin, 'get', `/api/admin/audio/${filename}`).expect(401);
});

it('login cannot issue a session from credentials changed during bcrypt comparison', async () => {
  let finish;
  jest.spyOn(bcrypt, 'compare').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = authService.login({ username: 'fixture_manager', password: fixture.password }, 'race-test');
  accounts.update('manager', { isLocked: true }); finish(true);
  await expect(pending).rejects.toMatchObject({ statusCode: 401 });
  expect(sessions.stats().sessions).toBe(0);
});

it('password reset rechecks actor authority after hashing', async () => {
  accounts.create({ ...seed, id: 'second-admin', username: 'second_admin' });
  let finish;
  jest.spyOn(bcrypt, 'hash').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = accountService.resetPassword('manager', { password: 'Valid-long-password' }, seed.id);
  accounts.update(seed.id, { role: 'POI_MANAGER' }); finish(seed.passwordHash);
  await expect(pending).rejects.toMatchObject({ statusCode: 403 });
  expect(accounts.findById('manager').version).toBe(1);
});

it('account capacity is bounded', () => {
  for (let i = accounts.findAll().length; i < config.MAX_ACCOUNTS; i++) accounts.create({ ...seed, id: `id-${i}`, username: `user_${i}` });
  expect(() => accounts.create({ ...seed, id: 'extra', username: 'extra' })).toThrow(expect.objectContaining({ statusCode: 503 }));
  expect(accounts.findAll()).toHaveLength(config.MAX_ACCOUNTS);
});

it('authenticated management works in production regardless of demo flag or request hostname', async () => {
  const admin = await root();
  process.env.NODE_ENV = 'production'; process.env.DEMO_ADMIN_ENABLED = 'false';
  await call(admin, 'get', '/api/accounts').set('Host', 'admin.example.test').expect(200);
});

it('Stage 8 QR redeem and protected WAV/Range still require only a tourist voucher', async () => {
  const admin = await root();
  await call(admin, 'post', `/api/pois/${poi.id}/narrations/vi/audio`, {}).expect(200);
  const voucher = await call(admin, 'post', '/api/access/vouchers', { durationMinutes: 60 }).expect(201);
  const redeemed = await request(app).post('/api/access/redeem').send({ code: voucher.body.code }).expect(200);
  const token = redeemed.body.accessToken;
  await request(app).get(`/audio/${filename}`).expect(401);
  await request(app).get(`/audio/${filename}`).set('Range', 'bytes=0-9').expect(401);
  await request(app).get(`/audio/${filename}`).set('Authorization', `Bearer ${token}`).set('Range', 'bytes=0-9').expect(206);
  await request(app).get(`/api/pois/${poi.id}/narrations/vi`).set('Authorization', `Bearer ${token}`).expect(200);
  await request(app).post('/api/access/redeem').send({ code: voucher.body.code }).expect(409);
  await request(app).get('/api/pois/nearby?lat=10&lng=106').expect(200);
  const publicPoi = await request(app).get(`/api/pois/${poi.id}`).expect(200);
  expect(publicPoi.body).not.toHaveProperty('narrations');
  await request(app).get(`/audio/${filename}`).set('Cookie', admin.cookie).expect(401);
});
