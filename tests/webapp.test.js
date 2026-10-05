const request = require('supertest');
const app = require('../src/app');

describe('WebApp static cùng origin với API', () => {
  it('GET / trả trang demo HTML', async () => {
    const res = await request(app).get('/');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('HỆ THỐNG THUYẾT MINH TỰ ĐỘNG');
    expect(res.text).toContain('id="simulation-form"');
    expect(res.text).toContain('/js/app.js');
  });

  it.each([
    ['/css/style.css', /text\/css/],
    ['/js/app.js', /javascript/],
  ])('phục vụ asset %s', async (url, contentType) => {
    const res = await request(app).get(url);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(contentType);
  });

  it('không bắt nhầm /health và /api/pois thành HTML', async () => {
    const health = await request(app).get('/health');
    const pois = await request(app).get('/api/pois');

    expect(health.statusCode).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });
    expect(pois.statusCode).toBe(200);
    expect(Array.isArray(pois.body)).toBe(true);
  });

  it('API không tồn tại vẫn trả 404, không fallback sang index.html', async () => {
    const res = await request(app).get('/api/khong-ton-tai');

    expect(res.statusCode).toBe(404);
    expect(res.text).not.toContain('id="simulation-form"');
  });
});
