const { calculateDistanceInMeters } = require('../src/utils/geo');

describe('Haversine: khoảng cách tính bằng mét', () => {
  it('hai tọa độ giống nhau có khoảng cách bằng 0', () => {
    expect(calculateDistanceInMeters(10.123456, 106.123456, 10.123456, 106.123456)).toBe(0);
  });

  it('hai điểm gần nhau trên xích đạo cách khoảng 11.12 m', () => {
    expect(calculateDistanceInMeters(0, 0, 0, 0.0001)).toBeCloseTo(11.11949, 4);
  });

  it('một độ kinh tuyến trên xích đạo tương ứng khoảng 111.195 km', () => {
    expect(calculateDistanceInMeters(0, 0, 0, 1)).toBeCloseTo(111194.92664, 4);
  });

  it('London đến New York cách khoảng 5570.22 km', () => {
    const distance = calculateDistanceInMeters(51.5074, -0.1278, 40.7128, -74.006);

    expect(distance).toBeCloseTo(5570222.18, 1);
    expect(calculateDistanceInMeters(40.7128, -74.006, 51.5074, -0.1278))
      .toBeCloseTo(distance, 6);
  });

  it('xử lý khoảng cách ngắn qua kinh tuyến 180 độ', () => {
    expect(calculateDistanceInMeters(0, 179.999, 0, -179.999)).toBeCloseTo(222.38985, 4);
  });

  it('kinh độ khác nhau ở cùng cực Bắc vẫn có khoảng cách gần 0', () => {
    expect(calculateDistanceInMeters(90, 0, 90, 180)).toBeCloseTo(0, 6);
  });

  it.each([[0, 0, 0, 180], [45, 30, -45, -150], [-89.999, 0, 89.999, 179.999999]])(
    'khoảng cách giữa hai điểm đối cực hoặc gần đối cực luôn hữu hạn: %j, %j, %j, %j',
    (latitude1, longitude1, latitude2, longitude2) => {
      const distance = calculateDistanceInMeters(latitude1, longitude1, latitude2, longitude2);

      expect(Number.isFinite(distance)).toBe(true);
      expect(distance).toBeGreaterThan(20015085);
      expect(distance).toBeLessThanOrEqual(20015087);
    }
  );
});
