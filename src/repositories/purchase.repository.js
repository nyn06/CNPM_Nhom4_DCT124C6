module.exports = process.env.NODE_ENV === 'test' && process.env.DB_INTEGRATION !== '1'
  ? require('./purchase.repository.memory') : require('./sql/purchase.repository');
