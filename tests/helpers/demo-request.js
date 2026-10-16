const supertest = require('supertest');
// Existing Stage 1-7 management tests explicitly opt into the local demo.
// Security tests use raw supertest and independently exercise the boundary.
process.env.DEMO_ADMIN_ENABLED = 'true';
module.exports = (app) => {
  const client = supertest(app);
  return Object.fromEntries(['get', 'head', 'post', 'put', 'patch', 'delete'].map((method) => [
    method, (...args) => client[method](...args).set('X-Demo-Admin', 'true'),
  ]));
};
