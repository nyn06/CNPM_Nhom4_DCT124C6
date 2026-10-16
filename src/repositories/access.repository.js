const vouchers = new Map();
const sessions = new Map();

class AccessRepository {
  createVoucher(voucher) {
    if (vouchers.has(voucher.codeHash)) return null;
    vouchers.set(voucher.codeHash, { ...voucher });
    return { ...voucher };
  }

  findAllVouchers() {
    return Array.from(vouchers.values(), (voucher) => ({ ...voucher }));
  }

  // Atomic within ONE Node process: validation, session creation and voucher
  // consumption run synchronously with no await between them. A database
  // implementation must replace this with a transaction + conditional update.
  redeemOnce(codeHash, createSession) {
    const voucher = vouchers.get(codeHash);
    if (!voucher) return { failure: 'invalid' };
    if (voucher.status !== 'unused') return { failure: 'used' };
    const { session, accessToken } = createSession({ ...voucher });
    sessions.set(session.tokenHash, { ...session });
    vouchers.set(codeHash, {
      ...voucher, status: 'redeemed', redeemedAt: session.startedAt,
      expiresAt: session.expiresAt, sessionId: session.id,
    });
    return { session: { ...session }, accessToken };
  }

  findSession(tokenHash) {
    const session = sessions.get(tokenHash);
    return session ? { ...session } : null;
  }

  clear() {
    vouchers.clear();
    sessions.clear();
  }
}

module.exports = new AccessRepository();
