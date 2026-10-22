const request = require('supertest');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const auth = require('../src/services/auth.service');
const accountService = require('../src/services/account.service');
const accounts = require('../src/repositories/account.repository');
const repository = require('../src/repositories/auth.repository');
const config = require('../src/config/auth');
const { bootstrap, login } = require('./helpers/auth-session');
const { hashToken } = require('../src/utils/auth');
const { start } = require('../src/server');
jest.setTimeout(30000);
const initialEnv = { ...process.env };
let fixture;
let seed;

beforeAll(async () => {
  accounts.clear(); repository.clear();
  fixture = await bootstrap(app);
  seed = accounts.findById(fixture.user.id);
}, 30000);
beforeEach(() => {
  accounts.clear(); repository.clear(); accounts.create(seed);
  accounts.create({ ...seed, id: 'manager', username: 'fixture_manager', role: 'POI_MANAGER' });
  process.env.NODE_ENV = 'test'; delete process.env.ADMIN_ORIGIN;
  process.env.ACTIVATION_CODE_SECRET = 'test-only-secret-32-characters-long';
});
afterEach(() => { jest.restoreAllMocks(); process.env = { ...initialEnv }; });
const root = () => login(app, fixture.username, fixture.password);
async function challenge() {
  const res = await request(app).get('/api/auth/csrf').expect(200);
  return { cookie: res.headers['set-cookie'][0].split(';')[0], csrf: res.body.csrfToken };
}
const postLogin = (context, body) => request(app).post('/api/auth/login').set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).send(body);
const me = (session) => request(app).get('/api/auth/me').set('Cookie', session.cookie);

it('logs in with username/password, hashes the session token and exposes only safe user info', async () => {
  const session = await root();
  expect(session.response.status).toBe(200);
  expect(session.response.body.user.role).toBe('ADMIN');
  expect(session.response.body).not.toHaveProperty('token');
  expect(session.response.body).not.toHaveProperty('accessToken');
  expect(JSON.stringify(session.response.body)).not.toMatch(/password|tokenHash/);
  const token = session.cookie.split('=')[1];
  const stored = repository.findSession(hashToken(token));
  expect(stored.tokenHash).not.toBe(token);
  expect(stored).not.toHaveProperty('token');
  await me(session).expect(200).expect('Cache-Control', 'no-store');
  expect(accounts.findById(seed.id).passwordHash).toMatch(/^\$2[aby]\$12\$/);
  expect(await bcrypt.compare(fixture.password, seed.passwordHash)).toBe(true);
});

