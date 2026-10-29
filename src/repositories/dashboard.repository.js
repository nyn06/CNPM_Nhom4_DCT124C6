module.exports = process.env.NODE_ENV === 'test' && process.env.DB_INTEGRATION !== '1'
  ? require('./dashboard.repository.memory') : require('./sql/dashboard.repository');
