const config = require('../config/auth');
const { error } = require('../utils/auth');
const sessions = new Map();
const challenges = new Map();
const attempts = new Map();

class AuthRepository {
  _prune(map, now = Date.now()) {
    for (const [key, value] of map) if (value.expiresAt <= now) map.delete(key);
  }
  _insert(map, key, value, limit) {
    this._prune(map);
    if (map.size >= limit) throw error('Bộ nhớ xác thực đã đầy. Hãy thử lại sau.', 503);
    map.set(key, { ...value });
  }
  _find(map, key) {
    const value = map.get(key);
    if (!value || value.expiresAt <= Date.now()) { map.delete(key); return null; }
    return { ...value };
  }
  createSession(session) { this._insert(sessions, session.tokenHash, session, config.MAX_SESSIONS); }
  findSession(hash) { return this._find(sessions, hash); }
  deleteSession(hash) { sessions.delete(hash); }
  revokeUser(userId) { for (const [key, session] of sessions) if (session.userId === userId) sessions.delete(key); }
  createChallenge(challenge) { this._insert(challenges, challenge.tokenHash, challenge, config.MAX_CHALLENGES); }
  findChallenge(hash) { return this._find(challenges, hash); }
  deleteChallenge(hash) { challenges.delete(hash); }

  // Bound BOTH account and socket-IP buckets. At capacity fail closed instead
  // of evicting live buckets, which would allow an attacker to reset limits.
  recordLoginAttempt(ipKey, userKey) {
    this._prune(attempts);
    const now = Date.now();
    for (const [key, limit] of [[ipKey, config.MAX_LOGIN_IP_ATTEMPTS], [userKey, config.MAX_LOGIN_USER_ATTEMPTS]]) {
      const bucket = attempts.get(key);
      if ((!bucket && attempts.size >= config.MAX_ATTEMPT_KEYS) || bucket?.count >= limit) {
        throw error('Quá nhiều lần đăng nhập. Hãy thử lại sau 15 phút.', 429);
      }
      attempts.set(key, { count: (bucket?.count || 0) + 1, expiresAt: bucket?.expiresAt || now + config.ATTEMPT_WINDOW_MS });
    }
  }
  clearUserAttempts(key) { attempts.delete(key); }
  stats() { return { sessions: sessions.size, challenges: challenges.size, attemptKeys: attempts.size }; }
  clear() { sessions.clear(); challenges.clear(); attempts.clear(); }
}
module.exports = new AuthRepository();
