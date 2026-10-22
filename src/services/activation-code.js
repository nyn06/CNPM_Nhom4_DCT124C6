const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PATTERN = /^[A-Za-z0-9]{7}$/;
const MAX_CREATE_ATTEMPTS = 10;

function generate() {
  let code = '';
  for (let i = 0; i < 7; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

function hash(code) {
  const secret = process.env.ACTIVATION_CODE_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) {
    throw Object.assign(new Error('Cần cấu hình ACTIVATION_CODE_SECRET (ít nhất 32 ký tự).'),
      { statusCode: 503, code: 'ACTIVATION_CODE_UNAVAILABLE' });
  }
  return crypto.createHmac('sha256', secret).update(code).digest('hex');
}

module.exports = { PATTERN, MAX_CREATE_ATTEMPTS, generate, hash };
