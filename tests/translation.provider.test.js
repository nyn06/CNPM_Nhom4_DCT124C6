const provider = require('../src/integrations/translation/translation.provider');
const envKeys = ['TRANSLATION_PROVIDER', 'TRANSLATION_API_URL', 'TRANSLATION_API_KEY', 'TRANSLATION_REQUIRE_API_KEY', 'TRANSLATION_TIMEOUT_MS'];
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = global.fetch;
const translate = () => provider.translate('Nội dung gốc', 'vi', 'en');

beforeEach(() => {
  jest.useFakeTimers();
  envKeys.forEach((key) => { delete process.env[key]; });
  process.env.TRANSLATION_PROVIDER = 'libretranslate';
  process.env.TRANSLATION_API_URL = 'http://localhost:5000/translate';
  // Mọi HTTP đều stub, kể cả khi máy chạy test có API key thật.
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ translatedText: ' Translated text\n' }) });
});

afterEach(() => {
  global.fetch = originalFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  jest.useRealTimers();
});

it('gọi LibreTranslate đúng JSON, self-host không key; trả text chuẩn hóa', async () => {
  await expect(translate()).resolves.toEqual({ text: 'Translated text' });
  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toBe('http://localhost:5000/translate');
  expect(options).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' } });
  expect(JSON.parse(options.body)).toEqual({ q: 'Nội dung gốc', source: 'vi', target: 'en', format: 'text' });
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(jest.getTimerCount()).toBe(0);
});

it('gửi key từ env trong body khi cấu hình, không đưa vào URL', async () => {
  process.env.TRANSLATION_API_KEY = 'test-only-key';
  process.env.TRANSLATION_REQUIRE_API_KEY = 'true';
  await translate();
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).api_key).toBe('test-only-key');
  expect(global.fetch.mock.calls[0][0]).not.toContain('test-only-key');
});

it.each([
  ['TRANSLATION_PROVIDER', ''], ['TRANSLATION_PROVIDER', 'unknown'],
  ['TRANSLATION_API_URL', ''], ['TRANSLATION_API_URL', 'not a URL'],
  ['TRANSLATION_API_URL', 'file:///tmp/api'], ['TRANSLATION_API_URL', 'https://user:secret@example.test/translate'],
  ['TRANSLATION_API_URL', 'https://example.test/translate?api_key=secret'],
  ['TRANSLATION_API_URL', 'https://example.test/translate#secret'],
  ['TRANSLATION_TIMEOUT_MS', '0'], ['TRANSLATION_TIMEOUT_MS', '-5'],
  ['TRANSLATION_TIMEOUT_MS', 'abc'], ['TRANSLATION_TIMEOUT_MS', '1.5'], ['TRANSLATION_TIMEOUT_MS', '60001'],
  ['TRANSLATION_REQUIRE_API_KEY', 'yes'], ['TRANSLATION_REQUIRE_API_KEY', 'true'],
  ['TRANSLATION_API_URL', 'https://libretranslate.com/translate'],
])('cấu hình sai/thiếu %s=%s trả 503 không gọi HTTP', async (key, value) => {
  process.env[key] = value;
  await expect(translate()).rejects.toMatchObject({ statusCode: 503 });
  expect(global.fetch).not.toHaveBeenCalled();
});

it.each([[401, 503], [403, 503], [400, 502], [429, 502], [500, 502], [302, 502]])(
  'HTTP %s thành lỗi %s không đọc/echo body nhà cung cấp', async (status, expected) => {
    const json = jest.fn(async () => ({ error: 'SECRET-provider-body' }));
    global.fetch.mockResolvedValue({ ok: false, status, json });
    const error = await translate().catch((failure) => failure);
    expect(error.statusCode).toBe(expected);
    expect(error.message).not.toContain('SECRET');
    expect(json).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  }
);

it.each([null, {}, { translatedText: '' }, { translatedText: '   ' }, { translatedText: 1 }, { translatedText: ['text'] }])(
  'response không hợp lệ %j trả 502', async (data) => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => data });
    await expect(translate()).rejects.toMatchObject({ statusCode: 502 });
  }
);

it('JSON hỏng và lỗi kết nối được làm sạch', async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('SECRET invalid JSON'); } });
  let error = await translate().catch((failure) => failure);
  expect(error.statusCode).toBe(502);
  expect(error.message).not.toContain('SECRET');
  global.fetch.mockRejectedValueOnce(new Error('SECRET network URL/key'));
  error = await translate().catch((failure) => failure);
  expect(error.statusCode).toBe(502);
  expect(error.message).not.toContain('SECRET');
});

it.each(['headers', 'body'])('timeout bao gồm thời gian chờ %s, hủy HTTP và trả 504', async (phase) => {
  process.env.TRANSLATION_TIMEOUT_MS = '200';
  global.fetch.mockImplementation((url, { signal }) => {
    const hanging = () => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('SECRET aborted')));
    });
    return phase === 'headers' ? hanging() : Promise.resolve({ ok: true, json: hanging });
  });
  const pending = translate();
  const expectation = expect(pending).rejects.toMatchObject({ statusCode: 504 });
  await jest.advanceTimersByTimeAsync(200);
  await expectation;
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});
