const net = require('net');

// Demo boundary, NOT authentication. Disabled by default and ALWAYS disabled in
// production. Never trust Host/forwarded headers as proof of a local client.
function demoAdmin(req, res, next) {
  let host;
  let sameOrigin = false;
  try {
    const expected = new URL(`${req.protocol}://${req.get('host')}`);
    host = expected.hostname;
    const origin = req.get('origin');
    sameOrigin = !origin || new URL(origin).origin === expected.origin;
  } catch { /* Reject malformed origin/host without exposing them. */ }
  const remote = req.socket.remoteAddress;
  const ip = remote?.startsWith('::ffff:') ? remote.slice(7) : remote;
  const local = ip === '::1' || (net.isIP(ip || '') === 4 && ip.startsWith('127.'));
  const localHost = host === 'localhost' || host === '[::1]'
    || (net.isIP(host || '') === 4 && host.startsWith('127.'));
  const forwarded = Object.keys(req.headers).some((name) => name === 'forwarded' || name.startsWith('x-forwarded-'));
  if (process.env.DEMO_ADMIN_ENABLED !== 'true' || process.env.NODE_ENV === 'production'
    || !local || !localHost || forwarded || !sameOrigin || req.get('sec-fetch-site') === 'cross-site') {
    return res.status(403).json({ error: 'Quản trị chỉ dành cho demo local; không triển khai công khai.', code: 'DEMO_ADMIN_DISABLED' });
  }
  res.set('Cache-Control', 'no-store');
  req.demoAdmin = true;
  next();
}

module.exports = demoAdmin;
