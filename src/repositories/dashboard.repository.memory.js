const pois = require('./poi.repository');
const accounts = require('./account.repository');
const access = require('./access.repository');

function snapshot(now) {
  const poiList = pois.findAll();
  const voucherList = access.findAllVouchers();
  const recentActivations = access.findRecentDashboardSessions(now);
  const voucherUnused = voucherList.filter((voucher) => voucher.status === 'unused').length;
  const voucherExpired = voucherList.filter((voucher) => voucher.status === 'redeemed'
    && Date.parse(voucher.expiresAt) <= Date.parse(now)).length;
  return {
    poiTotal: poiList.length,
    poiActive: poiList.filter((poi) => poi.isActive === true).length,
    voucherTotal: voucherList.length,
    voucherUnused,
    voucherActive: voucherList.filter((voucher) => voucher.status === 'redeemed'
      && !(Date.parse(voucher.expiresAt) <= Date.parse(now))).length,
    voucherExpired,
    accountTotal: accounts.findAll().filter((account) => ['ADMIN', 'POI_MANAGER'].includes(account.role)).length,
    recentActivations,
  };
}

module.exports = { snapshot };
