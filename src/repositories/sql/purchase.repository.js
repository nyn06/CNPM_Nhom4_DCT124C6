const { sql, getPool, request, iso, uuid } = require('../../database/repository');

const voucherOf = (row) => row && { id: uuid(row.Id), durationMinutes: row.DurationMinutes,
  status: row.Status, expiresAt: iso(row.ExpiresAt) };
const paymentOf = (row) => row && { id: uuid(row.Id), voucherId: uuid(row.VoucherId),
  durationMinutes: row.DurationMinutes, amountVnd: row.AmountVnd, status: row.Status,
  createdAt: iso(row.CreatedAt), paidAt: iso(row.PaidAt), startedAt: iso(row.StartedAt) };
async function lookup(connection, codeHash, lock = '') {
  const voucher = voucherOf((await request(connection, { codeHash }).query(
    `SELECT Id, DurationMinutes, Status, ExpiresAt FROM dbo.Vouchers ${lock} WHERE CodeHash=@codeHash OR ShortCodeHash=@codeHash`)).recordset[0]);
  if (!voucher) return { failure: 'invalid' };
  const payment = paymentOf((await request(connection, { voucherId: voucher.id }).query(
    `SELECT * FROM dbo.VoucherPayments ${lock} WHERE VoucherId=TRY_CONVERT(uniqueidentifier, @voucherId)`)).recordset[0]);
  return { voucher, payment };
}
const available = (result) => result.failure ? result : result.voucher.status !== 'unused'
  ? { failure: 'used' } : result.voucher.durationMinutes !== null ? { failure: 'legacy' } : null;
async function transaction(work) {
  const tx = new sql.Transaction(await getPool());
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try { const result = await work(tx); await tx.commit(); return result; }
  catch (cause) { await tx.rollback(); throw cause; }
}
const locked = 'WITH (UPDLOCK, HOLDLOCK)';

module.exports = {
  async inspect(codeHash) { return lookup(await getPool(), codeHash); },
  async choose(codeHash, proposed) {
    return transaction(async (tx) => {
      const result = await lookup(tx, codeHash, locked);
      const failure = available(result);
      if (failure) return failure;
      if (result.payment?.status === 'paid') return { failure: 'paid' };
      if (result.payment) {
        await request(tx, { id: result.payment.id, durationMinutes: proposed.durationMinutes,
          amountVnd: proposed.amountVnd }).query(`UPDATE dbo.VoucherPayments
          SET DurationMinutes=@durationMinutes, AmountVnd=@amountVnd
          WHERE Id=TRY_CONVERT(uniqueidentifier, @id) AND Status='pending'`);
        return { ...result, payment: { ...result.payment, durationMinutes: proposed.durationMinutes, amountVnd: proposed.amountVnd } };
      }
      await request(tx, { ...proposed, voucherId: result.voucher.id }).query(`INSERT dbo.VoucherPayments
        (Id, VoucherId, DurationMinutes, AmountVnd, Status, CreatedAt)
        VALUES (TRY_CONVERT(uniqueidentifier, @id), TRY_CONVERT(uniqueidentifier, @voucherId),
          @durationMinutes, @amountVnd, @status, @createdAt)`);
      return { ...result, payment: proposed };
    });
  },
  async pay(codeHash, paidAt) {
    return transaction(async (tx) => {
      const result = await lookup(tx, codeHash, locked);
      const failure = available(result);
      if (failure) return failure;
      if (!result.payment) return { failure: 'unpaid' };
      if (result.payment.status === 'paid') return result;
      await request(tx, { id: result.payment.id, paidAt }).query(`UPDATE dbo.VoucherPayments
        SET Status='paid', PaidAt=@paidAt WHERE Id=TRY_CONVERT(uniqueidentifier, @id) AND Status='pending'`);
      return { ...result, payment: { ...result.payment, status: 'paid', paidAt } };
    });
  },
  async start(codeHash, createSession) {
    return transaction(async (tx) => {
      const result = await lookup(tx, codeHash, locked);
      const failure = available(result);
      if (failure) return failure;
      if (result.payment?.status !== 'paid') return { failure: 'unpaid' };
      const { session, accessToken } = createSession(result.voucher, result.payment);
      await request(tx, session).query(`INSERT dbo.GuestSessions
        (Id, TokenHash, VoucherId, DurationMinutes, StartedAt, ExpiresAt, RevokedAt)
        VALUES (TRY_CONVERT(uniqueidentifier, @id), @tokenHash, TRY_CONVERT(uniqueidentifier, @voucherId),
          @durationMinutes, @startedAt, @expiresAt, @revokedAt)`);
      const updated = await request(tx, { voucherId: result.voucher.id, sessionId: session.id,
        redeemedAt: session.startedAt, expiresAt: session.expiresAt }).query(`UPDATE dbo.Vouchers
          SET Status='redeemed', RedeemedAt=@redeemedAt, ExpiresAt=@expiresAt,
            SessionId=TRY_CONVERT(uniqueidentifier, @sessionId)
          WHERE Id=TRY_CONVERT(uniqueidentifier, @voucherId) AND Status='unused' AND DurationMinutes IS NULL`);
      if (updated.rowsAffected[0] !== 1) throw new Error('Voucher start conflict');
      await request(tx, { id: result.payment.id, startedAt: session.startedAt }).query(`UPDATE dbo.VoucherPayments
        SET StartedAt=@startedAt WHERE Id=TRY_CONVERT(uniqueidentifier, @id) AND Status='paid' AND StartedAt IS NULL`);
      return { session, accessToken };
    });
  },
};
