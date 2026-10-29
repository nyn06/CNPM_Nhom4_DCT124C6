(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const auth = window.ADMIN_AUTH;
  const fields = {
    'stat-poi-total': (data) => data.poi.total,
    'stat-poi-active': (data) => data.poi.active,
    'stat-voucher-total': (data) => data.vouchers.total,
    'stat-voucher-unused': (data) => data.vouchers.unused,
    'stat-voucher-active': (data) => data.vouchers.active,
    'stat-voucher-expired': (data) => data.vouchers.expired,
    'stat-account-total': (data) => data.accounts.total,
    'chart-unused': (data) => data.vouchers.unused,
    'chart-active': (data) => data.vouchers.active,
    'chart-expired': (data) => data.vouchers.expired,
  };
  let attempted = false;
  let busy = false;
  let disposed = false;
  let controller = null;
  let lastData = null;
  const locale = () => window.ADMIN_I18N?.language() || 'vi';

  function reset() {
    for (const id of Object.keys(fields)) byId(id).textContent = '—';
    byId('voucher-chart-total').textContent = '—';
    byId('voucher-chart').style.background = '';
    byId('voucher-chart').setAttribute('aria-label', (window.ADMIN_I18N?.t('js.admin_dashboard.001') ?? 'Chưa có dữ liệu'));
    byId('recent-activation-rows').replaceChildren();
    byId('recent-empty').hidden = true;
    byId('voucher-chart-empty').hidden = true;
  }

  function validCount(value) { return Number.isSafeInteger(value) && value >= 0; }
  function validData(data) {
    return data && Object.values(fields).every((read) => validCount(read(data)))
      && data.poi.active <= data.poi.total
      && data.vouchers.unused + data.vouchers.active + data.vouchers.expired === data.vouchers.total
      && Number.isFinite(Date.parse(data.generatedAt))
      && Array.isArray(data.recentActivations) && data.recentActivations.length <= 5
      && data.recentActivations.every((item) => typeof item.id === 'string' && typeof item.voucherId === 'string'
        && Number.isFinite(Date.parse(item.startedAt)) && Number.isFinite(Date.parse(item.expiresAt))
        && ['active', 'expired'].includes(item.status));
  }

  function render(data) {
    for (const [id, read] of Object.entries(fields)) byId(id).textContent = read(data).toLocaleString(locale());
    const { total, unused, active, expired } = data.vouchers;
    const chart = byId('voucher-chart');
    byId('voucher-chart-total').textContent = total.toLocaleString(locale());
    byId('voucher-chart-empty').hidden = total !== 0;
    chart.setAttribute('aria-label', (window.ADMIN_I18N?.t('js.admin_dashboard.002', [total, unused, active, expired]) ?? `Tổng ${total} vé: ${unused} chưa kích hoạt, ${active} đang sử dụng, ${expired} đã hết hạn`));
    if (total) {
      const first = unused / total * 100;
      const second = (unused + active) / total * 100;
      chart.style.background = `conic-gradient(#e7a575 0 ${first}%, #38785b ${first}% ${second}%, #aeb8b1 ${second}% 100%)`;
    } else chart.style.background = '';

    const rows = data.recentActivations.map((item) => {
      const row = document.createElement('tr');
      for (const value of [item.id, item.voucherId,
        new Date(item.startedAt).toLocaleString(locale()), new Date(item.expiresAt).toLocaleString(locale())]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      const status = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.dataset.tone = item.status === 'active' ? 'success' : 'neutral';
      badge.textContent = item.status === 'active' ? (window.ADMIN_I18N?.t('js.admin_dashboard.003') ?? 'Đang sử dụng') : (window.ADMIN_I18N?.t('js.admin_dashboard.004') ?? 'Đã hết hạn');
      status.append(badge);
      row.append(status);
      return row;
    });
    byId('recent-activation-rows').replaceChildren(...rows);
    byId('recent-empty').hidden = rows.length !== 0;
  }

  async function load() {
    if (busy || disposed || auth.current()?.role !== 'ADMIN') return;
    attempted = true;
    busy = true;
    reset();
    byId('reload-dashboard').disabled = true;
    byId('dashboard-status').textContent = (window.ADMIN_I18N?.t('js.admin_dashboard.005') ?? 'Đang tải số liệu…');
    byId('dashboard-status').dataset.tone = 'neutral';
    controller = new AbortController();
    const current = controller;
    const timeout = setTimeout(() => current.abort(), 10000);
    try {
      const response = await fetch('/api/admin/dashboard', {
        credentials: 'same-origin', cache: 'no-store', signal: current.signal,
        headers: { Accept: 'application/json' },
      });
      auth.handle(response);
      if (!response.ok) throw new Error((window.ADMIN_I18N?.t('js.admin_dashboard.006') ?? 'Không tải được số liệu tổng quan. Hãy thử lại.'));
      const data = await response.json();
      if (!validData(data)) throw new Error((window.ADMIN_I18N?.t('js.admin_dashboard.007') ?? 'Dữ liệu tổng quan không hợp lệ. Hãy thử lại.'));
      if (disposed || controller !== current) return;
      lastData = data;
      render(data);
      byId('dashboard-status').textContent = (window.ADMIN_I18N?.t('js.admin_dashboard.008', [new Date(data.generatedAt).toLocaleString(locale())]) ?? `Cập nhật lúc ${new Date(data.generatedAt).toLocaleString('vi-VN')}`);
    } catch (error) {
      if (!disposed && controller === current) {
        reset();
        lastData = null;
        byId('dashboard-status').textContent = error.name === 'AbortError'
          ? (window.ADMIN_I18N?.t('js.admin_dashboard.009') ?? 'Yêu cầu quá thời gian. Hãy thử lại.') : (window.ADMIN_I18N?.t('js.admin_dashboard.006') ?? 'Không tải được số liệu tổng quan. Hãy thử lại.');
        byId('dashboard-status').dataset.tone = 'error';
      }
    } finally {
      clearTimeout(timeout);
      if (controller === current) controller = null;
      busy = false;
      byId('reload-dashboard').disabled = false;
    }
  }

  function onView() { if (!attempted) return load(); return undefined; }
  window.ADMIN_DASHBOARD = { onView };
  window.ADMIN_I18N?.onChange(() => {
    if (busy) byId('dashboard-status').textContent = window.ADMIN_I18N.t('js.admin_dashboard.005');
    else if (lastData) {
      render(lastData);
      byId('dashboard-status').textContent = window.ADMIN_I18N.t('js.admin_dashboard.008', [new Date(lastData.generatedAt).toLocaleString(locale())]);
    } else if (attempted) byId('dashboard-status').textContent = window.ADMIN_I18N.t(busy ? 'js.admin_dashboard.005' : 'js.admin_dashboard.006');
  });
  byId('reload-dashboard').addEventListener('click', load);
  auth.onLost(() => { disposed = true; controller?.abort(); reset(); });
  window.addEventListener('pagehide', () => { disposed = true; controller?.abort(); });
  auth.ready.then((user) => {
    if (!user || disposed) return;
    const admin = user.role === 'ADMIN';
    byId('dashboard-admin-content').hidden = !admin;
    byId('dashboard-manager-intro').hidden = admin;
    if (admin && !byId('dashboard-screen').hidden) onView();
  });
})();
