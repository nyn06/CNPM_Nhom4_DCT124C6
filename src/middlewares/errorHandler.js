// Middleware xử lý lỗi tập trung — mọi lỗi từ Controller (next(err)) đều về đây
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;
  if (statusCode === 429) res.set('Retry-After', '900');
  res.status(statusCode).json({
    error: err.type === 'entity.parse.failed' ? 'JSON không hợp lệ.'
      : err instanceof URIError ? 'Đường dẫn không hợp lệ.'
        : (err.statusCode ? err.message : 'Lỗi hệ thống'),
    ...(err.code && typeof err.code === 'string' && err.code.startsWith('ACCESS_') ? { code: err.code } : {}),
  });
}

module.exports = errorHandler;
