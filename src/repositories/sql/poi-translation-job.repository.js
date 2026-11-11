const { sql, getPool } = require('../../database/repository');

class Repository {
  async findByPoiIds(ids) {
    if (!ids.length) return [];
    const pool = await getPool();
    const request = pool.request();
    const parameters = ids.map((id, index) => {
      request.input(`id${index}`, sql.UniqueIdentifier, id);
      return `@id${index}`;
    });
    const rows = (await request.query(`SELECT POIId, Status, LastErrorCode FROM dbo.POITranslationJobs
      WHERE POIId IN (${parameters.join(',')})`)).recordset;
    return rows.map((row) => ({ poiId: String(row.POIId).toLowerCase(), status: row.Status,
      lastErrorCode: row.LastErrorCode }));
  }

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
      WHERE ((Status='pending' AND NextAttemptAt<=SYSUTCDATETIME())
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
        Status=CASE WHEN Attempts>=3 OR @code IN ('UNTRUSTED_TRANSLATION',
          'UNVERIFIED_TRANSLATION', 'PROVIDER_AUTH') THEN 'failed' ELSE 'pending' END,
        NextAttemptAt=DATEADD(second, CASE WHEN @code='PROVIDER_RATE_LIMIT'
          THEN CASE WHEN Attempts=1 THEN 60 ELSE 600 END
          WHEN Attempts=1 THEN 10 ELSE 60 END, SYSUTCDATETIME()),
        LeaseUntil=NULL, LastErrorCode=@code, UpdatedAt=SYSUTCDATETIME()
        WHERE POIId=@id AND Revision=@revision AND Status='processing'`);
  }
}
module.exports = new Repository();
