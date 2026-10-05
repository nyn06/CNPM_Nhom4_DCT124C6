const request = require('supertest');
const app = require('../src/app');
const poiRepository = require('../src/repositories/poi.repository');
const { calculateDistanceInMeters } = require('../src/utils/geo');

const validPoi = {
  name: 'Quán ăn Demo',
  description: 'Địa điểm ẩm thực để kiểm tra geofence.',
  latitude: 10.123456,
  longitude: 106.123456,
  geofenceRadius: 50,
};

async function createPoi(changes = {}) {
  const res = await request(app).post('/api/pois').send({ ...validPoi, ...changes });
  expect(res.statusCode).toBe(201);
  return res.body;
}

beforeEach(() => {
  poiRepository.clear();
});

describe('GET /api/pois/nearby: validation GPS', () => {
  it('trả JSON 400 khi thiếu cả lat và lng, không hiểu nearby là :id', async () => {
    const res = await request(app).get('/api/pois/nearby');

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('lat');
  });

  describe.each(['lat', 'lng'])('%s', (field) => {
    it.each([
      undefined, '', '   ', 'abc', '12abc', '10,2', 'NaN',
      'Infinity', '-Infinity', '1e309', '0x10', '0b10', '0o10',
      'true', 'null', ['10', '11'], { value: '10' },
    ])('trả lỗi 400 cho giá trị thiếu hoặc sai: %j', async (value) => {
      const res = await request(app).get('/api/pois/nearby').query({
        lat: '0', lng: '0', [field]: value,
      });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain(field);
    });
  });

  it.each([
    ['lat', '-90.0001'], ['lat', '90.0001'],
    ['lng', '-180.0001'], ['lng', '180.0001'],
  ])('trả lỗi 400 khi %s nằm ngoài phạm vi: %s', async (field, value) => {
    const res = await request(app).get('/api/pois/nearby').query({
      lat: '0', lng: '0', [field]: value,
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain(field);
  });

  it.each([
    'lat=0&lat=0&lng=0',
    'lat=0&lng=0&lng=0',
    'lat[]=0&lng=0',
    'lat=0&lng[]=0',
    'lat[value]=0&lng=0',
    'lat=0&lng[value]=0',
  ])('không ép query trùng lặp, mảng hoặc object thành số: %s', async (query) => {
    const res = await request(app).get(`/api/pois/nearby?${query}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it.each([
    ['0', '0', 0, 0],
    ['-90', '-180', -90, -180],
    ['90', '180', 90, 180],
    [' 10.1234 ', ' 106.1234 ', 10.1234, 106.1234],
    ['1.01234e1', '1.061234e2', 10.1234, 106.1234],
  ])('chấp nhận GPS hợp lệ (%s, %s), trả tọa độ kiểu number', async (lat, lng, latitude, longitude) => {
    const res = await request(app).get('/api/pois/nearby').query({ lat, lng });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      userLocation: { latitude, longitude },
      insideGeofence: false,
      nearestPoi: null,
      pois: [],
    });
  });
});

describe('GET /api/pois/nearby: geofence', () => {
  it('cùng tọa độ: distance = 0, nearestPoi là phần tử đầu tiên và giữ dữ liệu CRUD', async () => {
    const poi = await createPoi();
    const res = await request(app).get('/api/pois/nearby').query({
      lat: poi.latitude, lng: poi.longitude,
    });
    const expectedPoi = { ...poi, distance: 0, insideGeofence: true };

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      userLocation: { latitude: poi.latitude, longitude: poi.longitude },
      insideGeofence: true,
      nearestPoi: expectedPoi,
      pois: [expectedPoi],
    });

    const fetched = await request(app).get(`/api/pois/${poi.id}`);
    const list = await request(app).get('/api/pois');
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body).toEqual(poi);
    expect(list.body).toEqual([poi]);
    expect(poiRepository.findById(poi.id)).not.toHaveProperty('distance');
    expect(poiRepository.findById(poi.id)).not.toHaveProperty('insideGeofence');
  });

  it('trả POI khi ở gần trong bán kính 50 m, distance theo mét làm tròn 2 chữ số', async () => {
    const poi = await createPoi();
    const res = await request(app).get('/api/pois/nearby').query({
      lat: '10.1234', lng: '106.1234',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.insideGeofence).toBe(true);
    expect(res.body.pois).toHaveLength(1);
    expect(res.body.nearestPoi.id).toBe(poi.id);
    expect(res.body.nearestPoi.distance).toBeGreaterThan(8);
    expect(res.body.nearestPoi.distance).toBeLessThan(10);
    expect(res.body.nearestPoi.distance).toBe(Number(res.body.nearestPoi.distance.toFixed(2)));
  });

  it('không trả POI ở ngoài geofence dù đó là POI gần nhất trong database', async () => {
    await createPoi();
    const res = await request(app).get('/api/pois/nearby').query({ lat: '0', lng: '0' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      userLocation: { latitude: 0, longitude: 0 },
      insideGeofence: false,
      nearestPoi: null,
      pois: [],
    });
  });

  it('dùng bán kính riêng của từng POI', async () => {
    await createPoi({ latitude: 0, longitude: 0.001, geofenceRadius: 50 });
    const larger = await createPoi({ latitude: 0, longitude: 0.001, geofenceRadius: 150 });
    const res = await request(app).get('/api/pois/nearby').query({ lat: '0', lng: '0' });

    expect(res.statusCode).toBe(200);
    expect(res.body.pois.map((poi) => poi.id)).toEqual([larger.id]);
    expect(res.body.nearestPoi.distance).toBe(111.19);
  });

  it('chỉ có POI inactive thì không kích hoạt dù cùng tọa độ', async () => {
    const poi = await createPoi({ isActive: false });
    const res = await request(app).get('/api/pois/nearby').query({
      lat: poi.latitude, lng: poi.longitude,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ insideGeofence: false, nearestPoi: null, pois: [] });
  });

  it('bỏ qua POI inactive gần hơn và chọn POI active hợp lệ', async () => {
    await createPoi({ latitude: 0, longitude: 0, isActive: false });
    const active = await createPoi({ latitude: 0, longitude: 0.0001 });
    const res = await request(app).get('/api/pois/nearby').query({ lat: '0', lng: '0' });

    expect(res.statusCode).toBe(200);
    expect(res.body.pois.map((poi) => poi.id)).toEqual([active.id]);
    expect(res.body.nearestPoi.id).toBe(active.id);
  });

  it('sắp xếp nhiều POI theo khoảng cách và chọn đúng POI gần nhất', async () => {
    const farthest = await createPoi({ latitude: 0, longitude: 0.00027 });
    const closest = await createPoi({ latitude: 0, longitude: 0.00009 });
    const middle = await createPoi({ latitude: 0, longitude: 0.00018 });
    const res = await request(app).get('/api/pois/nearby').query({ lat: '0', lng: '0' });

    expect(res.statusCode).toBe(200);
    expect(res.body.insideGeofence).toBe(true);
    expect(res.body.pois.map((poi) => poi.id)).toEqual([closest.id, middle.id, farthest.id]);
    expect(res.body.pois.map((poi) => poi.distance)).toEqual([10.01, 20.02, 30.02]);
    expect(res.body.pois.every((poi) => poi.insideGeofence === true)).toBe(true);
    expect(res.body.nearestPoi).toEqual(res.body.pois[0]);
  });

  it('sắp xếp bằng khoảng cách thật khi các giá trị làm tròn bằng nhau', async () => {
    const farther = await createPoi({ latitude: 0, longitude: 10.004 / 6371000 * 180 / Math.PI });
    const closer = await createPoi({ latitude: 0, longitude: 10.001 / 6371000 * 180 / Math.PI });
    const res = await request(app).get('/api/pois/nearby').query({ lat: '0', lng: '0' });

    expect(res.statusCode).toBe(200);
    expect(res.body.pois.map((poi) => poi.distance)).toEqual([10, 10]);
    expect(res.body.pois.map((poi) => poi.id)).toEqual([closer.id, farther.id]);
    expect(res.body.nearestPoi.id).toBe(closer.id);
  });

  it('distance bằng đúng bán kính vẫn nằm trong geofence', async () => {
    // Dùng cùng phép đo để kiểm tra riêng điều kiện <= tại đúng ranh giới.
    const radius = calculateDistanceInMeters(0, 0, 0, 1);
    const poi = await createPoi({ latitude: 0, longitude: 1, geofenceRadius: radius });
    const res = await request(app).get('/api/pois/nearby').query({ lat: '0', lng: '0' });

    expect(res.statusCode).toBe(200);
    expect(res.body.insideGeofence).toBe(true);
    expect(res.body.nearestPoi.id).toBe(poi.id);
  });

  it.each([[50.004, 50, false], [49.996, 49.997, true]])(
    'không làm tròn trước khi so sánh: distance %s m, radius %s m, inside %s',
    async (distance, radius, inside) => {
      const poi = await createPoi({
        latitude: 0,
        longitude: distance / 6371000 * 180 / Math.PI,
        geofenceRadius: radius,
      });
      const res = await request(app).get('/api/pois/nearby').query({ lat: '0', lng: '0' });

      expect(res.statusCode).toBe(200);
      expect(res.body.insideGeofence).toBe(inside);
      expect(res.body.pois).toHaveLength(inside ? 1 : 0);
      expect(res.body.nearestPoi).toEqual(inside
        ? { ...poi, distance: 50, insideGeofence: true }
        : null);
    }
  );

  it('phản ánh thay đổi isActive và xóa POI qua CRUD ngay ở request tiếp theo', async () => {
    const poi = await createPoi();
    const location = { lat: poi.latitude, lng: poi.longitude };
    const disabled = await request(app).put(`/api/pois/${poi.id}`).send({ isActive: false });
    expect(disabled.statusCode).toBe(200);
    const afterDisable = await request(app).get('/api/pois/nearby').query(location);
    expect(afterDisable.body.pois).toEqual([]);

    const enabled = await request(app).put(`/api/pois/${poi.id}`).send({ isActive: true });
    expect(enabled.statusCode).toBe(200);
    const afterEnable = await request(app).get('/api/pois/nearby').query(location);
    expect(afterEnable.body.nearestPoi.id).toBe(poi.id);

    const removed = await request(app).delete(`/api/pois/${poi.id}`);
    expect(removed.statusCode).toBe(204);
    const afterDelete = await request(app).get('/api/pois/nearby').query(location);
    expect(afterDelete.body).toMatchObject({ insideGeofence: false, nearestPoi: null, pois: [] });
  });
});
