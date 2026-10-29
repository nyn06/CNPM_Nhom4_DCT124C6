const app = require('./app');
const accountService = require('./services/account.service');
const { validateConfig } = require('./utils/authHttp');
const { getPool, closePool } = require('./database/connection');
const translationWorker = require('./services/poi-translation-worker');

async function start(env = process.env) {
  let stage = 'configuration';
  try {
    validateConfig(env);
    if (env === process.env && (env.NODE_ENV !== 'test' || env.DB_INTEGRATION === '1')) {
      stage = 'sql_connection';
      const pool = await getPool();
      stage = 'migrations';
      const required = ['001_initial.sql', '004_poi_translations.sql',
        '005_poi_translation_jobs.sql', '006_remove_legacy_narrations_jobs.sql'];
      const result = await pool.request().query(`SELECT Version FROM dbo.SchemaMigrations
        WHERE Version IN (${required.map((name) => `'${name}'`).join(', ')})`);
      const applied = new Set(result.recordset.map((row) => row.Version));
      const missing = required.filter((name) => !applied.has(name));
      if (missing.length) {
        const error = new Error('Required database migrations are missing.');
        error.code = 'MIGRATION_MISSING';
        error.missingMigrations = missing;
        throw error;
      }
    }
    // Importing app in tests does not bootstrap: test fixtures seed accounts.
    stage = 'admin_bootstrap';
    await accountService.bootstrap(env);
  } catch (error) {
    error.startupStage = stage;
    throw error;
  }
  // Child TTS processes must not inherit the bootstrap password.
  if (env === process.env) delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const port = env.PORT ?? 3000;
  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      const listener = app.listen(port, () => {
        listener.off('error', onError);
        resolve(listener);
      });
      listener.once('error', onError);
    });
  } catch (error) {
    error.startupStage = 'http_listen';
    throw error;
  }
  console.log(`Server đang chạy tại cổng ${port}`);
  if (env === process.env && (env.NODE_ENV !== 'test' || env.DB_INTEGRATION === '1')) translationWorker.start();
  const shutdown = () => { server.close(() => { translationWorker.stop()
    .then(() => closePool()).finally(() => { process.exitCode = 0; }); }); };
  if (require.main === module) {
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }
  return server;
}
if (require.main === module) {
  require('dotenv').config();
  start().catch(async (error) => {
    const stage = error.startupStage || 'unknown';
    const code = /^[A-Z][A-Z0-9_]{1,40}$/.test(error.code || '') ? error.code : 'UNKNOWN';
    const number = Number.isInteger(error.number) ? ` sql=${error.number}` : '';
    const missing = error.missingMigrations?.length
      ? ` missing=${error.missingMigrations.join(',')}` : '';
    console.error(`Backend startup failed: stage=${stage} code=${code}${number}${missing}`);
    await closePool().catch(() => {});
    process.exitCode = 1;
  });
}
module.exports = { start };
