
const authService = require('../services/auth.service');
const config = require('../config/auth');
const { cookie, checkOrigin } = require('../utils/authHttp');
const { error } = require('../utils/auth');

function csrf(allowAnonymous = false, allowMultipart = false) {
  return async (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }

    try {
      checkOrigin(req);

      const contentType = req.get('content-type')
        ?.split(';')[0]
        .trim()
        .toLowerCase();

      const validContentType =
        contentType === 'application/json' ||
        (allowMultipart && contentType === 'multipart/form-data');

      if (!validContentType) {
        throw error(
          'Yêu cầu quản trị cần định dạng hợp lệ và CSRF token.',
          403
        );
      }

      await authService.validateCsrf(
        cookie(req, config.SESSION_COOKIE),
        cookie(req, config.CHALLENGE_COOKIE),
        req.get('x-csrf-token'),
        allowAnonymous
      );

      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = csrf;
