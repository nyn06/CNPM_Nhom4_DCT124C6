const request = require('supertest');
const app = require('../src/app');
const jobRepository = require('../src/repositories/job.repository');

beforeEach(() => {
  jobRepository.clear();
});

describe('Health check', () => {
  it('GET /health trả về status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /api/languages', () => {
  it('trả về danh sách ngôn ngữ hỗ trợ', async () => {
    const res = await request(app).get('/api/languages');
    expect(res.statusCode).toBe(200);
    expect(res.body.languages).toContain('vi');
    expect(res.body.languages).toContain('en');
  });
});

describe('POST /api/jobs', () => {
  it('tạo job thành công với dữ liệu hợp lệ', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .send({ fileName: 'bai_giang.mp4', targetLang: 'en' });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.status).toBe('processing');
    expect(res.body.fileName).toBe('bai_giang.mp4');
  });

  it('trả lỗi 400 khi thiếu fileName', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .send({ targetLang: 'en' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('trả lỗi 400 khi targetLang không được hỗ trợ', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .send({ fileName: 'video.mp4', targetLang: 'xx' });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/jobs/:id', () => {
  it('trả lỗi 404 khi job không tồn tại', async () => {
    const res = await request(app).get('/api/jobs/khong-ton-tai');
    expect(res.statusCode).toBe(404);
  });

  it('lấy được job vừa tạo', async () => {
    const createRes = await request(app)
      .post('/api/jobs')
      .send({ fileName: 'video.mp4', targetLang: 'ja' });

    const jobId = createRes.body.id;
    const getRes = await request(app).get(`/api/jobs/${jobId}`);

    expect(getRes.statusCode).toBe(200);
    expect(getRes.body.id).toBe(jobId);
  });
});

describe('GET /api/jobs', () => {
  it('trả về danh sách rỗng khi chưa có job nào', async () => {
    const res = await request(app).get('/api/jobs');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });
});
