const crypto = require('crypto');
const accessRepository = require('../repositories/access.repository');

const DURATIONS = Object.freeze([15, 60, 120]);
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const failure = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code });
const isLoopbackHost = (hostname) => hostname === 'localhost' || hostname === '[::1]'
  || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname);

class AccessService {
  createVoucher(data, requestOrigin) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || !DURATIONS.includes(data.durationMinutes)) {
      throw failure('durationMinutes chỉ nhận 15, 60 hoặc 120.', 400, 'INVALID_DURATION');
    }
    let origin;
    try {
      origin = new URL(process.env.PUBLIC_ORIGIN || requestOrigin);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
        || origin.pathname !== '/' || origin.search || origin.hash) throw new Error();
    } catch {
      throw failure('Cần cấu hình PUBLIC_ORIGIN là origin HTTP/HTTPS hợp lệ.', 503, 'INVALID_ORIGIN');
    }
    let code;
    let voucher;
    do {
      code = crypto.randomBytes(32).toString('hex');
      voucher = accessRepository.createVoucher({
        id: crypto.randomUUID(), codeHash: hash(code), durationMinutes: data.durationMinutes,
        status: 'unused', createdAt: new Date(Date.now()).toISOString(),
        redeemedAt: null, expiresAt: null, sessionId: null,
      });
    } while (!voucher);
    const url = new URL('/', origin);
    url.searchParams.set('voucher', code);
    return {
      ...this._voucherInfo(voucher), code, activationUrl: url.href,
      mobileReady: origin.protocol === 'https:' && !isLoopbackHost(origin.hostname),
      demoOnly: true,
    };
  }

  listVouchers() {
    return accessRepository.findAllVouchers().map((voucher) => this._voucherInfo(voucher));
  }

  redeem(data) {
    const code = typeof data?.code === 'string' ? data.code.trim() : '';
    if (!TOKEN_PATTERN.test(code)) throw failure('Mã vé không hợp lệ.', 400, 'INVALID_VOUCHER');
    const result = accessRepository.redeemOnce(hash(code), (voucher) => {
      const accessToken = crypto.randomBytes(32).toString('hex');
      const now = Date.now();
      return {
        accessToken,
        session: {
          id: crypto.randomUUID(), tokenHash: hash(accessToken), voucherId: voucher.id,
          durationMinutes: voucher.durationMinutes, startedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + voucher.durationMinutes * 60000).toISOString(), revokedAt: null,
        },
      };
    });
    if (result.failure === 'invalid') throw failure('Mã vé không hợp lệ.', 400, 'INVALID_VOUCHER');
    if (result.failure === 'used') throw failure('Vé đã được kích hoạt. Hãy dùng mã vé khác.', 409, 'VOUCHER_USED');
    return { accessToken: result.accessToken, ...this.sessionInfo(result.session) };
  }

  validateAuthorization(authorization) {
    const match = typeof authorization === 'string' && /^Bearer ([a-f0-9]{64})$/.exec(authorization);
    if (!match) throw failure('Cần kích hoạt vé để nghe thuyết minh.', 401, 'ACCESS_REQUIRED');
    const session = accessRepository.findSession(hash(match[1]));
    if (!session || session.revokedAt) throw failure('Phiên truy cập không hợp lệ. Hãy kích hoạt vé khác.', 401, 'ACCESS_INVALID');
    if (Date.now() >= Date.parse(session.expiresAt)) {
      throw failure('Phiên truy cập đã hết hạn. Hãy kích hoạt vé khác.', 401, 'ACCESS_EXPIRED');
    }
    return session;
  }

  sessionInfo(session) {
    return {
      startedAt: session.startedAt, expiresAt: session.expiresAt,
      durationMinutes: session.durationMinutes, serverTime: new Date(Date.now()).toISOString(),
    };
  }

  _voucherInfo(voucher) {
    const status = voucher.status === 'redeemed' && Date.now() >= Date.parse(voucher.expiresAt)
      ? 'expired' : voucher.status;
    return {
      id: voucher.id, durationMinutes: voucher.durationMinutes, status,
      createdAt: voucher.createdAt, redeemedAt: voucher.redeemedAt, expiresAt: voucher.expiresAt,
    };
  }
}

module.exports = new AccessService();
