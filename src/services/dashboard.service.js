const repository = require('../repositories/dashboard.repository');

async function getDashboard() {
  const now = new Date(Date.now()).toISOString();
  const data = await repository.snapshot(now);
  return {
    poi: { total: data.poiTotal, active: data.poiActive },
    vouchers: { total: data.voucherTotal, unused: data.voucherUnused,
      active: data.voucherActive, expired: data.voucherExpired },
    accounts: { total: data.accountTotal },
    recentActivations: data.recentActivations,
    generatedAt: now,
  };
}

module.exports = { getDashboard };
