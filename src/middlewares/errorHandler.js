// Middleware xử lý lỗi tập trung — mọi lỗi từ Controller (next(err)) đều về đây
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message || 'Lỗi hệ thống',
  });
}

module.exports = errorHandler;
