const supertest = require('supertest');
jest.mock('../src/integrations/geocoding/vietmap', () => ({
  suggest: jest.fn(async () => [{ id: 'b5cc0737-1614-4ff9-a25f-2f8fd29da012', name: 'Địa chỉ thử',
    address: 'Phường thử', display: 'Địa chỉ thử, Phường thử' }]),
  place: jest.fn(async () => ({ latitude: 10, longitude: 106, streetAddress: 'Địa chỉ thử', ward: null, city: null })),
}));
const app = require('../src/app');
const request = require('./helpers/auth-request');
const vietmap = require('../src/integrations/geocoding/vietmap');

test('gợi ý yêu cầu phiên Admin/POI_MANAGER và CSRF, không đưa key cho client', async () => {
  const body = { streetAddress: 'Đường thử', ward: '', city: '' };
  expect((await supertest(app).post('/api/admin/geocode/suggest').send(body)).statusCode).toBe(401);
  expect((await supertest(app).post('/api/admin/geocode/suggest')
    .set('Cookie', request.fixture().cookie).send(body)).statusCode).toBe(403);
  const response = await request(app).post('/api/admin/geocode/suggest').send(body);
  expect(response.statusCode).toBe(200);
  expect(response.body.results).toHaveLength(1);
  expect(JSON.stringify(response.body)).not.toContain('apikey');
  expect(vietmap.suggest).toHaveBeenCalledWith(body);
});

test('đầu vào không hợp lệ không gọi provider', async () => {
  vietmap.suggest.mockClear();
  const response = await request(app).post('/api/admin/geocode/suggest').send({ streetAddress: 'A' });
  expect(response.statusCode).toBe(400);
  expect(vietmap.suggest).not.toHaveBeenCalled();
  vietmap.place.mockClear();
  expect((await request(app).post('/api/admin/geocode/place').send({ id: '../x' })).statusCode).toBe(400);
  expect(vietmap.place).not.toHaveBeenCalled();
});

test('Place trả tọa độ đã lọc, lỗi cấu hình không tiết lộ chi tiết', async () => {
  const id = 'b5cc0737-1614-4ff9-a25f-2f8fd29da012';
  const response = await request(app).post('/api/admin/geocode/place').send({ id });
  expect(response.statusCode).toBe(200);
  expect(response.body).toEqual({ latitude: 10, longitude: 106, streetAddress: 'Địa chỉ thử', ward: null, city: null });
  vietmap.suggest.mockRejectedValueOnce(Object.assign(new Error('Chưa cấu hình VIETMAP.'),
    { code: 'GEOCODE_NOT_CONFIGURED', statusCode: 503 }));
  const unavailable = await request(app).post('/api/admin/geocode/suggest').send({ streetAddress: 'Đường thử' });
  expect(unavailable.statusCode).toBe(503);
  expect(unavailable.body.code).toBe('GEOCODE_NOT_CONFIGURED');
});
