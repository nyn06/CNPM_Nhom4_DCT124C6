const bcrypt = require('bcryptjs');
const repository = require('../../repositories/auth.repository');
const accounts = require('../../repositories/account.repository');
const accountService = require('../account.service');
const config = require('../../config/auth');
const { error, hashToken, randomToken, validToken, equalToken } = require('../../utils/auth');
let dummyHash;
let inFlight = 0;

class AuthService {
  async login(data, ip, oldToken) {
    const name = typeof data?.username === 'string' ? data.username.slice(0, 64).toLowerCase() : '';
    const userKey = `user:${hashToken(name)}`;
    repository.recordLoginAttempt(`ip:${hashToken(ip || 'unknown')}`, userKey);
    if (inFlight >= config.MAX_LOGIN_IN_FLIGHT) throw error('Quá nhiều yêu cầu đăng nhập. Hãy thử lại sau.', 429);
    inFlight++;
    try {
      const account = await accounts.findByUsername(name);
      // Unknown/locked usernames still perform an expensive bcrypt comparison.
      if (!dummyHash) dummyHash = bcrypt.hash(randomToken(), config.BCRYPT_COST);
      const password = typeof data?.password === 'string' && Buffer.byteLength(data.password, 'utf8') <= 72 ? data.password : '';
      const matches = await bcrypt.compare(password, account?.passwordHash || await dummyHash);
      const current = account && await accounts.findById(account.id);
      if (!matches || !current || current.isLocked || current.version !== account.version
        || typeof data?.username !== 'string' || data.username.length > 64) {
        throw error('Tên đăng nhập hoặc mật khẩu không đúng.', 401);
      }
      const token = randomToken();
      const session = {
        tokenHash: hashToken(token), userId: current.id, accountVersion: current.version,
        csrfToken: randomToken(), expiresAt: Date.now() + config.SESSION_TTL_MS,
      };
      await repository.createSession(session);
      if (validToken(oldToken)) await repository.deleteSession(hashToken(oldToken));
      repository.clearUserAttempts(userKey);
      return { token, session, user: accountService.publicAccount(current) };
    } finally { inFlight--; }
  }
  async authenticate(token) {
    if (!validToken(token)) throw error('Cần đăng nhập quản trị.', 401);
    const session = await repository.findSession(hashToken(token));
    const account = session && await accounts.findById(session.userId);
    if (!session || !account || account.isLocked || session.accountVersion !== account.version) {
      if (session) await repository.deleteSession(session.tokenHash);
      throw error('Phiên quản trị đã hết hạn hoặc không còn hợp lệ.', 401);
    }
    return { session, user: accountService.publicAccount(account) };
  }
  async logout(token) { if (validToken(token)) await repository.deleteSession(hashToken(token)); }
  async getCsrf(sessionToken, challengeToken) {
    try { return { csrfToken: (await this.authenticate(sessionToken)).session.csrfToken }; } catch { /* Issue pre-login context. */ }
    const existing = validToken(challengeToken) && await repository.findChallenge(hashToken(challengeToken));
    if (existing) return { csrfToken: existing.csrfToken };
    const token = randomToken();
    const challenge = { tokenHash: hashToken(token), csrfToken: randomToken(), expiresAt: Date.now() + config.CHALLENGE_TTL_MS };
    await repository.createChallenge(challenge);
    return { csrfToken: challenge.csrfToken, challengeToken: token };
  }
  async validateCsrf(sessionToken, challengeToken, submitted, allowAnonymous = false) {
    let expected;
    try { expected = (await this.authenticate(sessionToken)).session.csrfToken; } catch { /* Check anonymous only for login. */ }
    if (!expected && allowAnonymous && validToken(challengeToken)) expected = (await repository.findChallenge(hashToken(challengeToken)))?.csrfToken;
    if (!equalToken(submitted, expected)) throw error('CSRF token không hợp lệ. Hãy tải lại trang.', 403);
  }
  async consumeChallenge(token) { if (validToken(token)) await repository.deleteChallenge(hashToken(token)); }
}
module.exports = new AuthService();