it.each(['bad-password', 'unknown-user', 'locked-user'])('invalid login uses one generic response for %s', async (kind) => {
  if (kind === 'locked-user') accounts.update('manager', { isLocked: true });
  const user = kind === 'unknown-user' ? 'does_not_exist' : kind === 'locked-user' ? 'fixture_manager' : fixture.username;
  const result = await login(app, user, kind === 'bad-password' ? 'incorrect' : fixture.password);
  expect(result.response.status).toBe(401);
  expect(result.response.body).toEqual({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
  expect(repository.stats().sessions).toBe(0);
  expect(result.response.headers['set-cookie'] || []).not.toEqual(expect.arrayContaining([expect.stringMatching(/^admin_session=/)]));
});

it.each([{}, { username: {} }, { username: 'fixture_admin', password: 'x'.repeat(73) }, { username: 'x'.repeat(10000), password: 'secret' }])('malformed credentials %j do not disclose internals', async (body) => {
  const context = await challenge();
  const res = await postLogin(context, body).expect(401);
  expect(res.body.error).toBe('Tên đăng nhập hoặc mật khẩu không đúng.');
});

it.each(['test', 'production'])('sets HttpOnly / Strict / host-only cookie and correct Secure flag in %s', async (env) => {
  process.env.NODE_ENV = env;
  const session = await root();
  const cookie = session.response.headers['set-cookie'].find((value) => value.startsWith('admin_session='));
  expect(cookie).toMatch(/HttpOnly/); expect(cookie).toMatch(/SameSite=Strict/); expect(cookie).toMatch(/Path=\//);
  expect(cookie).not.toMatch(/Domain=/);
  expect(cookie.includes('Secure')).toBe(env === 'production');
  expect(cookie).toMatch(/Max-Age=3600/);
});

it('sets Secure when the request is HTTPS even outside production', () => {
  const { cookieOptions } = require('../src/utils/authHttp');
  expect(cookieOptions({ secure: true }).secure).toBe(true);
});

it('requires an admin cookie; tourist bearer, URL tokens and forged headers cannot authenticate', async () => {
  await request(app).get('/api/auth/me').expect(401);
  await request(app).get(`/api/auth/me?token=${'a'.repeat(64)}`).set('Authorization', `Bearer ${'b'.repeat(64)}`).set('X-Demo-Admin', 'true').expect(401);
  expect(auth.authenticate.bind(auth, 'not-a-token')).toThrow();
});

it('rejects duplicate session cookies rather than trusting attacker-selected order', async () => {
  const session = await root();
  await request(app).get('/api/auth/me').set('Cookie', `${session.cookie}; admin_session=${'a'.repeat(64)}`).expect(401);
});

it('expires on backend at the exact boundary, ignoring client expiry headers', async () => {
  const session = await root();
  const stored = repository.findSession(hashToken(session.cookie.split('=')[1]));
  jest.spyOn(Date, 'now').mockReturnValue(stored.expiresAt - 1);
  await me(session).expect(200);
  Date.now.mockReturnValue(stored.expiresAt);
  const res = await me(session).set('X-Expires-At', '2099-01-01').expect(401);
  expect(res.headers['set-cookie'].join('')).toContain('Expires=Thu, 01 Jan 1970');
});

it('logout invalidates server session and clears cookie; replay of old cookie fails', async () => {
  const session = await root();
  const res = await request(app).post('/api/auth/logout').set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send({}).expect(204);
  expect(res.headers['set-cookie'].some((value) => value.startsWith('admin_session=;'))).toBe(true);
  expect(repository.stats().sessions).toBe(0);
  await me(session).expect(401);
});

it('login rotates an existing session ID and CSRF token', async () => {
  const session = await root();
  const res = await request(app).post('/api/auth/login').set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf)
    .send({ username: fixture.username, password: fixture.password }).expect(200);
  expect(res.body.csrfToken).not.toBe(session.csrf);
  await me(session).expect(401);
  expect(repository.stats().sessions).toBe(1);
});

it('protects login, logout and mutations with bound CSRF tokens', async () => {
  const context = await challenge();
  await request(app).post('/api/auth/login').send({ username: fixture.username, password: fixture.password }).expect(403);
  const other = await challenge();
  await postLogin({ ...context, csrf: other.csrf }, { username: fixture.username, password: fixture.password }).expect(403);
  const session = await root();
  await request(app).post('/api/auth/logout').set('Cookie', session.cookie).send({}).expect(403);
  await request(app).post('/api/access/vouchers').set('Cookie', session.cookie).send({ durationMinutes: 60 }).expect(403);
  await me(session).expect(200);
});

it('GET csrf returns the authenticated session token for refresh without rotating it', async () => {
  const session = await root();
  const res = await request(app).get('/api/auth/csrf').set('Cookie', session.cookie).expect(200);
  expect(res.body.csrfToken).toBe(session.csrf);
  expect(res.headers['set-cookie']).toBeUndefined();
});

it('pre-login CSRF context expires and is consumed after successful login', async () => {
  const context = await challenge();
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + config.CHALLENGE_TTL_MS);
  await postLogin(context, { username: fixture.username, password: fixture.password }).expect(403);
  jest.restoreAllMocks();
  const fresh = await challenge();
  await postLogin(fresh, { username: fixture.username, password: fixture.password }).expect(200);
  await postLogin(fresh, { username: fixture.username, password: fixture.password }).expect(403);
});

it.each([['Origin', 'https://attacker.test'], ['Origin', 'null'], ['Sec-Fetch-Site', 'cross-site']])('CSRF also rejects %s=%s even with a valid token', async (header, value) => {
  const session = await root();
  await request(app).post('/api/access/vouchers').set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).set(header, value).send({ durationMinutes: 60 }).expect(403);
  await request(app).get('/api/auth/csrf').set(header, value).expect(403);
});

it('configured origin accepts exact origin and rejects same-site subdomain/form requests', async () => {
  const session = await root();
  process.env.ADMIN_ORIGIN = 'https://admin.example.test';
  await request(app).post('/api/access/vouchers').set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).set('Origin', process.env.ADMIN_ORIGIN).send({ durationMinutes: 15 }).expect(201);
  await request(app).post('/api/auth/logout').set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).set('Origin', 'https://sub.admin.example.test').send({}).expect(403);
  await request(app).post('/api/auth/logout').set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).type('form').send('a=1').expect(403);
});

it('limits username brute force, returns Retry-After, and recovers after fake-clock window', async () => {
  const context = await challenge();
  for (let i = 0; i < config.MAX_LOGIN_USER_ATTEMPTS; i++) await postLogin(context, { username: fixture.username, password: 'wrong' }).expect(401);
  await postLogin(context, { username: fixture.username, password: fixture.password }).expect(429).expect('Retry-After', '900');
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + config.ATTEMPT_WINDOW_MS);
  const fresh = await challenge();
  await postLogin(fresh, { username: fixture.username, password: fixture.password }).expect(200);
});

