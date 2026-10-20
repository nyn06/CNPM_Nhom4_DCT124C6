const service = require('../services/auth.service');
const config = require('../config/auth');
const { cookie, cookieOptions, checkOrigin, clearSession } = require('../utils/authHttp');

class AuthController {
  async getCsrf(req, res, next) {
    try {
      checkOrigin(req);
      const result = await service.getCsrf(cookie(req, config.SESSION_COOKIE), cookie(req, config.CHALLENGE_COOKIE));
      if (result.challengeToken) res.cookie(config.CHALLENGE_COOKIE, result.challengeToken, { ...cookieOptions(req), maxAge: config.CHALLENGE_TTL_MS });
      res.json({ csrfToken: result.csrfToken });
    } catch (error) { next(error); }
  }
  async login(req, res, next) {
    try {
      // Use the actual socket IP. X-Forwarded-For is not a login-limit identity.
      const result = await service.login(req.body, req.socket.remoteAddress, cookie(req, config.SESSION_COOKIE));
      await service.consumeChallenge(cookie(req, config.CHALLENGE_COOKIE));
      res.clearCookie(config.CHALLENGE_COOKIE, cookieOptions(req));
      res.cookie(config.SESSION_COOKIE, result.token, { ...cookieOptions(req), maxAge: config.SESSION_TTL_MS });
      res.json({ user: result.user, csrfToken: result.session.csrfToken,
        expiresAt: new Date(result.session.expiresAt).toISOString(), serverTime: new Date(Date.now()).toISOString() });
    } catch (error) { next(error); }
  }
  me(req, res) {
    res.json({ user: req.admin.user, csrfToken: req.admin.session.csrfToken,
      expiresAt: new Date(req.admin.session.expiresAt).toISOString(), serverTime: new Date(Date.now()).toISOString() });
  }
  async logout(req, res, next) {
    try {
      await service.logout(cookie(req, config.SESSION_COOKIE));
      await service.consumeChallenge(cookie(req, config.CHALLENGE_COOKIE));
      clearSession(req, res);
      res.clearCookie(config.CHALLENGE_COOKIE, cookieOptions(req));
      res.status(204).end();
    } catch (error) { next(error); }
  }
}
module.exports = new AuthController();
