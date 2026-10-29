module.exports = process.env.NODE_ENV === 'test' && process.env.DB_INTEGRATION !== '1'
  ? require('./poi-translation.repository.memory') : require('./sql/poi-translation.repository');
