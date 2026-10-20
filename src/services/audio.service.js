module.exports = process.env.NODE_ENV === 'test' && process.env.DB_INTEGRATION !== '1' ? require('./audio.service.memory') : require('./sql/audio.service');
