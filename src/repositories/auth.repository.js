module.exports = process.env.NODE_ENV === 'test' && process.env.DB_INTEGRATION !== '1' ? require('./auth.repository.memory') : require('./sql/auth.repository');
