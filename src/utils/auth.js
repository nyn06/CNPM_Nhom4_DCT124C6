const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { BCRYPT_COST } = require('../config/auth');
const error = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('hex');
const validToken = (token) => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
const equalToken = (first, second) => validToken(first) && validToken(second)
  && crypto.timingSafeEqual(Buffer.from(first, 'hex'), Buffer.from(second, 'hex'));

function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(value)) {
    throw error('Username cần 3–64 ký tự: chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.', 400);
  }
  return value.toLowerCase();
}
function validatePassword(value) {
  // bcrypt silently truncates beyond 72 UTF-8 bytes. Reject instead.
  if (typeof value !== 'string' || value.length < 12 || Buffer.byteLength(value, 'utf8') > 72) {
    throw error('Mật khẩu cần ít nhất 12 ký tự và không vượt quá 72 byte UTF-8.', 400);
  }
}
const passwordHash = async (value) => { validatePassword(value); return bcrypt.hash(value, BCRYPT_COST); };
module.exports = { error, hashToken, randomToken, validToken, equalToken, username, validatePassword, passwordHash };
