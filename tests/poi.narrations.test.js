jest.mock('../src/integrations/translation/translation.provider', () => ({ translate: jest.fn() }));

const request = require('supertest');
const app = require('../src/app');
const poiRepository = require('../src/repositories/poi.repository');
const poiService = require('../src/services/poi.service');
const provider = require('../src/integrations/translation/translation.provider');

const vietnamese = 'Phở là một món ăn truyền thống của Việt Nam.';
// Fixtures chỉ dùng trong test; production luôn gọi provider được cấu hình.
const translated = { en: 'English test text', ja: '日本語のテスト', ko: '한국어 테스트' };
let poi;
const base = () => `/api/pois/${poi.id}`;
const saveSource = () => poiService.setVietnameseNarration(poi.id, { text: vietnamese });

beforeEach(() => {
  poiRepository.clear();
  provider.translate.mockReset().mockImplementation(async (text, source, target) => ({ text: translated[target] }));
  poi = poiService.createPoi({
    name: 'Phở Việt Nam', description: 'Mô tả ngắn', latitude: 10, longitude: 106, geofenceRadius: 50,
  });
});

describe('POI narrations API', () => {
  it('lưu VI đã trim, trả timestamp và giữ description riêng', async () => {
    const res = await request(app).put(`${base()}/narrations/vi`).send({ text: `  ${vietnamese}\n` });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ poiId: poi.id, language: 'vi', text: vietnamese, updatedAt: expect.any(String) });
    expect(new Date(res.body.updatedAt).toISOString()).toBe(res.body.updatedAt);
    expect(poiRepository.findById(poi.id)).toMatchObject({ description: 'Mô tả ngắn', narrations: { vi: { text: vietnamese } } });
  });

  it.each([{}, { text: '' }, { text: ' \n ' }, { text: 12 }, { text: null }, { text: [] }])(
    'từ chối nội dung VI không hợp lệ: %j', async (body) => {
      const res = await request(app).put(`${base()}/narrations/vi`).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('text');
      expect(poiRepository.findById(poi.id).narrations).toBeUndefined();
    }
  );

  it.each([
    ['put', '/narrations/vi', { text: vietnamese }],
    ['get', '/narrations/vi', undefined],
    ['get', '/narrations', undefined],
    ['post', '/translations', { targetLanguages: ['en'] }],
  ])('POI không tồn tại: %s %s trả 404', async (method, suffix, body) => {
    const res = await request(app)[method](`/api/pois/missing${suffix}`).send(body);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('POI');
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it('GET VI đúng nội dung; GET all trước và sau khi lưu', async () => {
    const empty = await request(app).get(`${base()}/narrations`);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ poiId: poi.id, narrations: {} });
    saveSource();
    const res = await request(app).get(`${base()}/narrations/vi`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ poiId: poi.id, language: 'vi', text: vietnamese });
    const all = await request(app).get(`${base()}/narrations`);
    expect(all.body.narrations).toEqual({ vi: { text: vietnamese } });
  });

  it('ngôn ngữ chưa có trả JSON 404', async () => {
    saveSource();
    const res = await request(app).get(`${base()}/narrations/ja`);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Chưa có nội dung');
  });

  it.each(['fr', 'EN', 'constructor', '__proto__'])('không hỗ trợ %s trả 400', async (language) => {
    const res = await request(app).get(`${base()}/narrations/${language}`);
    expect(res.status).toBe(400);
  });

  it.each(['en', 'ja', 'ko'])('dịch VI sang %s qua provider và đọc lại', async (language) => {
    saveSource();
    const res = await request(app).post(`${base()}/translations`).send({ targetLanguages: [language] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ poiId: poi.id, sourceLanguage: 'vi', translations: { [language]: { text: translated[language] } } });
    expect(provider.translate).toHaveBeenCalledWith(vietnamese, 'vi', language);
    const get = await request(app).get(`${base()}/narrations/${language}`);
    expect(get.status).toBe(200);
    expect(get.body).toEqual({ poiId: poi.id, language, text: translated[language] });
  });

  it('dịch EN/JA/KO cùng request, trim kết quả và GET all đủ bốn ngôn ngữ', async () => {
    saveSource();
    provider.translate.mockImplementation(async (text, source, target) => ({ text: ` ${translated[target]}\n` }));
    const res = await request(app).post(`${base()}/translations`).send({ targetLanguages: ['en', 'ja', 'ko'] });
    expect(res.status).toBe(200);
    expect(provider.translate).toHaveBeenCalledTimes(3);
    const all = await request(app).get(`${base()}/narrations`);
    expect(all.body.narrations).toEqual({
      vi: { text: vietnamese }, en: { text: translated.en }, ja: { text: translated.ja }, ko: { text: translated.ko },
    });
  });

  it.each([undefined, [], 'en', ['fr'], ['vi'], ['en', 'vi'], ['en', 'en'], [null], ['constructor']])(
    'targetLanguages không hợp lệ: %j', async (targets) => {
      saveSource();
      const res = await request(app).post(`${base()}/translations`).send({ targetLanguages: targets });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('targetLanguages');
      expect(provider.translate).not.toHaveBeenCalled();
    }
  );

  it('thiếu VI trả 400 trước khi gọi provider', async () => {
    const res = await request(app).post(`${base()}/translations`).send({ targetLanguages: ['en'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('tiếng Việt');
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it.each([[undefined, 502], [502, 502], [503, 503], [504, 504], [418, 502]])(
    'provider status %s thành HTTP %s, không rò thông báo/secret', async (statusCode, expected) => {
      saveSource();
      provider.translate.mockRejectedValue(Object.assign(new Error('SECRET-provider-url-and-key'), { statusCode }));
      const res = await request(app).post(`${base()}/translations`).send({ targetLanguages: ['en'] });
      expect(res.status).toBe(expected);
      expect(res.body.error).toEqual(expect.any(String));
      expect(JSON.stringify(res.body)).not.toContain('SECRET');
      expect(poiRepository.findById(poi.id).narrations).toEqual({ vi: { text: vietnamese } });
    }
  );

  it.each([null, {}, { text: '' }, { text: ' \n ' }, { text: 1 }])('provider trả nội dung sai %j', async (result) => {
    saveSource();
    provider.translate.mockResolvedValue(result);
    const res = await request(app).post(`${base()}/translations`).send({ targetLanguages: ['en'] });
    expect(res.status).toBe(502);
    expect(poiRepository.findById(poi.id).narrations.en).toBeUndefined();
  });

  it('atomic: JA lỗi thì không ghi đè EN cũ hoặc lưu KO thành công của request đó', async () => {
    saveSource();
    await poiService.createTranslations(poi.id, { targetLanguages: ['en'] });
    const before = JSON.parse(JSON.stringify(poiRepository.findById(poi.id)));
    let finishKorean;
    provider.translate.mockImplementation(async (text, source, target) => {
      if (target === 'ja') throw new Error('Provider unavailable');
      if (target === 'ko') return new Promise((resolve) => { finishKorean = resolve; });
      return { text: 'New EN must not be saved' };
    });
    const res = await request(app).post(`${base()}/translations`).send({ targetLanguages: ['en', 'ja', 'ko'] });
    expect(res.status).toBe(502);
    finishKorean({ text: 'Late KO must not be saved' });
    await Promise.resolve();
    expect(poiRepository.findById(poi.id)).toEqual(before);
  });

  it('gửi lại VI không đổi giữ bản dịch; VI đổi xóa bản dịch cũ', async () => {
    saveSource();
    await poiService.createTranslations(poi.id, { targetLanguages: ['en'] });
    saveSource();
    expect(poiRepository.findById(poi.id).narrations.en.text).toBe(translated.en);
    await request(app).put(`${base()}/narrations/vi`).send({ text: 'Nguồn mới' }).expect(200);
    expect(poiRepository.findById(poi.id).narrations).toEqual({ vi: { text: 'Nguồn mới' } });
  });

  it('nguồn thay đổi trong lúc dịch: 409, không lưu bản dịch cũ', async () => {
    saveSource();
    let finish;
    provider.translate.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = poiService.createTranslations(poi.id, { targetLanguages: ['en'] });
    poiService.setVietnameseNarration(poi.id, { text: 'Nguồn mới' });
    finish({ text: 'Old translation' });
    await expect(pending).rejects.toMatchObject({ statusCode: 409 });
    expect(poiRepository.findById(poi.id).narrations).toEqual({ vi: { text: 'Nguồn mới' } });
  });

  it('POI bị xóa lúc dịch: 404, không khôi phục POI', async () => {
    saveSource();
    let finish;
    provider.translate.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = poiService.createTranslations(poi.id, { targetLanguages: ['en'] });
    poiService.deletePoi(poi.id);
    finish({ text: 'Result' });
    await expect(pending).rejects.toMatchObject({ statusCode: 404 });
    expect(poiRepository.findById(poi.id)).toBeFalsy();
  });

  it('hai request khác ngôn ngữ giữ kết quả của nhau và giữ sửa đổi CRUD', async () => {
    saveSource();
    const finishes = {};
    provider.translate.mockImplementation((text, source, language) => new Promise((resolve) => { finishes[language] = resolve; }));
    const english = poiService.createTranslations(poi.id, { targetLanguages: ['en'] });
    const japanese = poiService.createTranslations(poi.id, { targetLanguages: ['ja'] });
    poiService.updatePoi(poi.id, { name: 'Tên mới' });
    finishes.ja({ text: translated.ja });
    await japanese;
    finishes.en({ text: translated.en });
    await english;
    expect(poiRepository.findById(poi.id)).toMatchObject({
      name: 'Tên mới', narrations: { vi: { text: vietnamese }, en: { text: translated.en }, ja: { text: translated.ja } },
    });
  });

  it('route nearby, CRUD và WebApp vẫn đúng sau khi bổ sung narration', async () => {
    saveSource();
    const nearby = await request(app).get('/api/pois/nearby?lat=10&lng=106');
    expect(nearby.status).toBe(200);
    expect(nearby.body.nearestPoi.id).toBe(poi.id);
    expect(nearby.body.insideGeofence).toBe(true);
    await request(app).get(base()).expect(200);
    await request(app).put(base()).send({ description: 'Mô tả cập nhật' }).expect(200);
    expect(poiRepository.findById(poi.id).narrations.vi.text).toBe(vietnamese);
    await request(app).get('/').expect(200).expect(/js\/poi-languages.js/);
    await request(app).get('/js/poi-languages.js').expect(200).expect(/sourceLanguage/);
    await request(app).delete(base()).expect(204);
    await request(app).get(base()).expect(404);
  });
});
