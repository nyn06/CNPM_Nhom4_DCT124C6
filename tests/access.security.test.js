jest.mock('../src/integrations/tts/piperTts.provider', () => ({ synthesize: jest.fn() }));
const request = require('supertest');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const app = require('../src/app');
const accessService = require('../src/services/access.service');
const accessRepository = require('../src/repositories/access.repository');
const poiService = require('../src/services/poi.service');
const poiRepository = require('../src/repositories/poi.repository');
const demoAdmin = require('../src/middlewares/demoAdmin');
const piper = require('../src/integrations/tts/piperTts.provider');
const audioRepository = require('../src/repositories/audio.repository');
const filename = `security_${crypto.randomUUID()}.wav`;
const audioRoot = path.resolve(__dirname, '../public/audio');
let poi;
let token;
const initialEnv = { ...process.env };
const wav = Buffer.alloc(64);
wav.write('RIFF', 0); wav.write('WAVE', 8);

beforeAll(async () => { await fs.mkdir(audioRoot, { recursive: true }); await fs.writeFile(path.join(audioRoot, filename), wav); });
afterAll(async () => { await fs.unlink(path.join(audioRoot, filename)); });
beforeEach(() => {
  process.env.DEMO_ADMIN_ENABLED = 'true';
  process.env.NODE_ENV = 'test';
  delete process.env.PUBLIC_ORIGIN;
  accessRepository.clear(); poiRepository.clear();
  poi = poiService.createPoi({ name: 'Active', description: 'Demo', latitude: 10, longitude: 106, geofenceRadius: 50 });
  poiService.setVietnameseNarration(poi.id, { text: 'Protected narration' });
  poiRepository.update(poi.id, { narrations: { vi: { text: 'Protected narration', audioFile: filename } } });
  token = accessService.redeem({ code: accessService.createVoucher({ durationMinutes: 15 }, 'http://localhost:3000').code }).accessToken;
  piper.synthesize.mockReset().mockResolvedValue(filename);
});
afterEach(() => { jest.restoreAllMocks(); process.env = { ...initialEnv }; });
const authorized = (url) => request(app).get(url).set('Authorization', `Bearer ${token}`);

it.each(['', 'bytes=0-10'])('WAV requires Bearer even with Range %s and even with demo header', async (range) => {
  let req = request(app).get(`/audio/${filename}`).set('X-Demo-Admin', 'true');
  if (range) req = req.set('Range', range);
  const res = await req.expect(401);
  expect(res.headers['content-type']).toMatch(/json/);
});

it('serves valid audio/wav with authorization and accepts authorized Range/HEAD', async () => {
  await authorized(`/audio/${filename}`).expect(200).expect('Content-Type', /audio\/wav/).expect('Cache-Control', 'no-store');
  const partial = await authorized(`/audio/${filename}`).set('Range', 'bytes=0-9').expect(206);
  expect(partial.headers['content-range']).toBe('bytes 0-9/64');
  expect(partial.headers['content-length']).toBe('10');
  await request(app).head(`/audio/${filename}`).set('Authorization', `Bearer ${token}`).expect(200);
  await request(app).head(`/audio/${filename}`).expect(401);
});

it('invalid Range is safe and cannot disclose a filesystem path', async () => {
  const res = await authorized(`/audio/${filename}`).set('Range', 'bytes=999-1000').expect(416);
  expect(res.body.error).toBe('Khoảng audio không hợp lệ.');
  expect(JSON.stringify(res.body)).not.toContain(audioRoot);
});

it('checks server expiry again after asynchronous filesystem lookup', async () => {
  const actual = audioRepository.resolveFile.bind(audioRepository);
  jest.spyOn(audioRepository, 'resolveFile').mockImplementation(async (file) => {
    const result = await actual(file);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60000);
    return result;
  });
  await authorized(`/audio/${filename}`).expect(401);
});

it('audio rejects unsupported methods and malformed encoded paths safely', async () => {
  await request(app).post(`/audio/${filename}`).set('Authorization', `Bearer ${token}`).expect(405).expect('Allow', 'GET, HEAD');
  const response = await authorized('/audio/%E0%A4%A').expect(400);
  expect(response.body.error).toBe('Đường dẫn audio không hợp lệ.');
});

it('expired session rejects both narration and Range WAV, ignoring client-supplied expiry', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60000);
  await authorized(`/api/pois/${poi.id}/narrations/vi?expiresAt=2099-01-01`).expect(401);
  await authorized(`/audio/${filename}`).set('Range', 'bytes=0-9').expect(401);
});

it.each(['/public/audio/', '/%61udio/', '/audio%2f', '/%70ublic/audio/'])('static alias %s cannot expose a WAV', async (prefix) => {
  await request(app).get(`${prefix}${filename}`).expect(404);
});

it.each(['..%2fpackage.json', '%2e%2e%5cpackage.json', 'nested%2ffile.wav', 'file.wav%00', 'C:%5cprivate.wav', '..%252foutside.wav'])('path traversal %s is rejected after auth', async (file) => {
  const res = await authorized(`/audio/${file}`);
  expect([400, 404]).toContain(res.status);
  expect(res.text).not.toContain('auto-narration-be-demo');
  expect(res.text).not.toContain(audioRoot);
});

