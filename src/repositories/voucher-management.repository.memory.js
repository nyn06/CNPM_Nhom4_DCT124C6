const access = require('./access.repository');

const voucherStatus = (item, now) => item.status === 'unused' ? 'unused'
  : item.expiresAt && item.expiresAt <= now ? 'expired' : 'active';
const sessionStatus = (item, now) => item.revokedAt ? 'revoked' : item.expiresAt <= now ? 'expired' : 'active';
const pageOf = (items, { page, limit }) => ({ page, total: items.length, totalPages: Math.ceil(items.length / limit),
  items: items.slice((page - 1) * limit, page * limit) });

function vouchers(options) {
  const all = access.findAllVouchers().map((item) => ({
    id: item.id, durationMinutes: item.durationMinutes, createdAt: item.createdAt,
    redeemedAt: item.redeemedAt, expiresAt: item.expiresAt, status: voucherStatus(item, options.now),
  }));
  const stats = { total: all.length, unused: 0, active: 0, expired: 0 };
  all.forEach((item) => { stats[item.status]++; });
  const filtered = all.filter((item) => (options.status === 'all' || item.status === options.status)
    && item.id.toLowerCase().includes(options.search));
  filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return { ...pageOf(filtered, options), stats, generatedAt: options.now };
}

function activations(options) {
  const all = access.findAllDashboardSessions().map((item) => ({
    id: item.id, voucherId: item.voucherId, durationMinutes: item.durationMinutes,
    startedAt: item.startedAt, expiresAt: item.expiresAt, status: sessionStatus(item, options.now),
  }));
  const filtered = all.filter((item) => (options.status === 'all' || item.status === options.status)
    && (item.id.toLowerCase().includes(options.search) || item.voucherId.toLowerCase().includes(options.search)));
  filtered.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
  return { ...pageOf(filtered, options), generatedAt: options.now };
}

module.exports = { vouchers, activations };
