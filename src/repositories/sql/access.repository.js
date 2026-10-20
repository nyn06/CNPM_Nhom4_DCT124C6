const { sql, getPool, request, iso, uuid } = require('../../database/repository');
const mapVoucher = (r) => r && ({ id: uuid(r.Id), codeHash: r.CodeHash, durationMinutes: r.DurationMinutes,
  status: r.Status, createdAt: iso(r.CreatedAt), redeemedAt: iso(r.RedeemedAt),
  expiresAt: iso(r.ExpiresAt), sessionId: uuid(r.SessionId) });
const mapSession = (r) => r && ({ id: uuid(r.Id), tokenHash: r.TokenHash, voucherId: uuid(r.VoucherId),
  durationMinutes: r.DurationMinutes, startedAt: iso(r.StartedAt), expiresAt: iso(r.ExpiresAt),
  revokedAt: iso(r.RevokedAt) });
class SqlAccessRepository {
  async createVoucher(voucher) {
    try {
      await request(await getPool(), voucher).query(`INSERT dbo.Vouchers
        (Id, CodeHash, DurationMinutes, Status, CreatedAt)
        VALUES (TRY_CONVERT(uniqueidentifier, @id), @codeHash, @durationMinutes, @status, @createdAt)`);
      return { ...voucher, id: uuid(voucher.id), sessionId: uuid(voucher.sessionId) };
    } catch (cause) {
      if ([2601, 2627].includes(cause.number)) return null;
      throw cause;
    }
  }
  async findAllVouchers() {
    return (await (await getPool()).request().query('SELECT * FROM dbo.Vouchers ORDER BY CreatedAt')).recordset.map(mapVoucher);
  }
  async redeemOnce(codeHash, createSession) {
    const tx = new sql.Transaction(await getPool());
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const voucher = mapVoucher((await request(tx, { codeHash }).query(
        'SELECT * FROM dbo.Vouchers WITH (UPDLOCK, HOLDLOCK) WHERE CodeHash=@codeHash')).recordset[0]);
      if (!voucher || voucher.status !== 'unused') {
        await tx.rollback();
        return { failure: voucher ? 'used' : 'invalid' };
      }
      const { session, accessToken } = createSession(voucher);
      await request(tx, session).query(`INSERT dbo.GuestSessions
        (Id, TokenHash, VoucherId, DurationMinutes, StartedAt, ExpiresAt, RevokedAt)
        VALUES (TRY_CONVERT(uniqueidentifier, @id), @tokenHash, TRY_CONVERT(uniqueidentifier, @voucherId),
        @durationMinutes, @startedAt, @expiresAt, @revokedAt)`);
      const result = await request(tx, { codeHash, sessionId: session.id, redeemedAt: session.startedAt, expiresAt: session.expiresAt })
        .query(`UPDATE dbo.Vouchers SET Status='redeemed', RedeemedAt=@redeemedAt,
          ExpiresAt=@expiresAt, SessionId=TRY_CONVERT(uniqueidentifier, @sessionId)
          WHERE CodeHash=@codeHash AND Status='unused'`);
      if (result.rowsAffected[0] !== 1) throw new Error('Voucher redemption conflict');
      await tx.commit();
      return { session: { ...session, id: uuid(session.id), voucherId: uuid(session.voucherId) }, accessToken };
    } catch (cause) { await tx.rollback(); throw cause; }
  }
  async findSession(tokenHash) {
    return mapSession((await request(await getPool(), { tokenHash }).query(
      'SELECT * FROM dbo.GuestSessions WHERE TokenHash=@tokenHash')).recordset[0]);
  }
}
module.exports = new SqlAccessRepository();
