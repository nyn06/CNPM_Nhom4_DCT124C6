const memory = require('../auth.repository.memory');
const { sql, getPool, request, uuid } = require('../../database/repository');
const config = require('../../config/auth');
const { error } = require('../../utils/auth');
class SqlAuthRepository {
  recordLoginAttempt(...args) { return memory.recordLoginAttempt(...args); }
  clearUserAttempts(...args) { return memory.clearUserAttempts(...args); }
  stats() { return memory.stats(); }
  async createSession(session) {
    const tx = new sql.Transaction(await getPool());
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const count = (await new sql.Request(tx).query(`SELECT COUNT(*) AS total FROM dbo.AdminSessions WITH (TABLOCKX, HOLDLOCK)
        WHERE RevokedAt IS NULL AND ExpiresAt>SYSUTCDATETIME()`)).recordset[0].total;
      if (count >= config.MAX_SESSIONS) throw error('Bộ nhớ xác thực đã đầy. Hãy thử lại sau.', 503);
      await request(tx, { ...session, expiresAt: new Date(session.expiresAt).toISOString(),
        createdAt: new Date().toISOString() }).query(`INSERT dbo.AdminSessions
        (TokenHash, AccountId, AccountVersion, CsrfToken, ExpiresAt, CreatedAt)
        VALUES (@tokenHash, TRY_CONVERT(uniqueidentifier, @userId), @accountVersion, @csrfToken,
        @expiresAt, @createdAt)`);
      await tx.commit();
    } catch (cause) { await tx.rollback(); throw cause; }
  }
  async findSession(hash) {
    const row = (await request(await getPool(), { hash }).query(`SELECT TokenHash, AccountId, AccountVersion,
      CsrfToken, ExpiresAt FROM dbo.AdminSessions WHERE TokenHash=@hash AND RevokedAt IS NULL
      AND ExpiresAt > SYSUTCDATETIME()`)).recordset[0];
    return row ? { tokenHash: row.TokenHash, userId: uuid(row.AccountId),
      accountVersion: row.AccountVersion, csrfToken: row.CsrfToken, expiresAt: +row.ExpiresAt } : null;
  }
  async deleteSession(hash) {
    await request(await getPool(), { hash }).query('UPDATE dbo.AdminSessions SET RevokedAt=SYSUTCDATETIME() WHERE TokenHash=@hash AND RevokedAt IS NULL');
  }
  async revokeUser(id) {
    await request(await getPool(), { id }).query('UPDATE dbo.AdminSessions SET RevokedAt=SYSUTCDATETIME() WHERE AccountId=TRY_CONVERT(uniqueidentifier, @id) AND RevokedAt IS NULL');
  }
  async createChallenge(challenge) {
    const tx = new sql.Transaction(await getPool());
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const count = (await new sql.Request(tx).query(`SELECT COUNT(*) AS total FROM dbo.LoginChallenges WITH (TABLOCKX, HOLDLOCK)
        WHERE ExpiresAt>SYSUTCDATETIME()`)).recordset[0].total;
      if (count >= config.MAX_CHALLENGES) throw error('Bộ nhớ xác thực đã đầy. Hãy thử lại sau.', 503);
      await request(tx, { ...challenge, expiresAt: new Date(challenge.expiresAt).toISOString() })
        .query(`INSERT dbo.LoginChallenges (TokenHash, CsrfToken, ExpiresAt)
        VALUES (@tokenHash, @csrfToken, @expiresAt)`);
      await tx.commit();
    } catch (cause) { await tx.rollback(); throw cause; }
  }
  async findChallenge(hash) {
    const row = (await request(await getPool(), { hash }).query(`SELECT TokenHash, CsrfToken, ExpiresAt
      FROM dbo.LoginChallenges WHERE TokenHash=@hash AND ExpiresAt>SYSUTCDATETIME()`)).recordset[0];
    return row ? { tokenHash: row.TokenHash, csrfToken: row.CsrfToken, expiresAt: +row.ExpiresAt } : null;
  }
  async deleteChallenge(hash) {
    await request(await getPool(), { hash }).query('DELETE dbo.LoginChallenges WHERE TokenHash=@hash');
  }
}
module.exports = new SqlAuthRepository();
