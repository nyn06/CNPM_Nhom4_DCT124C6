module.exports = process.env.NODE_ENV === 'test' && process.env.DB_INTEGRATION !== '1'
  ? require('./poi-translation-job.repository.memory') : require('./sql/poi-translation-job.repository');
