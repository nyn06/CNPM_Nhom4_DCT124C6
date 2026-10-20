const { sql, getPool } = require('./connection');

function request(connection, params = {}) {
  const req = new sql.Request(connection);
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'string') req.input(name, sql.NVarChar(sql.MAX), value);
    else if (typeof value === 'boolean') req.input(name, sql.Bit, value);
    else if (typeof value === 'number') req.input(name, sql.Float, value);
    else if (value === null) req.input(name, null);
    else throw new TypeError(`Unsupported SQL parameter: ${name}`);
  }
  return req;
}
const iso = (date) => date == null ? null : new Date(date).toISOString();
const uuid = (value) => value == null ? null : String(value).toLowerCase();
module.exports = { sql, getPool, request, iso, uuid };
