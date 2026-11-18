const endpoint = 'https://api-free.deepl.com/v2/translate';
const languages = ['vi', 'en', 'ja', 'ko'];
let reservedCharacters = 0;
let budgetIdentity;

const error = (code, statusCode = 503) => Object.assign(new Error(code), { code, statusCode });
const count = (value) => [...String(value)].length;

function configuration(env = process.env) {
  const key = env.DEEPL_API_KEY;
  const plan = env.DEEPL_ACCOUNT_PLAN;
  const remaining = Number(env.DEEPL_REMAINING_CHARACTERS);
  const maxRun = Number(env.DEEPL_MAX_RUN_CHARACTERS);
  const timeout = Number(env.TRANSLATION_TIMEOUT_MS || 10000);
  if (plan !== 'developer' && plan !== 'free') throw error('PROVIDER_CONFIG');
  if (env.DEEPL_API_ENDPOINT !== endpoint) throw error('PROVIDER_CONFIG');
  if (env.DEEPL_PRODUCTION_CONFIRMED !== 'true') throw error('PROVIDER_CONFIG');
  if (typeof key !== 'string' || !/^[\x21-\x7e]{20,512}$/.test(key)) throw error('PROVIDER_AUTH');
  if (!Number.isSafeInteger(remaining) || remaining < 1 || remaining > (plan === 'developer' ? 1000000 : 500000)
    || !Number.isSafeInteger(maxRun) || maxRun < 1 || maxRun > remaining)
    throw error('PROVIDER_QUOTA');
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60000) throw error('PROVIDER_CONFIG');
  return { key, plan, remaining, maxRun, timeout };
}

async function requestTranslation({ text, sourceLanguage, targetLanguage, key,
  timeout, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json',
        Authorization: `DeepL-Auth-Key ${key}` },
      body: JSON.stringify({ text: [text], source_lang: sourceLanguage.toUpperCase(),
        target_lang: targetLanguage.toUpperCase() }),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw error('PROVIDER_AUTH');
      if (response.status === 429) throw error('PROVIDER_RATE_LIMIT');
      if (response.status === 456) throw error('PROVIDER_QUOTA');
      throw error('PROVIDER_HTTP_ERROR', 502);
    }
    const translation = (await response.json())?.translations?.[0];
    if (typeof translation?.text !== 'string' || !translation.text.trim())
      throw error('PROVIDER_INVALID_RESPONSE', 502);
    return { text: translation.text.trim(), billedCharacters: translation.billed_characters ?? null };
  } catch (failure) {
    if (controller.signal.aborted) throw error('PROVIDER_TIMEOUT', 504);
    if (failure?.code && failure?.statusCode) throw failure;
    if (failure instanceof TypeError) throw error('PROVIDER_NETWORK');
    throw error('PROVIDER_INVALID_RESPONSE', 502);
  } finally {
    clearTimeout(timer);
  }
}

function createRun(options = {}) {
  const configured = configuration(options.env || process.env);
  const fetchImpl = options.fetchImpl || fetch;
  // Reserve before sending, including failed requests: this is deliberately conservative.
  const identity = `${configured.key}:${configured.plan}:${configured.remaining}`;
  if (identity !== budgetIdentity) {
    budgetIdentity = identity;
    reservedCharacters = 0;
  }
  let runCharacters = 0;
  return {
    async translate(text, sourceLanguage, targetLanguage) {
      if (!languages.includes(sourceLanguage) || !languages.includes(targetLanguage)
        || sourceLanguage === targetLanguage || typeof text !== 'string' || !text.trim())
        throw error('PROVIDER_CONFIG');
      const characters = count(text);
      if (runCharacters + characters > configured.maxRun
        || reservedCharacters + characters > configured.remaining)
        throw error('PROVIDER_QUOTA');
      runCharacters += characters;
      reservedCharacters += characters;
      const result = await requestTranslation({ text, sourceLanguage, targetLanguage,
        key: configured.key, timeout: configured.timeout, fetchImpl });
      return { text: result.text };
    },
  };
}

module.exports = { configuration, createRun, requestTranslation, endpoint };
