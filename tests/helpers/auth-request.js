const supertest = require('supertest');
const { bootstrap } = require('./auth-session');
let fixture;
// This fixture performs the real CSRF + password login flow. No test-only
// middleware bypass exists in the application, including in production mode.
beforeAll(async () => { fixture = await bootstrap(require('../../src/app')); }, 30000);
function request(app) {
  const client = supertest(app);
  return Object.fromEntries(['get', 'head', 'post', 'put', 'patch', 'delete'].map((method) => [method, (...args) => {
    const req = client[method](...args).set('Cookie', fixture.cookie);
    if (!['get', 'head'].includes(method)) req.set('X-CSRF-Token', fixture.csrf).set('Content-Type', 'application/json');
    return req;
  }]));
}
request.fixture = () => fixture;
module.exports = request;
