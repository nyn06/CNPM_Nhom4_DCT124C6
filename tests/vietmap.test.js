const sample = { ref_id: 'auto:ABC_123', name: '123 Đường thử', address: 'Phường thử, Hồ Chí Minh',
  display: '123 Đường thử, Phường thử, Hồ Chí Minh' };

describe('VIETMAP server adapter', () => {
  let vietmap;
  const originalKey = process.env.VIETMAP_API_KEY;
  beforeEach(() => {
    jest.resetModules();
    process.env.VIETMAP_API_KEY = 'fixture-service-key';
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [sample] }));
    vietmap = require('../src/integrations/geocoding/vietmap');
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.VIETMAP_API_KEY;
    else process.env.VIETMAP_API_KEY = originalKey;
    delete global.fetch;
  });

  test('Autocomplete v4 dùng display_type=5, lọc response, cache và không trả key/ref_id', async () => {
    const query = { streetAddress: '123 Đường thử', ward: 'Phường thử', city: 'Hồ Chí Minh' };
    const first = await vietmap.suggest(query);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ name: sample.name, address: sample.address, display: sample.display });
    expect(first[0]).not.toHaveProperty('ref_id');
    expect(JSON.stringify(first)).not.toContain('fixture-service-key');
    expect(await vietmap.suggest(query)).toEqual(first);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = global.fetch.mock.calls[0][0];
    expect(url.pathname).toBe('/api/autocomplete/v4');
    expect(url.searchParams.get('display_type')).toBe('5');
    expect(url.searchParams.get('text')).toContain('Phường thử');
  });

  test('Place v4 dùng refid nguyên vẹn, chỉ ánh xạ thành phần provider xác nhận', async () => {
    const [item] = await vietmap.suggest({ streetAddress: '123 Đường thử', ward: '', city: '' });
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({
      lat: 10.5, lng: 106.5, address: '123 Đường thử', ward: 'Phường thử', city: 'Hồ Chí Minh',
    }) });
    expect(await vietmap.place(item.id)).toEqual({ latitude: 10.5, longitude: 106.5,
      streetAddress: '123 Đường thử', ward: 'Phường thử', city: 'Hồ Chí Minh' });
    expect(global.fetch.mock.calls[1][0].pathname).toBe('/api/place/v4');
    expect(global.fetch.mock.calls[1][0].searchParams.get('refid')).toBe(sample.ref_id);
    expect(await vietmap.place(item.id)).toMatchObject({ latitude: 10.5, longitude: 106.5 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('Reverse v4 tách địa chỉ đã xác nhận, cache kết quả và không trả key', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => [{
      name: '12 Đường A', distance: 0.01, boundaries: [
        { type: 2, full_name: 'Phường A' }, { type: 0, full_name: 'Thành phố Hồ Chí Minh' },
      ],
    }] });
    const result = await vietmap.reverse(10, 106);
    expect(result).toEqual({ streetAddress: '12 Đường A', ward: 'Phường A', city: 'Thành phố Hồ Chí Minh' });
    expect(await vietmap.reverse(10, 106)).toEqual(result);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = global.fetch.mock.calls[0][0];
    expect(url.pathname).toBe('/api/reverse/v4');
    expect(url.searchParams.get('lat')).toBe('10');
    expect(url.searchParams.get('display_type')).toBe('1');
    expect(JSON.stringify(result)).not.toContain('fixture-service-key');
  });

  test('Reverse giữ tên đường do provider trả về dù thiếu khoảng cách', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => [{
      name: 'Đường thử', boundaries: [{ type: 0, full_name: 'Đà Nẵng' }],
    }] });
    expect(await vietmap.reverse(11, 107)).toEqual({ streetAddress: 'Đường thử', ward: '', city: 'Đà Nẵng' });
  });

  test('Reverse không tạo số nhà/đường khi provider chỉ có địa giới hoặc không có kết quả', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => [{
      name: null, boundaries: [{ type: 2, full_name: 'Phường A' }, { type: 0, full_name: 'Huế' }],
    }] });
    expect(await vietmap.reverse(12, 108)).toEqual({ streetAddress: '', ward: 'Phường A', city: 'Huế' });
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    expect(await vietmap.reverse(13, 109)).toEqual({ streetAddress: '', ward: '', city: '' });
  });

  test('Place giữ số nhà và đường từ gợi ý khi response chỉ có địa giới', async () => {
    const [item] = await vietmap.suggest({ streetAddress: '123 Đường thử', ward: '', city: '' });
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ lat: 10, lng: 106,
      address: 'Phường thử, Thành phố Hồ Chí Minh', ward: 'Phường thử', city: 'Thành phố Hồ Chí Minh' }) });
    expect(await vietmap.place(item.id)).toEqual({ latitude: 10, longitude: 106,
      streetAddress: '123 Đường thử', ward: 'Phường thử', city: 'Thành phố Hồ Chí Minh' });
  });

  test('Place ưu tiên số nhà và tên đường có cấu trúc, kể cả khác tỉnh của gợi ý', async () => {
    const [item] = await vietmap.suggest({ streetAddress: '23 Mạc Đĩnh Chi', ward: '', city: '' });
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ lat: 16, lng: 108,
      house_number: '23', pedestrian: 'Đường Mạc Đĩnh Chi', address: 'Phường Hải Châu, Đà Nẵng',
      ward: 'Phường Hải Châu', city: 'Thành phố Đà Nẵng' }) });
    expect(await vietmap.place(item.id)).toEqual({ latitude: 16, longitude: 108,
      streetAddress: '23 Đường Mạc Đĩnh Chi', ward: 'Phường Hải Châu', city: 'Thành phố Đà Nẵng' });
  });

  test('Place không bịa số nhà khi provider chỉ trả tên đường', async () => {
    const [item] = await vietmap.suggest({ streetAddress: '123 Đường thử', ward: '', city: '' });
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ lat: 10, lng: 106, road: 'Đường Mạc Đĩnh Chi' }) });
    expect(await vietmap.place(item.id)).toMatchObject({ streetAddress: 'Đường Mạc Đĩnh Chi' });
  });

  test('Place lấy số nhà từ nhãn gợi ý khi tên đường khớp với provider', async () => {
    const [item] = await vietmap.suggest({ streetAddress: '123 Đường thử', ward: '', city: '' });
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ lat: 10, lng: 106, road: 'Đường thử',
      address: 'Phường thử, Thành phố Hồ Chí Minh' }) });
    expect(await vietmap.place(item.id)).toMatchObject({ streetAddress: '123 Đường thử' });
  });

  test('thiếu key trả trạng thái cấu hình, không gọi provider', async () => {
    delete process.env.VIETMAP_API_KEY;
    await expect(vietmap.suggest({ streetAddress: 'Đường thử', ward: '', city: '' }))
      .rejects.toMatchObject({ code: 'GEOCODE_NOT_CONFIGURED', statusCode: 503 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test.each([[401, 'GEOCODE_AUTH'], [403, 'GEOCODE_AUTH'], [423, 'GEOCODE_QUOTA'], [429, 'GEOCODE_QUOTA']])(
    'provider HTTP %s được ánh xạ an toàn', async (status, code) => {
      global.fetch.mockResolvedValueOnce({ ok: false, status });
      await expect(vietmap.suggest({ streetAddress: 'Đường thử', ward: '', city: '' }))
        .rejects.toMatchObject({ code, statusCode: 503 });
    }
  );

  test('lỗi mạng không tiết lộ dữ liệu provider', async () => {
    global.fetch.mockRejectedValueOnce(new Error('private upstream URL'));
    await expect(vietmap.suggest({ streetAddress: 'Đường thử', ward: '', city: '' }))
      .rejects.toMatchObject({ code: 'GEOCODE_NETWORK', statusCode: 503 });
  });

  test('Place từ chối tọa độ provider không hợp lệ', async () => {
    const [item] = await vietmap.suggest({ streetAddress: 'Đường thử', ward: '', city: '' });
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ lat: null, lng: 106 }) });
    await expect(vietmap.place(item.id)).rejects.toMatchObject({ code: 'GEOCODE_PROVIDER' });
  });

  test('giới hạn tốc độ tổng theo tiến trình backend', async () => {
    global.fetch.mockImplementation(async () => ({ ok: true, json: async () => [] }));
    for (let index = 0; index < 60; index++) {
      await vietmap.suggest({ streetAddress: `Đường ${index}`, ward: '', city: '' });
    }
    await expect(vietmap.suggest({ streetAddress: 'Vượt giới hạn', ward: '', city: '' }))
      .rejects.toMatchObject({ code: 'GEOCODE_RATE_LIMIT', statusCode: 429 });
    expect(global.fetch).toHaveBeenCalledTimes(60);
  });
});
