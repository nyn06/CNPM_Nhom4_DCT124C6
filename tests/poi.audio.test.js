jest.mock('../src/integrations/tts/piperTts.provider', () => ({ synthesize: jest.fn() }));
jest.mock('../src/integrations/translation/translation.provider', () => ({ translate: jest.fn() }));

const request = require('supertest');
const app = require('../src/app');
const poiService = require('../src/services/poi.service');
const poiRepository = require('../src/repositories/poi.repository');
const narrationService = require('../src/services/narration.service');
const narrationRepository = require('../src/repositories/narration.repository');
const piper = require('../src/integrations/tts/piperTts.provider');
const translator = require('../src/integrations/translation/translation.provider');

const texts = { vi: 'Phở Việt Nam.', en: 'English test text.', ja: '日本語のテスト。', ko: '한국어 테스트.' };
let poi;
const base = () => `/api/pois/${poi.id}/narrations`;
const createAudio = (language) => request(app).post(`${base()}/${language}/audio`);

beforeEach(async () => {
  poiRepository.clear();
  narrationRepository.clear();
  piper.synthesize.mockReset().mockImplementation(async (text, language) => `narration_${language}_test.wav`);
  translator.translate.mockReset().mockImplementation(async (text, source, target) => ({ text: texts[target] }));
  poi = poiService.createPoi({ name: 'Phở Việt Nam', description: 'Mô tả ngắn', latitude: 10, longitude: 106, geofenceRadius: 50 });
  poiService.setVietnameseNarration(poi.id, { text: texts.vi });
  await poiService.createTranslations(poi.id, { targetLanguages: ['en', 'ja', 'ko'] });
  translator.translate.mockClear();
});

