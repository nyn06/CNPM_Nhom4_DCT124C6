module.exports = process.env.NODE_ENV === 'test' && process.env.DB_INTEGRATION !== '1' ? require('./poi.service.memory') : require('./sql/poi.service');