it('IP attempt budget ignores forged X-Forwarded-For and has explicit bounded memory', async () => {
  for (let i = 0; i < config.MAX_LOGIN_IP_ATTEMPTS; i++) {
    repository.recordLoginAttempt('ip:socket', `user:${i}`);
  }
  expect(() => repository.recordLoginAttempt('ip:socket', 'user:new')).toThrow(expect.objectContaining({ statusCode: 429 }));
  repository.clear();
  for (let i = 0; i < config.MAX_ATTEMPT_KEYS / 2; i++) repository.recordLoginAttempt(`ip:${i}`, `user:${i}`);
  expect(repository.stats().attemptKeys).toBe(config.MAX_ATTEMPT_KEYS);
  expect(() => repository.recordLoginAttempt('ip:new', 'user:new')).toThrow(expect.objectContaining({ statusCode: 429 }));
  expect(repository.stats().attemptKeys).toBe(config.MAX_ATTEMPT_KEYS);
  const context = await challenge();
  await postLogin(context, { username: fixture.username, password: fixture.password }).set('X-Forwarded-For', '127.0.0.88').expect(429);
});

it('bounds anonymous CSRF contexts and sessions; expired entries can be reclaimed', () => {
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  const expiresAt = now + 100;
  for (let i = 0; i < config.MAX_CHALLENGES; i++) repository.createChallenge({ tokenHash: `c${i}`, expiresAt });
  expect(() => repository.createChallenge({ tokenHash: 'extra', expiresAt })).toThrow(expect.objectContaining({ statusCode: 503 }));
  for (let i = 0; i < config.MAX_SESSIONS; i++) repository.createSession({ tokenHash: `s${i}`, expiresAt });
  expect(() => repository.createSession({ tokenHash: 'extra', expiresAt })).toThrow(expect.objectContaining({ statusCode: 503 }));
  Date.now.mockReturnValue(expiresAt);
  repository.createSession({ tokenHash: 'new', expiresAt: expiresAt + 100 });
  expect(repository.stats().sessions).toBe(1);
});

it('real login IP limit cannot be rotated using X-Forwarded-For', async () => {
  jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);
  const context = await challenge();
  for (let i = 0; i < config.MAX_LOGIN_IP_ATTEMPTS; i++) {
    await postLogin(context, { username: `unknown_${i}`, password: 'wrong' }).set('X-Forwarded-For', `192.0.2.${i}`).expect(401);
  }
  await postLogin(context, { username: 'unknown_last', password: 'wrong' }).set('X-Forwarded-For', '198.51.100.1').expect(429);
  expect(bcrypt.compare).toHaveBeenCalledTimes(config.MAX_LOGIN_IP_ATTEMPTS);
});

it('bounds simultaneous bcrypt login work without keeping an unbounded request queue', async () => {
  const finish = [];
  jest.spyOn(bcrypt, 'compare').mockImplementation(() => new Promise((resolve) => { finish.push(resolve); }));
  const pending = [];
  for (let i = 0; i < config.MAX_LOGIN_IN_FLIGHT; i++) {
    const username = `concurrent_${i}`;
    accounts.create({ ...seed, id: username, username });
    pending.push(auth.login({ username, password: 'wrong' }, `ip-${i}`).catch((error) => error.statusCode));
  }
  await expect(auth.login({ username: fixture.username, password: fixture.password }, 'extra-ip')).rejects.toMatchObject({ statusCode: 429 });
  finish.forEach((resolve) => resolve(false));
  expect(await Promise.all(pending)).toEqual(Array(config.MAX_LOGIN_IN_FLIGHT).fill(401));
});

it('bootstrap has no default password and server refuses missing or unsafe config before listen', async () => {
  accounts.clear();
  await expect(start({})).rejects.toMatchObject({ statusCode: 400 });
  await expect(start({ ADMIN_BOOTSTRAP_USERNAME: 'admin', ADMIN_BOOTSTRAP_PASSWORD: 'short' })).rejects.toMatchObject({ statusCode: 400 });
  await expect(start({ NODE_ENV: 'production', ADMIN_ORIGIN: 'http://unsafe.test' })).rejects.toMatchObject({ statusCode: 503 });
  expect(accounts.findAll()).toHaveLength(0);
});

it('bootstrap is idempotent and never overwrites an existing account', async () => {
  await accountService.bootstrap({ ADMIN_BOOTSTRAP_USERNAME: 'other', ADMIN_BOOTSTRAP_PASSWORD: crypto.randomBytes(20).toString('hex') });
  expect(accounts.findAll()).toHaveLength(2);
  expect(accounts.findById(seed.id)).toEqual(seed);
});

it('valid startup bootstraps before listen and drops the bootstrap password from the child environment', async () => {
  accounts.clear();
  process.env.ADMIN_BOOTSTRAP_USERNAME = 'first_admin';
  process.env.ADMIN_BOOTSTRAP_PASSWORD = fixture.password;
  process.env.PORT = '0';
  const output = jest.spyOn(console, 'log').mockImplementation(() => {});
  const server = await start();
  try {
    await request(server).get('/health').expect(200);
    expect(accounts.findByUsername('first_admin').role).toBe('ADMIN');
    expect(process.env.ADMIN_BOOTSTRAP_PASSWORD).toBeUndefined();
    expect(JSON.stringify(output.mock.calls)).not.toContain(fixture.password);
    const session = await login(server, 'first_admin', fixture.password);
    expect(session.response.status).toBe(200);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
