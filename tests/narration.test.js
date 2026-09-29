const request = require('supertest');

jest.mock('../src/integrations/tts/piperTts.provider', () => ({
  synthesize: jest.fn(),
}));

const app = require('../src/app');
const narrationRepository = require('../src/repositories/narration.repository');
const piperTtsProvider = require('../src/integrations/tts/piperTts.provider');

beforeEach(() => {
  narrationRepository.clear();
  jest.clearAllMocks();

  piperTtsProvider.synthesize.mockResolvedValue('test-output.wav');
});

describe('POST /api/narrations', () => {
  it('tạo narration tiếng Việt thành công', async () => {
    const res = await request(app)
      .post('/api/narrations')
      .send({
        text: 'Xin chào',
        language: 'vi',
      });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.text).toBe('Xin chào');
    expect(res.body.language).toBe('vi');
    expect(res.body.status).toBe('done');
    expect(res.body.audioFile).toBe('test-output.wav');

    expect(piperTtsProvider.synthesize).toHaveBeenCalledWith(
      'Xin chào',
      'vi'
    );
  });

  it('tạo narration tiếng Anh thành công', async () => {
    const res = await request(app)
      .post('/api/narrations')
      .send({
        text: 'Hello world',
        language: 'en',
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.language).toBe('en');
    expect(res.body.status).toBe('done');
    expect(res.body.audioFile).toBe('test-output.wav');
  });

  it('trả lỗi 400 khi thiếu text', async () => {
    const res = await request(app)
      .post('/api/narrations')
      .send({
        language: 'vi',
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('trả lỗi 400 khi ngôn ngữ chưa được hỗ trợ', async () => {
    const res = await request(app)
      .post('/api/narrations')
      .send({
        text: 'Bonjour',
        language: 'fr',
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /api/narrations', () => {
  it('trả về danh sách rỗng khi chưa có narration', async () => {
    const res = await request(app).get('/api/narrations');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('trả về narration đã tạo', async () => {
    await request(app)
      .post('/api/narrations')
      .send({
        text: 'Xin chào',
        language: 'vi',
      });

    const res = await request(app).get('/api/narrations');

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].text).toBe('Xin chào');
  });
});

describe('GET /api/narrations/:id', () => {
  it('lấy narration theo id', async () => {
    const createRes = await request(app)
      .post('/api/narrations')
      .send({
        text: 'Hello',
        language: 'en',
      });

    const id = createRes.body.id;

    const res = await request(app)
      .get(`/api/narrations/${id}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.text).toBe('Hello');
  });

  it('trả lỗi 404 khi narration không tồn tại', async () => {
    const res = await request(app)
      .get('/api/narrations/khong-ton-tai');

    expect(res.statusCode).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});