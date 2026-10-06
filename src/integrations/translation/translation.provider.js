function providerError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

class TranslationProvider {
  async translate(text, sourceLanguage, targetLanguage) {
    // Đọc cấu hình khi sử dụng để thiếu cấu hình không làm server crash lúc khởi động.
    const provider = (process.env.TRANSLATION_PROVIDER || '').trim();
    const endpoint = (process.env.TRANSLATION_API_URL || '').trim();
    const apiKey = (process.env.TRANSLATION_API_KEY || '').trim();
    const requireKey = (process.env.TRANSLATION_REQUIRE_API_KEY || 'false').trim();
    const timeout = Number(process.env.TRANSLATION_TIMEOUT_MS || 10000);

    if (provider !== 'libretranslate' || !endpoint) {
      throw providerError('Cần cấu hình TRANSLATION_PROVIDER=libretranslate và TRANSLATION_API_URL.', 503);
    }

    let url;
    try {
      url = new URL(endpoint);
    } catch {
      throw providerError('TRANSLATION_API_URL không hợp lệ.', 503);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw providerError('TRANSLATION_API_URL phải là HTTP/HTTPS, không chứa credentials, query hoặc fragment.', 503);
    }
    if (!['true', 'false'].includes(requireKey) || !Number.isInteger(timeout) || timeout < 1 || timeout > 60000) {
      throw providerError('TRANSLATION_REQUIRE_API_KEY hoặc TRANSLATION_TIMEOUT_MS không hợp lệ.', 503);
    }
    if ((requireKey === 'true' || url.hostname === 'libretranslate.com') && !apiKey) {
      throw providerError('Instance dịch yêu cầu TRANSLATION_API_KEY.', 503);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          q: text, source: sourceLanguage, target: targetLanguage, format: 'text',
          ...(apiKey ? { api_key: apiKey } : {}),
        }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        // Không đưa response body, URL hoặc lỗi gốc của nhà cung cấp ra client/log.
        if (response.status === 401 || response.status === 403) {
          throw providerError('API dịch từ chối xác thực. Kiểm tra cấu hình API key.', 503);
        }
        throw providerError('API dịch trả về HTTP error.', 502);
      }
      const data = await response.json();
      if (!data || typeof data.translatedText !== 'string' || !data.translatedText.trim()) {
        throw providerError('API dịch trả nội dung không hợp lệ hoặc rỗng.', 502);
      }
      return { text: data.translatedText.trim() };
    } catch (error) {
      if (controller.signal.aborted) throw providerError('API dịch quá thời gian chờ.', 504);
      if (error?.statusCode === 503) throw providerError('API dịch từ chối xác thực. Kiểm tra cấu hình API key.', 503);
      throw providerError('Không nhận được bản dịch hợp lệ từ API dịch.', 502);
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = new TranslationProvider();
