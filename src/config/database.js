function databaseConfig(env = process.env, database = env.DB_NAME) {
  const host = env.DB_HOST;
  const user = env.DB_USER;
  const password = env.DB_PASSWORD;
  const port = Number(env.DB_PORT);
  if (typeof host !== 'string' || !host.trim() || typeof user !== 'string' || !user.trim()
    || typeof password !== 'string' || !password || !Number.isInteger(port) || port < 1 || port > 65535
    || typeof database !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(database)
    || !['true', 'false'].includes(env.DB_ENCRYPT)
    || !['true', 'false'].includes(env.DB_TRUST_SERVER_CERTIFICATE)) {
    throw new Error('Invalid SQL Server configuration. Check DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD and TLS flags.');
  }
  return {
    server: host, port, database, user, password,
    options: { encrypt: env.DB_ENCRYPT === 'true', trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE === 'true' },
    pool: { min: 0, max: 10, idleTimeoutMillis: 30000 },
    connectionTimeout: 15000, requestTimeout: 30000,
  };
}
module.exports = { databaseConfig };
