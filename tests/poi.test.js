const request = require('supertest');
const { validate: validateUuid, version: uuidVersion } = require('uuid');
const app = require('../src/app');
const poiRepository = require('../src/repositories/poi.repository');
const poiService = require('../src/services/poi.service');

const validPoi = {
  name: 'Quán ăn Demo',
  description: 'Đây là địa điểm ẩm thực dùng để demo hệ thống.',
  category: 'food',
  address: 'TP. Hồ Chí Minh',
  latitude: 10.123456,
  longitude: 106.123456,
  geofenceRadius: 50,
};

const invalidFields = [
  ['name', ''],
  ['name', '   '],
  ['name', 123],
  ['name', null],
  ['description', ''],
  ['description', '   '],
  ['description', 123],
  ['description', null],
  ['latitude', -90.1],
  ['latitude', 90.1],
  ['latitude', '10.123456'],
  ['latitude', null],
  ['latitude', false],
  ['longitude', -180.1],
  ['longitude', 180.1],
  ['longitude', '106.123456'],
  ['longitude', null],
  ['longitude', false],
  ['geofenceRadius', 0],
  ['geofenceRadius', -1],
  ['geofenceRadius', '50'],
  ['geofenceRadius', null],
  ['category', '   '],
  ['category', 123],
  ['category', null],
  ['address', 123],
  ['address', null],
  ['isActive', 'true'],
  ['isActive', 1],
  ['isActive', null],
];

