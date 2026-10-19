const app = require('./app');
const accountService = require('./services/account.service');
const { validateConfig } = require('./utils/authHttp');

async function start(env = process.env) {
  validateConfig(env);
  // Never listen with unbootstrapped admin protection. Importing app in tests
  // does not bootstrap: test fixtures seed accounts and log in explicitly.
  await accountService.bootstrap(env);
  // Child TTS processes must not inherit the bootstrap password.
  if (env === process.env) delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const port = env.PORT ?? 3000;
  return app.listen(port, () => console.log(`Server đang chạy tại cổng ${port}`));
}
if (require.main === module) {
  require('dotenv').config();
  start().catch(() => {
    console.error('Không khởi động: kiểm tra ADMIN_BOOTSTRAP_USERNAME, ADMIN_BOOTSTRAP_PASSWORD và ADMIN_ORIGIN.');
    process.exitCode = 1;
  });
}
module.exports = { start };
