module.exports = process.env.NODE_ENV === 'test' && process.env.DB_INTEGRATION !== '1' ? require('./account.repository.memory') : require('./sql/account.repository');
