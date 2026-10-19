const config = require('../config/auth');
const { error } = require('./auth');

function cookie(req, name) {
  const header = req.get('cookie') || '';
  if (header.length > 8192) throw error('Cookie không hợp lệ.', 401);
  const values = header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length > 1) throw error('Cookie không hợp lệ.', 401);
  return values.length ? values[0].slice(name.length + 1) : null;
}
function cookieOptions(req) {
  return { httpOnly: true, sameSite: 'strict', secure: req.secure || process.env.NODE_ENV === 'production', path: '/' };
}
function origin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
  return url.origin;
}
function validateConfig(env = process.env) {
  try {
    if (env.ADMIN_ORIGIN) origin(env.ADMIN_ORIGIN);
    if (env.NODE_ENV === 'production' && (!env.ADMIN_ORIGIN || !env.ADMIN_ORIGIN.startsWith('https://'))) throw new Error();
  } catch { throw error('Cấu hình ADMIN_ORIGIN không hợp lệ; production cần origin HTTPS.', 503); }
}
function checkOrigin(req) {
  try {
    const expected = origin(process.env.ADMIN_ORIGIN || `${req.protocol}://${req.get('host')}`);
    const supplied = req.get('origin');
    if (req.get('sec-fetch-site') === 'cross-site' || (supplied && origin(supplied) !== expected)) throw new Error();
  } catch { throw error('Nguồn yêu cầu quản trị không hợp lệ.', 403); }
}
function clearSession(req, res) { res.clearCookie(config.SESSION_COOKIE, cookieOptions(req)); }
module.exports = { cookie, cookieOptions, validateConfig, checkOrigin, clearSession };
