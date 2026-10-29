(() => {
  'use strict';
  const languages = Object.freeze(['vi', 'en', 'ja', 'ko']);
  const storageKey = 'vigac_admin_language';
  const dictionaries = window.ADMIN_TRANSLATIONS;
  const listeners = new Set();
  const dynamicIds = new Set(['admin-header-title', 'admin-identity', 'dashboard-status', 'voucher-message',
    'voucher-list-status', 'activation-list-status', 'list-status', 'selection-status', 'content-status',
    'draft-status', 'preview-status', 'account-status', 'login-status', 'poi-location-status',
    'poi-suggestion-status', 'poi-coordinates', 'action-status']);
  let language = 'vi';
  try {
    const saved = localStorage.getItem(storageKey);
    if (languages.includes(saved)) language = saved;
  } catch { /* The selector still works when storage is unavailable. */ }

  function t(key, params = []) {
    const template = dictionaries[language]?.[key] ?? dictionaries.vi?.[key] ?? key;
    return template.replace(/\{(\d+)\}/g, (match, index) => Object.prototype.hasOwnProperty.call(params, index)
      ? String(params[index]) : match);
  }
  function applyStatic() {
    document.documentElement.lang = language;
    document.querySelectorAll('[data-admin-i18n]').forEach((node) => {
      if (!dynamicIds.has(node.id)) node.textContent = t(node.dataset.adminI18n);
    });
    for (const name of ['placeholder', 'title', 'aria-label', 'alt']) {
      const property = `adminI18n${name.replace(/(^|-)(\w)/g, (_, _dash, letter) => letter.toUpperCase())}`;
      document.querySelectorAll(`[data-admin-i18n-${name}]`).forEach((node) => {
        node.setAttribute(name, t(node.dataset[property]));
      });
    }
    const selector = document.getElementById('admin-language');
    if (selector) selector.value = language;
  }
  function setLanguage(next) {
    if (!languages.includes(next) || next === language) return;
    language = next;
    try { localStorage.setItem(storageKey, language); } catch { /* Keep in-memory choice. */ }
    applyStatic();
    for (const listener of listeners) listener(language);
  }
  window.ADMIN_I18N = { t, language: () => language, setLanguage, onChange: (listener) => listeners.add(listener), applyStatic };
  document.addEventListener('DOMContentLoaded', () => {
    const selector = document.getElementById('admin-language');
    if (selector) selector.addEventListener('change', () => setLanguage(selector.value));
    applyStatic();
  });
})();