describe('Stage 5: POI audio', () => {
  it.each(['vi', 'en', 'ja', 'ko'])('tạo WAV %s từ text đã lưu, đúng metadata và timestamp', async (language) => {
    const before = JSON.parse(JSON.stringify(poiRepository.findById(poi.id)));
    const res = await createAudio(language).send({ text: 'Không được dùng text từ request' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      poiId: poi.id, language, text: texts[language], audioFile: `narration_${language}_test.wav`,
      audioUrl: `/audio/narration_${language}_test.wav`, updatedAt: expect.any(String),
    });
    expect(new Date(res.body.updatedAt).toISOString()).toBe(res.body.updatedAt);
    expect(piper.synthesize).toHaveBeenCalledTimes(1);
    expect(piper.synthesize).toHaveBeenCalledWith(texts[language], language);
    const updated = poiRepository.findById(poi.id);
    expect(updated.narrations[language]).toEqual({ text: texts[language], audioFile: res.body.audioFile });
    expect(updated.narrations[language]).not.toHaveProperty('audioUrl');
    for (const other of Object.keys(texts).filter((code) => code !== language)) {
      expect(updated.narrations[other]).toEqual(before.narrations[other]);
    }
    expect(updated.description).toBe(before.description);
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it.each(['fr', 'VI', 'constructor', '__proto__'])('ngôn ngữ %s trả 400 trước Piper', async (language) => {
    const res = await createAudio(language);
    expect(res.status).toBe(400);
    expect(piper.synthesize).not.toHaveBeenCalled();
  });

  it('POI không có trả 404 trước Piper', async () => {
    const res = await request(app).post('/api/pois/missing/narrations/vi/audio');
    expect(res.status).toBe(404);
    expect(piper.synthesize).not.toHaveBeenCalled();
  });

  it('narration chưa có trả 404 trước Piper', async () => {
    const empty = poiService.createPoi({ name: 'Chưa có nội dung', description: 'Demo', latitude: 0, longitude: 0, geofenceRadius: 50 });
    const res = await request(app).post(`/api/pois/${empty.id}/narrations/en/audio`);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Chưa có nội dung');
    expect(piper.synthesize).not.toHaveBeenCalled();
  });

  it.each(['', '  ', null, 42])('text hỏng %j trả 400, không gọi Piper', async (text) => {
    const current = poiRepository.findById(poi.id);
    poiRepository.update(poi.id, { narrations: { ...current.narrations, ja: { text } } });
    const res = await createAudio('ja');
    expect(res.status).toBe(400);
    expect(piper.synthesize).not.toHaveBeenCalled();
  });

  it('Piper failure giữ text, tất cả narration và không expose command/path', async () => {
    const before = JSON.parse(JSON.stringify(poiRepository.findById(poi.id)));
    piper.synthesize.mockRejectedValue(new Error('SECRET exec D:\\private\\piper.exe --model D:\\models\\file.onnx'));
    const res = await createAudio('ko');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Không tạo được audio');
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET|piper\.exe|\.onnx|D:/);
    expect(poiRepository.findById(poi.id)).toEqual(before);
    expect(poiRepository.findById(poi.id).narrations.ko).not.toHaveProperty('audioFile');
  });

  it('Piper failure khi tạo lại giữ audio hiện có', async () => {
    await createAudio('vi').expect(200);
    const before = JSON.parse(JSON.stringify(poiRepository.findById(poi.id)));
    piper.synthesize.mockRejectedValue(new Error('Failed'));
    await createAudio('vi').expect(500);
    expect(poiRepository.findById(poi.id)).toEqual(before);
  });

  it.each([null, '', 'D:\\audio\\file.wav', '/audio/file.wav', '../outside.wav', 'nested/file.wav', 'file.mp3', 'file.wav?key=secret'])(
    'provider không được trả path/filename sai %j', async (filename) => {
      const before = JSON.parse(JSON.stringify(poiRepository.findById(poi.id)));
      piper.synthesize.mockResolvedValue(filename);
      const res = await createAudio('vi');
      expect(res.status).toBe(500);
      if (filename) expect(res.body.error).not.toContain(filename);
      expect(poiRepository.findById(poi.id)).toEqual(before);
    }
  );

  it('GET giữ shape Stage 4 khi chưa có audio, mở rộng khi có audio và GET all phản ánh metadata', async () => {
    const before = await request(app).get(`${base()}/ja`);
    expect(before.body).toEqual({ poiId: poi.id, language: 'ja', text: texts.ja });
    await createAudio('ja').expect(200);
    const res = await request(app).get(`${base()}/ja`);
    expect(res.body).toEqual({
      poiId: poi.id, language: 'ja', text: texts.ja,
      audioFile: 'narration_ja_test.wav', audioUrl: '/audio/narration_ja_test.wav',
    });
    const all = await request(app).get(base());
    expect(all.status).toBe(200);
    expect(all.body.narrations.ja).toEqual({ text: texts.ja, audioFile: 'narration_ja_test.wav' });
    expect(all.body.narrations.en).toEqual({ text: texts.en });
  });

  it('VI khác clear audio VI và translations, VI giống sau trim giữ toàn bộ audio', async () => {
    await createAudio('vi').expect(200);
    await createAudio('en').expect(200);
    const narrations = poiRepository.findById(poi.id).narrations;
    await request(app).put(`${base()}/vi`).send({ text: `  ${texts.vi}\n` }).expect(200);
    expect(poiRepository.findById(poi.id).narrations).toEqual(narrations);
    await request(app).put(`${base()}/vi`).send({ text: 'Nguồn tiếng Việt mới' }).expect(200);
    expect(poiRepository.findById(poi.id).narrations).toEqual({ vi: { text: 'Nguồn tiếng Việt mới' } });
  });

  it('dịch ra text mới clear audio target; text giống giữ audio hợp lệ', async () => {
    await createAudio('en').expect(200);
    await createAudio('ja').expect(200);
    await createAudio('vi').expect(200);
    const vi = poiRepository.findById(poi.id).narrations.vi;
    translator.translate.mockImplementation(async (text, source, language) => ({ text: language === 'en' ? 'New translation' : texts[language] }));
    const res = await request(app).post(`/api/pois/${poi.id}/translations`).send({ targetLanguages: ['en', 'ja'] });
    expect(res.status).toBe(200);
    const current = poiRepository.findById(poi.id);
    expect(current.narrations.en).toEqual({ text: 'New translation' });
    expect(current.narrations.ja.audioFile).toBe('narration_ja_test.wav');
    expect(current.narrations.vi).toEqual(vi);
  });

  it('translation atomic failure giữ cả metadata audio cũ', async () => {
    await createAudio('en').expect(200);
    const before = JSON.parse(JSON.stringify(poiRepository.findById(poi.id)));
    translator.translate.mockImplementation(async (text, source, language) => {
      if (language === 'ja') throw new Error('Failed');
      return { text: 'Different text' };
    });
    await request(app).post(`/api/pois/${poi.id}/translations`).send({ targetLanguages: ['en', 'ja'] }).expect(502);
    expect(poiRepository.findById(poi.id)).toEqual(before);
  });

  it('text thay đổi lúc chờ Piper trả 409 và không gắn WAV vào text mới', async () => {
    let finish;
    piper.synthesize.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = poiService.createPoiAudio(poi.id, 'vi');
    poiService.setVietnameseNarration(poi.id, { text: 'Nguồn mới' });
    finish('narration_old.wav');
    await expect(pending).rejects.toMatchObject({ statusCode: 409 });
    expect(poiRepository.findById(poi.id).narrations).toEqual({ vi: { text: 'Nguồn mới' } });
  });

  it('translation đổi lúc chờ Piper không lưu audio stale cho target', async () => {
    let finish;
    piper.synthesize.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = poiService.createPoiAudio(poi.id, 'en');
    translator.translate.mockResolvedValue({ text: 'New English' });
    await poiService.createTranslations(poi.id, { targetLanguages: ['en'] });
    finish('narration_old.wav');
    await expect(pending).rejects.toMatchObject({ statusCode: 409 });
    expect(poiRepository.findById(poi.id).narrations.en).toEqual({ text: 'New English' });
  });

  it('POI xóa khi đang chạy Piper không được khôi phục', async () => {
    let finish;
    piper.synthesize.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = poiService.createPoiAudio(poi.id, 'vi');
    poiService.deletePoi(poi.id);
    finish('narration_deleted.wav');
    await expect(pending).rejects.toMatchObject({ statusCode: 404 });
    expect(poiRepository.findById(poi.id)).toBeNull();
  });

  it('hai audio khác language và cập nhật CRUD đồng thời không mất dữ liệu của nhau', async () => {
    const finish = {};
    piper.synthesize.mockImplementation((text, language) => new Promise((resolve) => { finish[language] = resolve; }));
    const vi = poiService.createPoiAudio(poi.id, 'vi');
    const ja = poiService.createPoiAudio(poi.id, 'ja');
    poiService.updatePoi(poi.id, { name: 'Tên cập nhật' });
    finish.ja('narration_ja.wav');
    await ja;
    finish.vi('narration_vi.wav');
    await vi;
    expect(poiRepository.findById(poi.id)).toMatchObject({
      name: 'Tên cập nhật', narrations: { vi: { audioFile: 'narration_vi.wav' }, ja: { audioFile: 'narration_ja.wav' }, en: { text: texts.en } },
    });
  });

  it('tạo audio VI khi đang dịch không làm mất hiệu lực nguồn chỉ vì metadata đổi', async () => {
    let finish;
    translator.translate.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = poiService.createTranslations(poi.id, { targetLanguages: ['en'] });
    await poiService.createPoiAudio(poi.id, 'vi');
    finish({ text: 'New English' });
    await pending;
    expect(poiRepository.findById(poi.id).narrations.vi.audioFile).toBe('narration_vi_test.wav');
    expect(poiRepository.findById(poi.id).narrations.en.text).toBe('New English');
  });

  it('route audio, CRUD, nearby và WebApp không conflict', async () => {
    await createAudio('vi').expect(200);
    await request(app).put(`/api/pois/${poi.id}`).send({ description: 'Mô tả mới' }).expect(200);
    const nearby = await request(app).get('/api/pois/nearby?lat=10&lng=106');
    expect(nearby.status).toBe(200);
    expect(nearby.body.nearestPoi.id).toBe(poi.id);
    expect(nearby.body.nearestPoi.narrations.vi.audioFile).toBe('narration_vi_test.wav');
    await request(app).get('/').expect(200).expect(/narration-audio/);
    await request(app).get(`/api/pois/${poi.id}`).expect(200);
    await request(app).delete(`/api/pois/${poi.id}`).expect(204);
  });
});

describe('Stage 5: legacy narration', () => {
  it.each(['vi', 'en', 'ja', 'ko'])('POST/GET legacy %s vẫn dùng Piper và giữ response cũ', async (language) => {
    const res = await request(app).post('/api/narrations').send({ text: texts[language], language });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ text: texts[language], language, status: 'done', audioFile: `narration_${language}_test.wav` });
    expect(piper.synthesize).toHaveBeenCalledWith(texts[language], language);
    const get = await request(app).get(`/api/narrations/${res.body.id}`);
    expect(get.body).toEqual(res.body);
    const all = await request(app).get('/api/narrations');
    expect(all.body).toEqual([res.body]);
  });

  it('legacy supported languages cùng nguồn VI/EN/JA/KO', () => {
    expect(narrationService.getSupportedLanguages()).toEqual(['vi', 'en', 'ja', 'ko']);
  });

  it('legacy Piper failure giữ status failed, không expose path', async () => {
    piper.synthesize.mockRejectedValue(new Error('SECRET D:\\private\\piper.exe'));
    const res = await request(app).post('/api/narrations').send({ text: texts.ja, language: 'ja' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
    expect(narrationRepository.findAll()).toEqual([expect.objectContaining({ text: texts.ja, status: 'failed', audioFile: null })]);
  });
});
