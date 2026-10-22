const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_IPS = 2048;
const attempts = new Map();

function limitVoucherRedeems(req, res, next) {
  // Existing high-entropy QR tokens keep their original redemption behavior.
  if (typeof req.body?.code === 'string' && /^[a-f0-9]{64}$/.test(req.body.code.trim())) return next();
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  let entry = attempts.get(ip);
  if (entry && now >= entry.startedAt + WINDOW_MS) {
    attempts.delete(ip);
    entry = null;
  }
  if (!entry) {
    for (const [key, value] of attempts) {
      if (now >= value.startedAt + WINDOW_MS) attempts.delete(key);
    }
    if (attempts.size >= MAX_IPS) return res.status(429).json({ error: 'Quá nhiều lần thử kích hoạt. Hãy thử lại sau 15 phút.' });
    entry = { startedAt: now, count: 0 };
    attempts.set(ip, entry);
  }
  if (entry.count >= MAX_ATTEMPTS) {
    res.set('Retry-After', String(Math.ceil((entry.startedAt + WINDOW_MS - now) / 1000)));
    return res.status(429).json({ error: 'Quá nhiều lần thử kích hoạt. Hãy thử lại sau 15 phút.' });
  }
  entry.count++;
  return next();
}

limitVoucherRedeems.clear = () => attempts.clear();
module.exports = limitVoucherRedeems;
