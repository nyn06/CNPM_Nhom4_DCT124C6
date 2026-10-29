module.exports = process.env.NODE_ENV === 'test' && process.env.DB_INTEGRATION !== '1'
  ? require('./voucher-management.repository.memory') : require('./sql/voucher-management.repository');
