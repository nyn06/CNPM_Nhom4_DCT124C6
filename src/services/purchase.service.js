const crypto = require('crypto');
const repository = require('../repositories/purchase.repository');
const shortCode = require('./activation-code');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const error = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code });
const prices = () => [15, 30, 60].map((durationMinutes) => {
  const configured = process.env[`TOUR_PRICE_${durationMinutes}`];
  const amountVnd = configured === undefined ? durationMinutes * 1000 : Number(configured);
  if (!Number.isSafeInteger(amountVnd) || amountVnd <= 0 || amountVnd > 2147483647)
    throw error('Cấu hình giá vé không hợp lệ.', 503, 'PRICE_CONFIGURATION');
  return { durationMinutes, amountVnd };
});
const demoEnabled = () => ['development', 'test'].includes(process.env.NODE_ENV)
  && process.env.DEMO_PAYMENT_ENABLED === 'true';

function codeHash(data) {
  const code = typeof data?.code === 'string' ? data.code.trim() : '';
  if (shortCode.PATTERN.test(code)) return shortCode.hash(code);
  if (/^[a-f0-9]{64}$/.test(code)) return hash(code);
  throw error('Mã vé không hợp lệ.', 400, 'INVALID_VOUCHER');
}
function checked(result) {
  if (result.failure === 'invalid') throw error('Mã vé không hợp lệ.', 400, 'INVALID_VOUCHER');
  if (result.failure === 'legacy') throw error('Vé cũ đã có thời hạn; dùng nút kích hoạt vé.', 409, 'LEGACY_VOUCHER');
  if (result.failure === 'used') throw error('Vé đã được kích hoạt.', 409, 'VOUCHER_USED');
  if (result.failure === 'unpaid') throw error('Vé chưa được thanh toán.', 409, 'PAYMENT_REQUIRED');
  if (result.failure === 'paid') throw error('Vé đã thanh toán, không thể đổi gói.', 409, 'ALREADY_PAID');
  return result;
}
function publicState(result) {
  const payment = result.payment;
  const consumed = result.voucher.status === 'redeemed';
  return { voucherId: result.voucher.id, status: consumed
    ? result.voucher.expiresAt && Date.now() >= Date.parse(result.voucher.expiresAt) ? 'expired' : 'active'
    : payment?.status || 'unselected', legacy: result.voucher.durationMinutes !== null,
  payment: payment && { id: payment.id, durationMinutes: payment.durationMinutes,
    amountVnd: payment.amountVnd, status: payment.status, createdAt: payment.createdAt,
    paidAt: payment.paidAt, startedAt: payment.startedAt },
  demoEnabled: demoEnabled(), packages: prices() };
}

module.exports = {
  packages: () => ({ packages: prices(), demoEnabled: demoEnabled() }),
  async inspect(data) { return publicState(checked(await repository.inspect(codeHash(data)))); },
  async choose(data) {
    const selected = prices().find((item) => item.durationMinutes === data?.durationMinutes);
    if (!selected) throw error('Gói thời gian không hợp lệ.', 400, 'INVALID_PACKAGE');
    const result = checked(await repository.choose(codeHash(data), {
      id: crypto.randomUUID(), ...selected, status: 'pending', createdAt: new Date().toISOString(), paidAt: null, startedAt: null,
    }));
    return publicState(result);
  },
  async pay(data) {
    if (!demoEnabled()) throw error('Thanh toán mô phỏng chỉ khả dụng trong môi trường demo được bật.', 403, 'DEMO_PAYMENT_DISABLED');
    return publicState(checked(await repository.pay(codeHash(data), new Date().toISOString())));
  },
  async start(data) {
    const result = checked(await repository.start(codeHash(data), (voucher, payment) => {
      const accessToken = crypto.randomBytes(32).toString('hex');
      const now = Date.now();
      return { accessToken, session: { id: crypto.randomUUID(), tokenHash: hash(accessToken),
        voucherId: voucher.id, durationMinutes: payment.durationMinutes,
        startedAt: new Date(now).toISOString(), expiresAt: new Date(now + payment.durationMinutes * 60000).toISOString(), revokedAt: null } };
    }));
    return { accessToken: result.accessToken, startedAt: result.session.startedAt,
      expiresAt: result.session.expiresAt, durationMinutes: result.session.durationMinutes,
      serverTime: new Date().toISOString() };
  },
};
