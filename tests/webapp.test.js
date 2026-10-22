const request = require('./helpers/auth-request');
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
    ['/js/map.js', /javascript/],
    ['/leaflet/leaflet.css', /text\/css/],
    ['/leaflet/leaflet.js', /javascript/],
    ['/leaflet/images/marker-icon.png', /image\/png/],
  ])('phục vụ asset %s', async (url, contentType) => {
    const res = await request(app).get(url);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(contentType);
  });

  it('trang Tourist chỉ gửi origin cho tile OSM, không đưa mã vé trong Referer', async () => {
    const tourist = await request(app).get('/index.html?voucher=fixture');
    expect(tourist.statusCode).toBe(200);
    expect(tourist.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(tourist.text).toContain('id="poi-map"');
    expect(tourist.text).toContain('/js/map.js');
    const api = await request(app).get('/api/pois');
    expect(api.headers['referrer-policy']).toBe('no-referrer');
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

  it('Stage 7: /admin.html là trang riêng, dùng script admin và nguồn ngôn ngữ chung', async () => {
    const res = await request(app).get('/admin.html');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Quản lý điểm thuyết minh');
    expect(res.text).toContain('id="poi-form"');
    expect(res.text).toContain('/js/poi-languages.js');
    expect(res.text).toContain('/js/admin.js');
    expect(res.text).toContain('/js/admin-poi-map.js');
    expect(res.text).toContain('id="poi-admin-map"');
    expect(res.text).not.toContain('id="poi-latitude"');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.text).not.toContain('/js/app.js');
  });

  it.each([['/css/admin.css', /text\/css/], ['/js/admin.js', /javascript/], ['/js/admin-poi-map.js', /javascript/]])(
    'Stage 7: serve asset admin %s', async (url, contentType) => {
      const res = await request(app).get(url);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(contentType);
    }
  );

  it.each(['/', '/index.html'])('Stage 6: %s vẫn là WebApp khách có controls GPS/auto/audio', async (url) => {
    const res = await request(app).get(url);
    expect(res.statusCode).toBe(200);
    for (const id of ['start-gps', 'stop-gps', 'simulation-form', 'toggle-tour', 'narration-audio', 'generate-audio']) {
      expect(res.text).toContain(`id="${id}"`);
    }
    expect(res.text).not.toContain('id="tour-simulation"');
    expect(res.text).toContain('/js/app.js');
    expect(res.text).not.toContain('/js/admin.js');
  });

  it('production ẩn công cụ GPS giả lập nhưng vẫn có GPS thật và tham quan', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app).get('/');
      expect(res.statusCode).toBe(200);
      expect(res.text).toMatch(/id="simulation" hidden/);
      expect(res.text).toMatch(/class="button poi-use" hidden/);
      expect(res.text).toContain('id="toggle-tour"');
      expect(res.text).toContain('id="start-gps"');
      expect(res.text).not.toContain('data-development-only');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
