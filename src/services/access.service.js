module.exports = process.env.NODE_ENV === 'test' && process.env.DB_INTEGRATION !== '1' ? require('./access.service.memory') : require('./sql/access.service');
