module.exports = process.env.NODE_ENV === 'test' && process.env.DB_INTEGRATION !== '1' ? require('./poi.repository.memory') : require('./sql/poi.repository');
