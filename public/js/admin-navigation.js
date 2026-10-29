(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const auth = window.ADMIN_AUTH;
  const shell = byId('admin-shell');
  const sidebar = byId('admin-sidebar');
  const mobileMenu = byId('admin-mobile-menu');
  const backdrop = byId('admin-sidebar-backdrop');
  const collapse = byId('admin-sidebar-toggle');
  const screens = {
    dashboard: byId('dashboard-screen'),
    vouchers: byId('voucher-management'),
    pois: byId('pois-screen'),
    accounts: byId('account-management'),
  };
  const links = Array.from(document.querySelectorAll('[data-admin-view]'));
  let user = null;
  function translatedTitle(view) {
    return ({ dashboard: (window.ADMIN_I18N?.t('js.admin_navigation.001') ?? 'Tổng quan hệ thống'),
      vouchers: (window.ADMIN_I18N?.t('js.admin_navigation.002') ?? 'Quản lý vé QR'),
      pois: (window.ADMIN_I18N?.t('js.admin_navigation.003') ?? 'Quản lý POI'),
      accounts: (window.ADMIN_I18N?.t('js.admin_navigation.004') ?? 'Quản lý tài khoản') })[view];
  }
  function updateTitle(view) {
    const title = translatedTitle(view);
    document.title = (window.ADMIN_I18N?.t('js.admin_navigation.005', [title]) ?? `${title} — Vị Giác`);
    byId('admin-header-title').textContent = title;
  }

  function closeMobile() {
    shell.classList.remove('sidebar-mobile-open');
    backdrop.hidden = true;
    mobileMenu.setAttribute('aria-expanded', 'false');
  }

  function showView() {
    if (!user) return;
    const requested = window.location.hash.slice(1);
    const fallback = user.role === 'ADMIN' ? 'dashboard' : 'pois';
    const allowed = requested in screens && (user.role === 'ADMIN' || !['vouchers', 'accounts'].includes(requested));
    const view = allowed ? requested : fallback;
    if (requested && !allowed) window.history.replaceState(null, '', `#${view}`);
    for (const [name, screen] of Object.entries(screens)) screen.hidden = name !== view;
    for (const link of links) {
      const selected = link.dataset.adminView === view;
      if (selected) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    updateTitle(view);
    closeMobile();
    if (view === 'pois') window.ADMIN_POI_MAP?.refresh?.();
    if (view === 'dashboard') window.ADMIN_DASHBOARD?.onView?.();
    if (view === 'vouchers') window.ADMIN_VOUCHERS?.onView?.();
  }

  collapse.addEventListener('click', () => {
    const collapsed = shell.classList.toggle('sidebar-collapsed');
    collapse.setAttribute('aria-expanded', String(!collapsed));
    collapse.setAttribute('aria-label', collapsed ? (window.ADMIN_I18N?.t('js.admin_navigation.006') ?? 'Mở rộng menu') : (window.ADMIN_I18N?.t('js.admin_navigation.007') ?? 'Thu gọn menu'));
    collapse.title = collapsed ? (window.ADMIN_I18N?.t('js.admin_navigation.006') ?? 'Mở rộng menu') : (window.ADMIN_I18N?.t('js.admin_navigation.007') ?? 'Thu gọn menu');
    if (!screens.pois.hidden) window.ADMIN_POI_MAP?.refresh?.();
  });
  mobileMenu.addEventListener('click', () => {
    const open = !shell.classList.contains('sidebar-mobile-open');
    shell.classList.toggle('sidebar-mobile-open', open);
    backdrop.hidden = !open;
    mobileMenu.setAttribute('aria-expanded', String(open));
    if (open) sidebar.querySelector('[data-admin-view]:not([hidden])')?.focus();
  });
  backdrop.addEventListener('click', closeMobile);
  sidebar.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closeMobile(); mobileMenu.focus(); }
  });
  for (const link of links) link.addEventListener('click', closeMobile);
  window.addEventListener('hashchange', showView);
  window.addEventListener('popstate', showView);
  window.ADMIN_I18N?.onChange(() => {
    if (!user) return;
    const view = Object.keys(screens).find((name) => !screens[name].hidden);
    if (view) updateTitle(view);
    const collapsed = shell.classList.contains('sidebar-collapsed');
    collapse.setAttribute('aria-label', collapsed ? window.ADMIN_I18N.t('js.admin_navigation.006') : window.ADMIN_I18N.t('js.admin_navigation.007'));
    collapse.title = collapsed ? window.ADMIN_I18N.t('js.admin_navigation.006') : window.ADMIN_I18N.t('js.admin_navigation.007');
  });
  auth.onLost(() => { user = null; closeMobile(); });
  auth.ready.then((current) => {
    if (!current) return;
    user = current;
    for (const link of links) if (link.dataset.adminRole === 'ADMIN') link.hidden = user.role !== 'ADMIN';
    showView();
  });
})();
