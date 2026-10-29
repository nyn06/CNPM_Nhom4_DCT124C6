const { getPool, request, iso, uuid } = require('../../database/repository');

async function snapshot(now) {
  const pool = await getPool();
  const [poi, voucher, account, recent] = await Promise.all([
    pool.request().query('SELECT COUNT(*) AS total, COUNT(CASE WHEN IsActive=1 THEN 1 END) AS active FROM dbo.POIs'),
    request(pool, { now }).query(`SELECT COUNT(*) AS total,
      COUNT(CASE WHEN Status='unused' THEN 1 END) AS unused,
      COUNT(CASE WHEN Status='redeemed' AND (ExpiresAt>@now OR ExpiresAt IS NULL) THEN 1 END) AS active,
      COUNT(CASE WHEN Status='redeemed' AND ExpiresAt<=@now THEN 1 END) AS expired
      FROM dbo.Vouchers`),
    pool.request().query("SELECT COUNT(*) AS total FROM dbo.Accounts WHERE Role IN ('ADMIN', 'POI_MANAGER')"),
    request(pool, { now }).query(`SELECT TOP (5) s.Id, s.VoucherId, s.DurationMinutes, s.StartedAt, s.ExpiresAt,
      CASE WHEN s.RevokedAt IS NOT NULL OR s.ExpiresAt<=@now THEN 'expired' ELSE 'active' END AS Status
      FROM dbo.GuestSessions s ORDER BY s.StartedAt DESC, s.Id DESC`),
  ]);
  const p = poi.recordset[0];
  const v = voucher.recordset[0];
  return {
    poiTotal: p.total, poiActive: p.active,
    voucherTotal: v.total, voucherUnused: v.unused, voucherActive: v.active, voucherExpired: v.expired,
    accountTotal: account.recordset[0].total,
    recentActivations: recent.recordset.map((row) => ({
      id: uuid(row.Id), voucherId: uuid(row.VoucherId), durationMinutes: row.DurationMinutes,
      startedAt: iso(row.StartedAt), expiresAt: iso(row.ExpiresAt), status: row.Status,
    })),
  };
}

module.exports = { snapshot };
