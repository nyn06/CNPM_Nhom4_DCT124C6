const authService = require('../services/auth.service');
const { SESSION_COOKIE } = require('../config/auth');
const { cookie, clearSession } = require('../utils/authHttp');

async function requireAdmin(req, res, next) {
  res.set('Cache-Control', 'no-store');
  try { req.admin = await authService.authenticate(cookie(req, SESSION_COOKIE)); next(); }
  catch (error) { clearSession(req, res); next(error); }
}
function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: 'Cần đăng nhập quản trị.' });
    if (!roles.includes(req.admin.user.role)) return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' });
    next();
  };
}
async function adminPage(req, res, next) {
  res.set('Cache-Control', 'no-store');
  try { req.admin = await authService.authenticate(cookie(req, SESSION_COOKIE)); next(); }
  catch { clearSession(req, res); res.redirect('/admin-login.html'); }
}
module.exports = { requireAdmin, requireRoles, adminPage };
