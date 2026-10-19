const accessService = require('../services/access.service');
const { requireAdmin, requireRoles } = require('./requireAdmin');
const { cookie } = require('../utils/authHttp');
const { SESSION_COOKIE } = require('../config/auth');

function requireAccess(req, res, next) {
  try {
    req.accessSession = accessService.validateAuthorization(req.get('authorization'));
    res.set('Cache-Control', 'no-store');
    next();
  } catch (error) { next(error); }
}

// Shared read endpoint: explicit tourist Bearer token remains independent of
// the admin cookie. X-Demo-Admin never grants access.
function narrationAccess(req, res, next) {
  try {
    if (!req.get('authorization') && cookie(req, SESSION_COOKIE)) {
      return requireAdmin(req, res, (error) => error ? next(error) : requireRoles('ADMIN', 'POI_MANAGER')(req, res, next));
    }
    requireAccess(req, res, next);
  } catch (error) { next(error); }
}

module.exports = { requireAccess, narrationAccess };
