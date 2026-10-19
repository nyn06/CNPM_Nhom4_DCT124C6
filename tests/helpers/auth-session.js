const crypto = require('crypto');
const supertest = require('supertest');
const accountService = require('../../src/services/account.service');
const config = require('../../src/config/auth');

const sessionCookie = (response) => response.headers['set-cookie'].find((value) => value.startsWith(`${config.SESSION_COOKIE}=`)).split(';')[0];
async function login(app, username, password) {
  const challenge = await supertest(app).get('/api/auth/csrf').expect(200);
  const challengeCookie = challenge.headers['set-cookie']?.find((value) => value.startsWith(`${config.CHALLENGE_COOKIE}=`))?.split(';')[0];
  const response = await supertest(app).post('/api/auth/login').set('Cookie', challengeCookie || '')
    .set('X-CSRF-Token', challenge.body.csrfToken).send({ username, password });
  if (response.status !== 200) return { response, challenge, challengeCookie };
  return { response, cookie: sessionCookie(response), csrf: response.body.csrfToken, user: response.body.user };
}
async function bootstrap(app) {
  const username = 'fixture_admin';
  const password = crypto.randomBytes(24).toString('hex');
  await accountService.bootstrap({ ADMIN_BOOTSTRAP_USERNAME: username, ADMIN_BOOTSTRAP_PASSWORD: password });
  return { ...(await login(app, username, password)), username, password };
}
module.exports = { bootstrap, login, sessionCookie };
