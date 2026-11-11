
(() => {
  'use strict';

  function initBackToTop() {
    const button = document.getElementById('back-to-top');
    if (!button) return;

    function updateVisibility() {
      const scrollTop = Math.max(
        window.scrollY,
        document.documentElement.scrollTop,
        document.body.scrollTop
      );

      button.classList.toggle('show', scrollTop > 100);
    }

    button.addEventListener('click', () => {
      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;

      window.scrollTo({
        top: 0,
        behavior: reduceMotion ? 'auto' : 'smooth'
      });
    });

    window.addEventListener('scroll', updateVisibility, {
      passive: true
    });

    updateVisibility();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBackToTop);
  } else {
    initBackToTop();
  }
})();
