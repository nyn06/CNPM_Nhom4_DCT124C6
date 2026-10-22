describe('Nominatim public search', () => {
  let searchAddress;
  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [{ display_name: 'Địa chỉ thử', lat: '10', lon: '106' }] }));
    ({ searchAddress } = require('../src/integrations/geocoding/nominatim'));
  });
  afterEach(() => { delete global.fetch; jest.restoreAllMocks(); });

  test('chỉ gọi Nominatim cho địa chỉ Việt Nam, cache truy vấn lặp và lọc kết quả', async () => {
    const input = { streetAddress: 'Đường thử', ward: 'Phường thử', city: 'Hồ Chí Minh' };
    expect(await searchAddress(input)).toEqual([{ label: 'Địa chỉ thử', latitude: 10, longitude: 106 }]);
    expect(await searchAddress(input)).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = global.fetch.mock.calls[0][0];
    expect(url.searchParams.get('countrycodes')).toBe('vn');
    expect(url.searchParams.get('q')).toContain('Việt Nam');
    expect(global.fetch.mock.calls[0][1].headers['User-Agent']).toContain('AutoNarrationDemo');
  });

  test('đặt khoảng cách tối thiểu giữa các yêu cầu tới nhà cung cấp', async () => {
    const sleep = jest.spyOn(global, 'setTimeout').mockImplementation((callback) => { callback(); return 1; });
    await searchAddress({ streetAddress: 'A', ward: 'B', city: 'C' });
    await searchAddress({ streetAddress: 'D', ward: 'B', city: 'C' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.some(([, delay]) => delay >= 1000)).toBe(true);
  });

  test('lỗi provider không làm lộ response và không lưu kết quả lỗi', async () => {
    global.fetch.mockRejectedValueOnce(new Error('upstream details'));
    await expect(searchAddress({ streetAddress: 'A', ward: 'B', city: 'C' })).rejects.toMatchObject({ statusCode: 503 });
  });
});
