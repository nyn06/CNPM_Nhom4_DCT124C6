const sql = require('mssql');
const { databaseConfig } = require('../config/database');

let pool;
let connecting;
async function getPool() {
  if (pool?.connected) return pool;
  if (!connecting) {
    connecting = new sql.ConnectionPool(databaseConfig()).connect()
      .then((connected) => { pool = connected; return connected; })
      .finally(() => { connecting = null; });
  }
  return connecting;
}
async function closePool() {
  const current = pool;
  pool = null;
  if (current) await current.close();
}
module.exports = { sql, getPool, closePool };
