module.exports = process.env.NODE_ENV === 'test' && process.env.DB_INTEGRATION !== '1' ? require('./job.repository.memory') : require('./sql/job.repository');
