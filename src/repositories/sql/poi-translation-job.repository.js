const { sql, getPool } = require('../../database/repository');

class Repository {
  async enqueue(id, reconcile = false) {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const req = () => new sql.Request(tx).input('id', sql.UniqueIdentifier, id);
      const found = (await req().query(`SELECT Revision, Status FROM dbo.POITranslationJobs WITH (UPDLOCK, HOLDLOCK)
        WHERE POIId=@id`)).recordset[0];
      if (found && (!reconcile || found.Status === 'done')) await req().query(`UPDATE dbo.POITranslationJobs SET
        Status='pending', Attempts=0, Revision=Revision+1, NextAttemptAt=SYSUTCDATETIME(),
        LeaseUntil=NULL, LastErrorCode=NULL, UpdatedAt=SYSUTCDATETIME() WHERE POIId=@id`);
      else if (!found) await req().query(`INSERT dbo.POITranslationJobs (POIId) VALUES (@id)`);
      await tx.commit();
    } catch (error) { await tx.rollback(); throw error; }
  }

  async claim() {
    const pool = await getPool();
    const rows = (await pool.request().query(`;WITH candidate AS (
      SELECT TOP (1) * FROM dbo.POITranslationJobs WITH (UPDLOCK, ROWLOCK)
      WHERE ((Status IN ('pending', 'failed') AND NextAttemptAt<=SYSUTCDATETIME())
        OR (Status='processing' AND LeaseUntil<=SYSUTCDATETIME()))
      ORDER BY NextAttemptAt, POIId
    ) UPDATE candidate SET Status='processing', Attempts=Attempts+1,
      LeaseUntil=DATEADD(second, 300, SYSUTCDATETIME()), UpdatedAt=SYSUTCDATETIME()
      OUTPUT inserted.POIId, inserted.Revision, inserted.Attempts`)).recordset;
    return rows[0] ? { poiId: String(rows[0].POIId).toLowerCase(), revision: rows[0].Revision,
      attempts: rows[0].Attempts } : null;
  }

  async complete(job) {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, job.poiId)
      .input('revision', sql.Int, job.revision).query(`UPDATE dbo.POITranslationJobs SET
        Status='done', LeaseUntil=NULL, LastErrorCode=NULL, UpdatedAt=SYSUTCDATETIME()
        WHERE POIId=@id AND Revision=@revision AND Status='processing'`);
  }

  async fail(job, code) {
    const pool = await getPool();
    await pool.request().input('id', sql.UniqueIdentifier, job.poiId)
      .input('revision', sql.Int, job.revision).input('code', sql.VarChar(32), code)
      .query(`UPDATE dbo.POITranslationJobs SET
        Status=CASE WHEN Attempts>=3 THEN 'failed' ELSE 'pending' END,
        NextAttemptAt=DATEADD(second, CASE WHEN Attempts=1 THEN 10 WHEN Attempts=2 THEN 60
          WHEN Attempts=3 THEN 600 WHEN Attempts=4 THEN 1800 ELSE 3600 END, SYSUTCDATETIME()),
        LeaseUntil=NULL, LastErrorCode=@code, UpdatedAt=SYSUTCDATETIME()
        WHERE POIId=@id AND Revision=@revision AND Status='processing'`);
  }
}
module.exports = new Repository();
