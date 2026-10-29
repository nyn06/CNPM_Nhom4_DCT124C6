const { sql, getPool, iso, uuid } = require('../../database/repository');

const voucherStatus = `CASE WHEN Status='unused' THEN 'unused'
  WHEN ExpiresAt<=@now THEN 'expired' ELSE 'active' END`;
const sessionStatus = `CASE WHEN RevokedAt IS NOT NULL THEN 'revoked'
  WHEN ExpiresAt<=@now THEN 'expired' ELSE 'active' END`;

function bound(pool, options) {
  return new sql.Request(pool)
    .input('now', sql.DateTime2, new Date(options.now))
    .input('search', sql.NVarChar(38), `%${options.search}%`)
    .input('status', sql.VarChar(8), options.status)
    .input('duration', sql.Int, options.duration ?? null)
    .input('createdFrom', sql.DateTime2, options.createdDate
      ? new Date(`${options.createdDate}T00:00:00+07:00`) : null)
    .input('createdTo', sql.DateTime2, options.createdDate
      ? new Date(new Date(`${options.createdDate}T00:00:00+07:00`).getTime() + 86400000) : null)
    .input('offset', sql.Int, (options.page - 1) * options.limit)
    .input('limit', sql.Int, options.limit);
}

async function vouchers(options) {
  const pool = await getPool();
  const where = `WHERE (@status='all' OR ${voucherStatus}=@status)
      AND (@duration IS NULL OR DurationMinutes=@duration)
      AND (@createdFrom IS NULL OR CreatedAt>=@createdFrom)
      AND (@createdTo IS NULL OR CreatedAt<@createdTo)`;
  const [statsResult, countResult, rowsResult] = await Promise.all([
    bound(pool, options).query(`SELECT COUNT(*) AS total,
      COUNT(CASE WHEN Status='unused' THEN 1 END) AS unused,
      COUNT(CASE WHEN Status='redeemed' AND (ExpiresAt>@now OR ExpiresAt IS NULL) THEN 1 END) AS active,
      COUNT(CASE WHEN Status='redeemed' AND ExpiresAt<=@now THEN 1 END) AS expired
      FROM dbo.Vouchers`),
    bound(pool, options).query(`SELECT COUNT(*) AS total FROM dbo.Vouchers ${where}`),
    bound(pool, options).query(`SELECT Id, DurationMinutes, CreatedAt, RedeemedAt, ExpiresAt,
      ${voucherStatus} AS DisplayStatus FROM dbo.Vouchers ${where}
      ORDER BY CreatedAt DESC, Id DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`),
  ]);
  const total = countResult.recordset[0].total;
  const stats = statsResult.recordset[0];
  return { page: options.page, total, totalPages: Math.ceil(total / options.limit),
    stats: { total: stats.total, unused: stats.unused, active: stats.active, expired: stats.expired },
    generatedAt: options.now,
    items: rowsResult.recordset.map((row) => ({ id: uuid(row.Id), durationMinutes: row.DurationMinutes,
      createdAt: iso(row.CreatedAt), redeemedAt: iso(row.RedeemedAt), expiresAt: iso(row.ExpiresAt), status: row.DisplayStatus })) };
}

async function activations(options) {
  const pool = await getPool();
  const where = `WHERE (@status='all' OR ${sessionStatus}=@status)
    AND (CONVERT(varchar(36), Id) LIKE @search OR CONVERT(varchar(36), VoucherId) LIKE @search)`;
  const [countResult, rowsResult] = await Promise.all([
    bound(pool, options).query(`SELECT COUNT(*) AS total FROM dbo.GuestSessions ${where}`),
    bound(pool, options).query(`SELECT Id, VoucherId, DurationMinutes, StartedAt, ExpiresAt,
      ${sessionStatus} AS DisplayStatus FROM dbo.GuestSessions ${where}
      ORDER BY StartedAt DESC, Id DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`),
  ]);
  const total = countResult.recordset[0].total;
  return { page: options.page, total, totalPages: Math.ceil(total / options.limit), generatedAt: options.now,
    items: rowsResult.recordset.map((row) => ({ id: uuid(row.Id), voucherId: uuid(row.VoucherId),
      durationMinutes: row.DurationMinutes, startedAt: iso(row.StartedAt), expiresAt: iso(row.ExpiresAt), status: row.DisplayStatus })) };
}

module.exports = { vouchers, activations };
