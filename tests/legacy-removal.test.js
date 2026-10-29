const request = require('supertest');
const app = require('../src/app');

test('GET /api/languages keeps its existing response', async () => {
  const response = await request(app).get('/api/languages').expect(200);
  expect(response.body).toEqual({ languages: ['vi', 'en', 'ja', 'ko', 'fr', 'zh'] });
});

test.each([
  ['get', '/api/narrations'], ['get', '/api/narrations/unknown'], ['post', '/api/narrations'],
  ['get', '/api/jobs'], ['get', '/api/jobs/unknown'], ['post', '/api/jobs'],
])('%s %s is no longer routed', async (method, path) => {
  await request(app)[method](path).expect(404);
});
