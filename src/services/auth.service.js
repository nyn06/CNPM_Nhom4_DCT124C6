module.exports = process.env.NODE_ENV === 'test' && process.env.DB_INTEGRATION !== '1' ? require('./auth.service.memory') : require('./sql/auth.service');
