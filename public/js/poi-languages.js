/* global module */
// Nguồn ngôn ngữ POI dùng chung cho Node.js và dropdown WebApp, không chứa secret.
(() => {
  const languages = Object.freeze({
    sourceLanguage: 'vi',
    names: Object.freeze({ vi: 'Tiếng Việt', en: 'English', ja: '日本語', ko: '한국어' }),
  });

  if (typeof module === 'object' && module.exports) {
    module.exports = languages;
  } else {
    window.POI_LANGUAGES = languages;
  }
})();
