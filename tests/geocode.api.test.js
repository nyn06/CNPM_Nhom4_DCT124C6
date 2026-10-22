const supertest = require('supertest');
jest.mock('../src/integrations/geocoding/nominatim', () => ({ searchAddress: jest.fn(async () => [{ label: 'Kết quả thử', latitude: 10, longitude: 106 }]) }));
const app = require('../src/app');
const request = require('./helpers/auth-request');
const { searchAddress } = require('../src/integrations/geocoding/nominatim');
const vietmap = require('../src/integrations/geocoding/vietmap');

test('reverse công khai kiểm tra tọa độ và chỉ trả thành phần địa chỉ', async () => {
  const reverse = jest.spyOn(vietmap, 'reverse').mockResolvedValue({ streetAddress: 'Đường A', ward: 'Phường A', city: 'Huế' });
  try {
    expect((await supertest(app).get('/api/geocode/reverse?lat=91&lng=106')).statusCode).toBe(400);
    const response = await supertest(app).get('/api/geocode/reverse?lat=10&lng=106');
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ streetAddress: 'Đường A', ward: 'Phường A', city: 'Huế' });
    expect(reverse).toHaveBeenCalledWith(10, 106);
  } finally { reverse.mockRestore(); }
});

test('geocoding chỉ dành cho Admin có phiên và CSRF hợp lệ', async () => {
  const body = { streetAddress: 'Đường thử', ward: 'Phường thử', city: 'Hồ Chí Minh' };
  expect((await supertest(app).post('/api/admin/geocode').send(body)).statusCode).toBe(401);
  expect((await supertest(app).post('/api/admin/geocode').set('Cookie', request.fixture().cookie).send(body)).statusCode).toBe(403);
  const response = await request(app).post('/api/admin/geocode').send(body);
  expect(response.statusCode).toBe(200);
  expect(response.body.results).toEqual([{ label: 'Kết quả thử', latitude: 10, longitude: 106 }]);
  expect(searchAddress).toHaveBeenCalledWith(body);
});

test('không gửi truy vấn thiếu trường đến Nominatim', async () => {
  searchAddress.mockClear();
  expect((await request(app).post('/api/admin/geocode').send({ streetAddress: 'Đường thử' })).statusCode).toBe(400);
  expect(searchAddress).not.toHaveBeenCalled();
});