it('rejects a symlink resolving outside the audio root', async () => {
  const realpath = fs.realpath.bind(fs);
  jest.spyOn(fs, 'realpath').mockImplementation((file) => file === path.join(audioRoot, filename)
    ? Promise.resolve(path.resolve(audioRoot, '../index.html')) : realpath(file));
  await authorized(`/audio/${filename}`).expect(404);
});

it('does not serve inactive, orphan or missing audio to a ticket holder', async () => {
  poiService.updatePoi(poi.id, { isActive: false });
  await authorized(`/audio/${filename}`).expect(404);
  await authorized(`/api/pois/${poi.id}/narrations/vi`).expect(404);
  poiService.updatePoi(poi.id, { isActive: true });
  await authorized('/audio/orphan.wav').expect(404);
  poiRepository.update(poi.id, { narrations: { vi: { text: 'Test', audioFile: 'missing.wav' } } });
  await authorized('/audio/missing.wav').expect(404);
});

it('ticket covers all active POIs but narration metadata remains protected', async () => {
  const second = poiService.createPoi({ name: 'Second', description: 'Demo', latitude: 0, longitude: 0, geofenceRadius: 50 });
  poiService.setVietnameseNarration(second.id, { text: 'Second text' });
  for (const id of [poi.id, second.id]) {
    await authorized(`/api/pois/${id}/narrations/vi`).expect(200);
    await authorized(`/api/pois/${id}/narrations`).expect(200);
    await request(app).get(`/api/pois/${id}/narrations/vi`).expect(401);
    await request(app).get(`/api/pois/${id}/narrations`).expect(401);
  }
});

it('public POI listing/detail/nearby cannot leak narration through alternate reads', async () => {
  for (const url of ['/api/pois', `/api/pois/${poi.id}`, '/api/pois/nearby?lat=10&lng=106']) {
    const res = await request(app).get(url).expect(200);
    expect(JSON.stringify(res.body)).not.toContain('Protected narration');
    expect(JSON.stringify(res.body)).not.toContain(filename);
  }
});

it('Admin generates and previews audio locally without a tourist voucher', async () => {
  await request(app).post(`/api/pois/${poi.id}/narrations/vi/audio`).expect(200);
  expect(piper.synthesize).toHaveBeenCalledWith('Protected narration', 'vi');
  await request(app).get(`/api/pois/${poi.id}/narrations/vi`).set('X-Demo-Admin', 'true').expect(200);
  await request(app).get(`/api/admin/audio/${filename}`).expect(200).expect('Content-Type', /audio\/wav/);
});

it.each(['production', 'development'])('disabled-by-default admin in %s cannot grant vouchers or expose legacy content', async (env) => {
  process.env.NODE_ENV = env;
  delete process.env.DEMO_ADMIN_ENABLED;
  for (const url of ['/api/access/vouchers', '/api/narrations', '/admin.html', `/api/admin/audio/${filename}`]) {
    await request(app).get(url).expect(403);
  }
  await request(app).post('/api/access/vouchers').send({ durationMinutes: 60 }).expect(403);
  await request(app).post(`/api/pois/${poi.id}/narrations/vi/audio`).expect(403);
  expect(piper.synthesize).not.toHaveBeenCalled();
});

it('production rejects management even with demo flag, forged admin header or valid tourist token', async () => {
  process.env.NODE_ENV = 'production';
  await request(app).post('/api/access/vouchers').set('X-Demo-Admin', 'true').set('Authorization', `Bearer ${token}`).send({ durationMinutes: 60 }).expect(403);
  await request(app).get(`/api/pois/${poi.id}/narrations/vi`).set('X-Demo-Admin', 'true').expect(403);
  await authorized(`/api/pois/${poi.id}/narrations/vi`).expect(200);
  await request(app).get('/health').expect(200);
});

it.each([
  ['Host', 'public.example.test'], ['Origin', 'https://attacker.test'], ['Sec-Fetch-Site', 'cross-site'],
  ['X-Forwarded-For', '127.0.0.1'], ['X-Forwarded-Host', 'localhost'], ['Forwarded', 'for=127.0.0.1'],
])('demo management rejects %s=%s', async (header, value) => {
  await request(app).post('/api/access/vouchers').set(header, value).send({ durationMinutes: 60 }).expect(403);
});

it('remote socket cannot become local by spoofing Host or headers', () => {
  const req = { protocol: 'http', socket: { remoteAddress: '203.0.113.1' }, headers: { host: 'localhost' }, get: (name) => name === 'host' ? 'localhost' : undefined };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), set: jest.fn() };
  const next = jest.fn();
  demoAdmin(req, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
});

it('query tokens are never accepted, errors contain no token/path/stack', async () => {
  const res = await request(app).get(`/audio/${filename}?accessToken=${token}`).expect(401);
  expect(res.text).not.toContain(token);
  expect(res.text).not.toMatch(/stack|D:\\|tokenHash/);
  const malformed = await request(app).post('/api/access/redeem').set('Content-Type', 'application/json').send('{secret').expect(400);
  expect(malformed.text).not.toContain('secret');
});
