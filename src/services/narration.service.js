module.exports = process.env.NODE_ENV === 'test' && process.env.DB_INTEGRATION !== '1' ? require('./narration.service.memory') : require('./sql/narration.service');