beforeEach(() => {
  poiRepository.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('POST /api/pois', () => {
  it('tạo POI với UUID v4, đầy đủ dữ liệu và timestamp', async () => {
    const res = await request(app).post('/api/pois').send(validPoi);

    expect(res.statusCode).toBe(201);
    expect(validateUuid(res.body.id)).toBe(true);
    expect(uuidVersion(res.body.id)).toBe(4);
    expect(res.body).toEqual({
      ...validPoi,
      id: expect.any(String),
      isActive: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);
    expect(res.body.updatedAt).toBe(res.body.createdAt);
  });

  it('áp dụng category, address và isActive mặc định khi không truyền', async () => {
    const res = await request(app).post('/api/pois').send({
      name: validPoi.name,
      description: validPoi.description,
      latitude: validPoi.latitude,
      longitude: validPoi.longitude,
      geofenceRadius: validPoi.geofenceRadius,
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ category: 'food', address: '', isActive: true });
  });

  it('chuẩn hóa chuỗi, giữ isActive false và bỏ qua trường ngoài model', async () => {
    const res = await request(app).post('/api/pois').send({
      ...validPoi,
      name: `  ${validPoi.name}  `,
      description: `  ${validPoi.description}  `,
      category: '  cafe  ',
      address: '  TP. Hồ Chí Minh  ',
      isActive: false,
      id: 'client-id',
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
      extra: 'không lưu',
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ ...validPoi, category: 'cafe', isActive: false });
    expect(res.body.id).not.toBe('client-id');
    expect(res.body.createdAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(res.body.updatedAt).toBe(res.body.createdAt);
    expect(res.body).not.toHaveProperty('extra');
  });

  it.each(['name', 'description', 'latitude', 'longitude', 'geofenceRadius'])(
    'trả lỗi 400 khi thiếu %s',
    async (field) => {
      const body = { ...validPoi };
      delete body[field];

      const res = await request(app).post('/api/pois').send(body);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain(field);
      expect(poiRepository.findAll()).toEqual([]);
    }
  );

  it.each(invalidFields)('trả lỗi 400 khi %s = %j', async (field, value) => {
    const res = await request(app).post('/api/pois').send({
      ...validPoi,
      [field]: value,
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain(field);
    expect(poiRepository.findAll()).toEqual([]);
  });

  it.each([[-90, -180], [90, 180], [0, 0]])(
    'chấp nhận tọa độ hợp lệ (%s, %s)',
    async (latitude, longitude) => {
      const res = await request(app).post('/api/pois').send({
        ...validPoi,
        latitude,
        longitude,
        geofenceRadius: 0.5,
      });

      expect(res.statusCode).toBe(201);
      expect(res.body).toMatchObject({ latitude, longitude, geofenceRadius: 0.5 });
    }
  );

  it('trả lỗi 400 khi thiếu request body', async () => {
    const res = await request(app).post('/api/pois');

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it('trả lỗi JSON 400 khi request body là mảng', async () => {
    const res = await request(app).post('/api/pois').send([]);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
  });
});

describe('GET /api/pois', () => {
  it('trả danh sách rỗng khi chưa có POI', async () => {
    const res = await request(app).get('/api/pois');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('trả tất cả POI đã tạo, bao gồm cả POI không hoạt động', async () => {
    const first = await request(app).post('/api/pois').send(validPoi);
    const second = await request(app).post('/api/pois').send({
      ...validPoi, name: 'Quán ăn thứ hai', isActive: false,
    });
    const res = await request(app).get('/api/pois');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([first.body, second.body]);
    expect(first.body.id).not.toBe(second.body.id);
  });
});

describe('GET /api/pois/:id', () => {
  it('lấy đúng POI theo ID', async () => {
    const created = await request(app).post('/api/pois').send(validPoi);
    const res = await request(app).get(`/api/pois/${created.body.id}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(created.body);
  });

  it('trả lỗi 404 khi POI không tồn tại', async () => {
    const res = await request(app).get('/api/pois/khong-ton-tai');

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Không tìm thấy POI' });
  });
});

describe('PUT /api/pois/:id', () => {
  it('cập nhật các trường cho phép và updatedAt, giữ id và createdAt', async () => {
    const created = await request(app).post('/api/pois').send(validPoi);
    const updatedAt = new Date(Date.parse(created.body.updatedAt) + 1000).toISOString();
    jest.spyOn(Date.prototype, 'toISOString').mockReturnValueOnce(updatedAt);

    const changes = {
      name: 'Quán ăn mới',
      description: 'Mô tả mới',
      category: 'cafe',
      address: 'Địa chỉ mới',
      latitude: 0,
      longitude: 0,
      geofenceRadius: 75,
      isActive: false,
    };
    const res = await request(app).put(`/api/pois/${created.body.id}`).send({
      ...changes,
      id: 'client-id',
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
      extra: 'không lưu',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ...created.body, ...changes, updatedAt });
    const fetched = await request(app).get(`/api/pois/${created.body.id}`);
    expect(fetched.body).toEqual(res.body);
  });

  it('cập nhật từng phần, giữ nguyên các trường không được gửi', async () => {
    const created = await request(app).post('/api/pois').send(validPoi);
    const res = await request(app).put(`/api/pois/${created.body.id}`).send({
      name: '  Tên mới  ', address: '',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ...created.body, name: 'Tên mới', address: '', updatedAt: expect.any(String),
    });
  });

  it.each(invalidFields)('trả lỗi 400 khi %s = %j và giữ dữ liệu cũ', async (field, value) => {
    const created = await request(app).post('/api/pois').send(validPoi);
    const res = await request(app).put(`/api/pois/${created.body.id}`).send({
      name: 'Tên không được lưu khi validation lỗi',
      [field]: value,
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain(field);
    const fetched = await request(app).get(`/api/pois/${created.body.id}`);
    expect(fetched.body).toEqual(created.body);
  });

  it('trả lỗi 400 khi request body là mảng', async () => {
    const created = await request(app).post('/api/pois').send(validPoi);
    const res = await request(app).put(`/api/pois/${created.body.id}`).send([]);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
    expect(poiRepository.findById(created.body.id)).toEqual(created.body);
  });

  it('trả lỗi 404 khi POI không tồn tại', async () => {
    const res = await request(app).put('/api/pois/khong-ton-tai').send(validPoi);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Không tìm thấy POI' });
    expect(poiRepository.findAll()).toEqual([]);
  });
});

describe('DELETE /api/pois/:id', () => {
  it('xóa đúng POI, GET lại trả 404 và giữ nguyên POI khác', async () => {
    const created = await request(app).post('/api/pois').send(validPoi);
    const other = await request(app).post('/api/pois').send({
      ...validPoi, name: 'POI khác',
    });
    const res = await request(app).delete(`/api/pois/${created.body.id}`);

    expect(res.statusCode).toBe(204);
    expect(res.text).toBe('');

    const fetched = await request(app).get(`/api/pois/${created.body.id}`);
    expect(fetched.statusCode).toBe(404);
    expect(fetched.body).toEqual({ error: 'Không tìm thấy POI' });

    const list = await request(app).get('/api/pois');
    expect(list.body).toEqual([other.body]);

    const deletedAgain = await request(app).delete(`/api/pois/${created.body.id}`);
    expect(deletedAgain.statusCode).toBe(404);
  });

  it('trả lỗi 404 khi POI không tồn tại', async () => {
    const res = await request(app).delete('/api/pois/khong-ton-tai');

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Không tìm thấy POI' });
  });
});

describe('POI Service: kiểm tra số không hữu hạn không biểu diễn được trong JSON', () => {
  it.each(['latitude', 'longitude', 'geofenceRadius'])(
    'từ chối NaN và Infinity cho %s khi tạo và cập nhật',
    (field) => {
      const created = poiService.createPoi(validPoi);

      for (const value of [NaN, Infinity, -Infinity]) {
        expect(() => poiService.createPoi({ ...validPoi, [field]: value })).toThrow(field);
        expect(() => poiService.updatePoi(created.id, { [field]: value })).toThrow(field);
      }

      expect(poiRepository.findAll()).toEqual([created]);
    }
  );
});
