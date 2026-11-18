const libre = require('./translation.provider');
const deepl = require('./deepl.provider');

function createRun(env = process.env) {
  const selected = (env.POI_DESCRIPTION_PROVIDER || 'libretranslate').trim();
  if (selected === 'libretranslate') return libre;
  if (selected === 'deepl') return deepl.createRun({ env });
  throw Object.assign(new Error('Invalid POI_DESCRIPTION_PROVIDER.'),
    { code: 'PROVIDER_CONFIG', statusCode: 503 });
}

module.exports = { createRun };
