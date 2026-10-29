(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const auth = window.ADMIN_AUTH;
  const labels = () => ({ unused: (window.ADMIN_I18N?.t('js.admin_vouchers.001') ?? 'Chưa kích hoạt'), active: (window.ADMIN_I18N?.t('js.admin_vouchers.002') ?? 'Đang sử dụng'), expired: (window.ADMIN_I18N?.t('js.admin_vouchers.003') ?? 'Đã hết hạn') });
  const state = { page: 1, controller: null, loaded: false, lastData: null, errorKey: null };
  let disposed = false;
  let creating = false;
  let createController = null;
  let createdVoucherId = null;
  let createdVoucher = null;
  let invalidDate = false;
  function dateIssue(active) {
    invalidDate = active;
    const node = byId('voucher-search-date-error');
    node.textContent = active ? (window.ADMIN_I18N?.t('js.admin_vouchers.027') ?? 'Ngày tạo không hợp lệ.') : '';
    node.hidden = !active;
    byId('voucher-search-date').setAttribute('aria-invalid', String(active));
  }
  function malformedDate() {
    const input = byId('voucher-search-date');
    const value = input.value;
    if (input.validity?.badInput) return true;
    if (!value) return false;
    const parsed = Date.parse(`${value}T00:00:00Z`);
    return !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed)
      || new Date(parsed).toISOString().slice(0, 10) !== value;
  }

  function notice(id, text, tone = 'neutral') {
    byId(id).textContent = text;
    byId(id).dataset.tone = tone;
  }
  function date(value) { return value ? new Date(value).toLocaleString(window.ADMIN_I18N?.language() || 'vi') : '—'; }
  function statusBadge(value) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.dataset.tone = value === 'active' ? 'success' : value === 'unused' ? 'neutral' : 'error';
    badge.textContent = labels()[value];
    return badge;
  }
  function row(item, index, page) {
    const tr = document.createElement('tr');
    const values = [(page - 1) * 10 + index + 1, item.id,
      (window.ADMIN_I18N?.t('js.admin_vouchers.005', [item.durationMinutes]) ?? `${item.durationMinutes} phút`),
      date(item.createdAt), date(item.redeemedAt), date(item.expiresAt)];
    for (const value of values) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    const td = document.createElement('td');
    td.append(statusBadge(item.status));
    tr.append(td);
    return tr;
  }
  function clear() {
    byId('voucher-rows').replaceChildren();
    byId('voucher-page').textContent = '—';
    byId('voucher-prev').disabled = true;
    byId('voucher-next').disabled = true;
    for (const key of ['total', 'unused', 'active', 'expired']) byId(`voucher-stat-${key}`).textContent = '—';
  }
  function valid(data) {
    if (!data || !Number.isSafeInteger(data.page) || data.page < 1 || !Number.isSafeInteger(data.total) || data.total < 0
      || !Number.isSafeInteger(data.totalPages) || data.totalPages !== Math.ceil(data.total / 10)
      || !Array.isArray(data.items) || data.items.length > 10 || !Number.isFinite(Date.parse(data.generatedAt))) return false;
    const stats = data.stats;
    if (!stats || !['total', 'unused', 'active', 'expired'].every((key) => Number.isSafeInteger(stats[key]) && stats[key] >= 0)
      || stats.total !== stats.unused + stats.active + stats.expired) return false;
    return data.items.every((item) => typeof item.id === 'string' && typeof item.durationMinutes === 'number'
      && ['unused', 'active', 'expired'].includes(item.status) && Number.isFinite(Date.parse(item.createdAt)));
  }
  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: {
      Accept: 'application/json', ...auth.headers(options.method || 'GET'), ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    }, ...options });
    auth.handle(response);
    if (!response.ok) throw new Error(response.status === 403 ? (window.ADMIN_I18N?.t('js.admin_vouchers.006') ?? 'Chỉ ADMIN được quản lý vé QR.') : (window.ADMIN_I18N?.t('js.admin_vouchers.007') ?? 'Không tải được dữ liệu. Hãy thử lại.'));
    return response.json();
  }
  function renderPage(data) {
    for (const key of ['total', 'unused', 'active', 'expired']) byId(`voucher-stat-${key}`).textContent = data.stats[key].toLocaleString(window.ADMIN_I18N?.language() || 'vi');
    const created = data.items.find((item) => item.id === createdVoucherId);
    if (created) {
      createdVoucher = { durationMinutes: created.durationMinutes, status: created.status };
      byId('created-voucher-status').textContent = (window.ADMIN_I18N?.t('js.admin_vouchers.011', [created.durationMinutes, labels()[created.status]]) ?? `Vé ${created.durationMinutes} phút · ${labels()[created.status]}.`);
    }
    byId('voucher-rows').replaceChildren(...data.items.map((item, index) => row(item, index, data.page)));
    byId('voucher-page').textContent = (window.ADMIN_I18N?.t('js.admin_vouchers.012', [data.page, Math.max(1, data.totalPages), data.total]) ?? `Trang ${data.page}/${Math.max(1, data.totalPages)} · ${data.total} bản ghi`);
    byId('voucher-prev').disabled = data.page <= 1;
    byId('voucher-next').disabled = data.page >= data.totalPages;
    const unfiltered = byId('voucher-filter').value === 'all' && byId('voucher-search-duration').value === 'all'
      && !byId('voucher-search-date').value;
    notice('voucher-list-status', data.items.length ? (window.ADMIN_I18N?.t('js.admin_vouchers.013', [date(data.generatedAt)]) ?? `Cập nhật lúc ${date(data.generatedAt)}`)
      : data.total === 0 && unfiltered ? (window.ADMIN_I18N?.t('js.admin_vouchers.014') ?? 'Chưa có vé QR.')
        : (window.ADMIN_I18N?.t('js.admin_vouchers.016') ?? 'Không có kết quả phù hợp.'));
  }
  async function load() {
    if (disposed || auth.current()?.role !== 'ADMIN') return;
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    state.lastData = null;
    state.errorKey = null;
    clear();
    notice('voucher-list-status', (window.ADMIN_I18N?.t('js.admin_vouchers.009') ?? 'Đang tải dữ liệu…'));
    const query = new URLSearchParams({
      page: String(state.page),
      status: byId('voucher-filter').value,
      duration: byId('voucher-search-duration').value,
      createdDate: byId('voucher-search-date').value,
    });
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const data = await request(`/api/access/vouchers/overview?${query}`, { signal: controller.signal });
      if (!valid(data)) throw new Error((window.ADMIN_I18N?.t('js.admin_vouchers.010') ?? 'Dữ liệu không hợp lệ. Hãy thử lại.'));
      if (disposed || state.controller !== controller) return;
      state.loaded = true;
      state.lastData = data;
      state.errorKey = null;
      renderPage(data);
    } catch (error) {
      if (!disposed && state.controller === controller) {
        clear();
        state.lastData = null;
        state.errorKey = error.name === 'AbortError' ? 'js.admin_vouchers.017' : 'js.admin_vouchers.007';
        notice('voucher-list-status', (window.ADMIN_I18N?.t(state.errorKey) ?? 'Không tải được dữ liệu. Hãy thử lại.'), 'error');
      }
    } finally {
      clearTimeout(timeout);
      if (state.controller === controller) state.controller = null;
    }
  }
  async function create(event) {
    event.preventDefault();
    if (creating || disposed || auth.current()?.role !== 'ADMIN') return;
    creating = true;
    byId('create-voucher').disabled = true;
    createController = new AbortController();
    const timeout = setTimeout(() => createController?.abort(), 10000);
    notice('voucher-message', (window.ADMIN_I18N?.t('js.admin_vouchers.018') ?? 'Đang tạo vé…'));
    try {
      const voucher = await request('/api/access/vouchers', { method: 'POST', signal: createController.signal,
        body: JSON.stringify({ durationMinutes: Number(byId('voucher-duration').value) }) });
      const url = new URL(voucher.activationUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.searchParams.get('voucher') !== voucher.code
        || !/^[A-Za-z0-9]{7}$/.test(voucher.activationCode)
        || typeof voucher.qrSvg !== 'string' || !voucher.qrSvg.startsWith('<svg')) throw new Error((window.ADMIN_I18N?.t('js.admin_vouchers.019') ?? 'QR trả về không hợp lệ.'));
      if (disposed) return;
      byId('voucher-qr').src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(voucher.qrSvg)}`;
      byId('activation-url').value = voucher.activationUrl;
      byId('activation-code').value = voucher.activationCode;
      createdVoucherId = voucher.id;
      createdVoucher = { durationMinutes: voucher.durationMinutes, status: 'unused' };
      byId('created-voucher-status').textContent = (window.ADMIN_I18N?.t('js.admin_vouchers.020', [voucher.durationMinutes]) ?? `Vé ${voucher.durationMinutes} phút · Chưa kích hoạt.`);
      byId('voucher-result').hidden = false;
      notice('voucher-message', (window.ADMIN_I18N?.t('js.admin_vouchers.021') ?? 'Đã tạo vé. Lưu QR, URL hoặc mã kích hoạt ngay; danh sách không tiết lộ lại mã vé.'), 'success');
      state.page = 1;
      await load();
    } catch (error) {
      if (!disposed) notice('voucher-message', error.name === 'AbortError' ? (window.ADMIN_I18N?.t('js.admin_vouchers.017') ?? 'Yêu cầu quá thời gian. Hãy thử lại.') : (window.ADMIN_I18N?.t('js.admin_vouchers.022') ?? 'Không tạo được vé. Hãy kiểm tra thời hạn và thử lại.'), 'error');
    } finally {
      clearTimeout(timeout);
      createController = null;
      creating = false;
      byId('create-voucher').disabled = false;
    }
  }
  function onView() { if (!state.loaded) load(); }
  window.ADMIN_VOUCHERS = { onView };
  window.ADMIN_I18N?.onChange(() => {
    if (invalidDate) dateIssue(true);
    if (state.lastData) renderPage(state.lastData);
    else if (state.errorKey) notice('voucher-list-status', window.ADMIN_I18N.t(state.errorKey), 'error');
    else if (state.controller) notice('voucher-list-status', window.ADMIN_I18N.t('js.admin_vouchers.009'));
    if (createdVoucher && !byId('voucher-result').hidden) {
      byId('created-voucher-status').textContent = window.ADMIN_I18N.t('js.admin_vouchers.011',
        [createdVoucher.durationMinutes, labels()[createdVoucher.status]]);
    }
    if (byId('voucher-result').hidden) notice('voucher-message', window.ADMIN_I18N.t('html.admin.069'));
    else notice('voucher-message', window.ADMIN_I18N.t('js.admin_vouchers.021'), 'success');
  });
  byId('voucher-form').addEventListener('submit', create);
  byId('reload-vouchers').addEventListener('click', load);
  byId('voucher-prev').addEventListener('click', () => {
    if (state.page > 1) { state.page--; load(); }
  });
  byId('voucher-next').addEventListener('click', () => { state.page++; load(); });

  byId('voucher-search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const dateInput = byId('voucher-search-date');
    const malformed = malformedDate();
    dateIssue(malformed);
    if (malformed) { dateInput.focus(); return; }
    state.page = 1;
    load();

    byId('voucher-rows').scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  });

  byId('voucher-search-reset').addEventListener('click', () => {
    dateIssue(false);
    byId('voucher-search-duration').value = 'all';
    byId('voucher-search-date').value = '';
    byId('voucher-filter').value = 'all';
    state.page = 1;
    load();
  });
  byId('voucher-search-date').addEventListener('input', () => { if (invalidDate) dateIssue(malformedDate()); });

  byId('copy-voucher-url').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(byId('activation-url').value); notice('voucher-message', (window.ADMIN_I18N?.t('js.admin_vouchers.023') ?? 'Đã sao chép URL kích hoạt.'), 'success'); }
    catch { notice('voucher-message', (window.ADMIN_I18N?.t('js.admin_vouchers.024') ?? 'Hãy chọn và sao chép URL trong ô phía trên.'), 'info'); }
  });
  byId('copy-activation-code').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(byId('activation-code').value); notice('voucher-message', (window.ADMIN_I18N?.t('js.admin_vouchers.025') ?? 'Đã sao chép mã kích hoạt.'), 'success'); }
    catch { notice('voucher-message', (window.ADMIN_I18N?.t('js.admin_vouchers.026') ?? 'Hãy chọn và sao chép mã trong ô phía trên.'), 'info'); }
  });
  function dispose() {
    disposed = true;
    state.controller?.abort();
    createController?.abort();
    byId('voucher-result').hidden = true;
    byId('activation-url').value = '';
    byId('activation-code').value = '';
    byId('voucher-qr').removeAttribute('src');
  }
  auth.onLost(dispose);
  window.addEventListener('pagehide', dispose);
  auth.ready.then((user) => { if (user?.role === 'ADMIN' && !disposed && !byId('voucher-management').hidden) onView(); });
})();
