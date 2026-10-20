const app = require('./app');
const accountService = require('./services/account.service');
const { validateConfig } = require('./utils/authHttp');
const { getPool, closePool } = require('./database/connection');

async function start(env = process.env) {
  validateConfig(env);
  if (env === process.env && (env.NODE_ENV !== 'test' || env.DB_INTEGRATION === '1')) {
    const pool = await getPool();
    await pool.request().query("SELECT TOP (1) Version FROM dbo.SchemaMigrations WHERE Version='001_initial.sql'")
      .then((result) => { if (!result.recordset.length) throw new Error('Database migration missing'); });
  }
  // Never listen with unbootstrapped admin protection. Importing app in tests
  // does not bootstrap: test fixtures seed accounts and log in explicitly.
  await accountService.bootstrap(env);
  // Child TTS processes must not inherit the bootstrap password.
  if (env === process.env) delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const port = env.PORT ?? 3000;
  const server = app.listen(port, () => console.log(`Server đang chạy tại cổng ${port}`));
  const shutdown = () => { server.close(() => { closePool().finally(() => { process.exitCode = 0; }); }); };
  if (require.main === module) {
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }
  return server;
}
if (require.main === module) {
  require('dotenv').config();
  start().catch(async () => {
    console.error('Không khởi động: kiểm tra cấu hình ADMIN, SQL Server và migrations.');
    await closePool().catch(() => {});
    process.exitCode = 1;
  });
}
module.exports = { start };
