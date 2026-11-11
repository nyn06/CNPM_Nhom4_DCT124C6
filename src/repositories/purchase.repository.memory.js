const access = require('./access.repository.memory');
const payments = new Map();
const lookup = (codeHash) => {
  const voucher = access.findVoucherByCodeHash(codeHash);
  if (!voucher) return { failure: 'invalid' };
  return { voucher, payment: payments.get(voucher.id) || null };
};
const available = (result) => result.failure || result.voucher.status !== 'unused'
  ? { failure: result.failure || 'used' } : result.voucher.durationMinutes !== null
    ? { failure: 'legacy' } : null;
module.exports = {
  findByVoucherId: (id) => payments.get(id) || null,
  inspect: async (codeHash) => lookup(codeHash),
  async choose(codeHash, proposed) {
    const result = lookup(codeHash);
    const failure = available(result);
    if (failure) return failure;
    if (result.payment?.status === 'paid') return { failure: 'paid' };
    const payment = result.payment ? { ...result.payment, durationMinutes: proposed.durationMinutes,
      amountVnd: proposed.amountVnd } : proposed;
    payments.set(result.voucher.id, payment);
    return { ...result, payment };
  },
  async pay(codeHash, paidAt) {
    const result = lookup(codeHash);
    const failure = available(result);
    if (failure) return failure;
    if (!result.payment) return { failure: 'unpaid' };
    const payment = result.payment.status === 'paid' ? result.payment : { ...result.payment, status: 'paid', paidAt };
    payments.set(result.voucher.id, payment);
    return { ...result, payment };
  },
  async start(codeHash, createSession) {
    const result = lookup(codeHash);
    const failure = available(result);
    if (failure) return failure;
    if (result.payment?.status !== 'paid') return { failure: 'unpaid' };
    const issued = access.redeemOnce(codeHash, (voucher) => createSession(voucher, result.payment), true);
    if (issued.failure) return issued;
    payments.set(result.voucher.id, { ...result.payment, startedAt: issued.session.startedAt });
    return issued;
  },
  clear: () => payments.clear(),
};
