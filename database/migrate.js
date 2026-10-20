const fs = require('fs/promises');
const path = require('path');
require('dotenv').config();
const { sql } = require('../src/database/connection');
const { databaseConfig } = require('../src/config/database');

async function migrate() {
  const config = databaseConfig();
  const master = await new sql.ConnectionPool({ ...config, database: 'master' }).connect();
  try {
    const exists = await master.request().input('name', sql.NVarChar(128), config.database)
      .query('SELECT DB_ID(@name) AS id');
    if (exists.recordset[0].id === null) {
      // Identifier already passed the strict allowlist in databaseConfig.
      await master.request().query(`CREATE DATABASE [${config.database}]`);
    }
  } finally { await master.close(); }
  const pool = await new sql.ConnectionPool(config).connect();
  try {
    await pool.request().query(`IF OBJECT_ID(N'dbo.SchemaMigrations', N'U') IS NULL
      CREATE TABLE dbo.SchemaMigrations (Version varchar(100) NOT NULL PRIMARY KEY,
      AppliedAt datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME())`);
    const dir = path.join(__dirname, 'migrations');
    const files = (await fs.readdir(dir)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort();
    for (const name of files) {
      const tx = new sql.Transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const found = await new sql.Request(tx).input('version', sql.VarChar(100), name)
          .query('SELECT Version FROM dbo.SchemaMigrations WITH (UPDLOCK, HOLDLOCK) WHERE Version = @version');
        if (!found.recordset.length) {
          await new sql.Request(tx).batch(await fs.readFile(path.join(dir, name), 'utf8'));
          await new sql.Request(tx).input('version', sql.VarChar(100), name)
            .query('INSERT dbo.SchemaMigrations (Version) VALUES (@version)');
          process.stdout.write(`Applied ${name}\n`);
        }
        await tx.commit();
      } catch (error) { await tx.rollback(); throw error; }
    }
  } finally { await pool.close(); }
}
if (require.main === module) migrate().catch(() => {
  console.error('Migration failed. Check SQL Server readiness, configuration, and schema state.');
  process.exitCode = 1;
});
module.exports = { migrate };
