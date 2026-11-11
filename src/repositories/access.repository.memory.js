const vouchers = new Map();
const shortCodes = new Map();
const sessions = new Map();

class AccessRepository {
  createVoucher(voucher) {
    if (vouchers.has(voucher.codeHash) || shortCodes.has(voucher.shortCodeHash)) return null;
    vouchers.set(voucher.codeHash, { ...voucher });
    shortCodes.set(voucher.shortCodeHash, voucher.codeHash);
    return { ...voucher };
  }

  findAllVouchers() {
    return Array.from(vouchers.values(), (voucher) => ({ ...voucher }));
  }

  findVoucherByCodeHash(codeHash) {
    const voucher = vouchers.get(vouchers.has(codeHash) ? codeHash : shortCodes.get(codeHash));
    return voucher ? { ...voucher } : null;
  }

  // Atomic within ONE Node process: validation, session creation and voucher
  // consumption run synchronously with no await between them. A database
  // implementation must replace this with a transaction + conditional update.
  redeemOnce(codeHash, createSession, allowUnpriced = false) {
    const voucherKey = vouchers.has(codeHash) ? codeHash : shortCodes.get(codeHash);
    const voucher = vouchers.get(voucherKey);
    if (!voucher) return { failure: 'invalid' };
    if (voucher.status !== 'unused') return { failure: 'used' };
    if (voucher.durationMinutes === null && !allowUnpriced) return { failure: 'payment' };
    const { session, accessToken } = createSession({ ...voucher });
    sessions.set(session.tokenHash, { ...session });
    vouchers.set(voucherKey, {
      ...voucher, status: 'redeemed', redeemedAt: session.startedAt,
      expiresAt: session.expiresAt, sessionId: session.id,
    });
    return { session: { ...session }, accessToken };
  }

  findSession(tokenHash) {
    const session = sessions.get(tokenHash);
    return session ? { ...session } : null;
  }

  findRecentDashboardSessions(now) {
    return Array.from(sessions.values(), (session) => ({
      id: session.id, voucherId: session.voucherId, durationMinutes: session.durationMinutes,
      startedAt: session.startedAt, expiresAt: session.expiresAt,
      status: session.revokedAt || session.expiresAt <= now ? 'expired' : 'active',
    })).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id)).slice(0, 5);
  }

  findAllDashboardSessions() {
    return Array.from(sessions.values(), (session) => ({
      id: session.id, voucherId: session.voucherId, durationMinutes: session.durationMinutes,
      startedAt: session.startedAt, expiresAt: session.expiresAt, revokedAt: session.revokedAt,
    }));
  }

  clear() {
    vouchers.clear();
    shortCodes.clear();
    sessions.clear();
    require('./purchase.repository.memory').clear();
  }
}

module.exports = new AccessRepository();
