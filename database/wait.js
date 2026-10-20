require('dotenv').config();
const { sql } = require('../src/database/connection');
const { databaseConfig } = require('../src/config/database');

async function wait() {
  const config = { ...databaseConfig(), database: 'master' };
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const pool = await new sql.ConnectionPool(config).connect();
      await pool.request().query('SELECT 1');
      await pool.close();
      return;
    } catch { await new Promise((resolve) => setTimeout(resolve, 3000)); }
  }
  throw new Error('SQL Server did not become ready');
}
if (require.main === module) wait().catch(() => {
  console.error('SQL Server did not become ready.');
  process.exitCode = 1;
});
module.exports = { wait };
