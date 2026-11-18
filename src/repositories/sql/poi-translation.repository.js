const { sql, getPool, request, iso, uuid } = require('../../database/repository');

const map = (row) => ({
  poiId: uuid(row.POIId), language: row.Language,
  name: row.Name, description: row.Description, address: row.Address,
  nameSourceHash: row.NameSourceHash, descriptionSourceHash: row.DescriptionSourceHash,
  addressSourceHash: row.AddressSourceHash,
  nameManual: row.NameManual, descriptionManual: row.DescriptionManual,
  addressManual: row.AddressManual, updatedAt: iso(row.UpdatedAt),
});

class PoiTranslationRepository {
  async findByPoiIds(ids) {
    if (!ids.length) return [];
    const pool = await getPool();
    const result = [];
    for (let offset = 0; offset < ids.length; offset += 500) {
      const chunk = ids.slice(offset, offset + 500);
      const query = pool.request();
      const parameters = chunk.map((id, index) => {
        query.input(`id${index}`, sql.NVarChar(36), id);
        return `TRY_CONVERT(uniqueidentifier, @id${index})`;
      });
      const rows = (await query.query(`SELECT * FROM dbo.POITranslations WHERE POIId IN (${parameters.join(',')})`)).recordset;
      result.push(...rows.map(map));
    }
    return result;
  }

  async save(item) {
    const tx = new sql.Transaction(await getPool());
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const params = { ...item, updatedAt: new Date().toISOString() };
      const exists = (await request(tx, params).query(`SELECT 1 AS Found FROM dbo.POITranslations WITH (UPDLOCK, HOLDLOCK)
        WHERE POIId=TRY_CONVERT(uniqueidentifier, @poiId) AND Language=@language`)).recordset.length;
      if (exists) {
        await request(tx, params).query(`UPDATE dbo.POITranslations SET Name=@name, Description=@description,
          Address=@address, NameSourceHash=@nameSourceHash, DescriptionSourceHash=@descriptionSourceHash,
          AddressSourceHash=@addressSourceHash, NameManual=@nameManual,
          DescriptionManual=@descriptionManual, AddressManual=@addressManual, UpdatedAt=@updatedAt
          WHERE POIId=TRY_CONVERT(uniqueidentifier, @poiId) AND Language=@language`);
      } else {
        await request(tx, params).query(`INSERT dbo.POITranslations
          (POIId, Language, Name, Description, Address, NameSourceHash, DescriptionSourceHash,
           AddressSourceHash, NameManual, DescriptionManual, AddressManual, UpdatedAt)
          VALUES (TRY_CONVERT(uniqueidentifier, @poiId), @language, @name, @description, @address,
            @nameSourceHash, @descriptionSourceHash, @addressSourceHash,
            @nameManual, @descriptionManual, @addressManual, @updatedAt)`);
      }
      await tx.commit();
    } catch (error) { await tx.rollback(); throw error; }
    return item;
  }

  async saveDescription(item, previous) {
    const pool = await getPool();
    if (!previous) {
      const tx = new sql.Transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const request = () => new sql.Request(tx)
          .input('poiId', sql.UniqueIdentifier, item.poiId)
          .input('language', sql.VarChar(2), item.language);
        const existing = (await request().query(`SELECT 1 AS Found FROM dbo.POITranslations WITH (UPDLOCK, HOLDLOCK)
          WHERE POIId=@poiId AND Language=@language`)).recordset.length;
        if (existing) throw Object.assign(new Error('Description changed during translation.'),
          { statusCode: 409, code: 'TRANSLATION_CONFLICT' });
        await request().input('description', sql.NVarChar(sql.MAX), item.description)
          .input('sourceHash', sql.VarChar(64), item.descriptionSourceHash)
          .query(`INSERT dbo.POITranslations
            (POIId, Language, Description, DescriptionSourceHash)
            VALUES (@poiId, @language, @description, @sourceHash)`);
        await tx.commit();
      } catch (error) {
        await tx.rollback();
        throw error;
      }
      return item;
    }
    const result = await pool.request()
      .input('poiId', sql.UniqueIdentifier, item.poiId)
      .input('language', sql.VarChar(2), item.language)
      .input('description', sql.NVarChar(sql.MAX), item.description)
      .input('sourceHash', sql.VarChar(64), item.descriptionSourceHash)
      .input('previousDescription', sql.NVarChar(sql.MAX), previous.description)
      .input('previousHash', sql.VarChar(64), previous.descriptionSourceHash)
      .query(`UPDATE dbo.POITranslations SET Description=@description,
        DescriptionSourceHash=@sourceHash WHERE POIId=@poiId AND Language=@language
        AND ((Description IS NULL AND @previousDescription IS NULL)
          OR CONVERT(varbinary(max), Description)=CONVERT(varbinary(max), @previousDescription))
        AND DescriptionManual=0
        AND (DescriptionSourceHash=@previousHash
          OR (DescriptionSourceHash IS NULL AND @previousHash IS NULL))`);
    if (result.rowsAffected[0] !== 1)
      throw Object.assign(new Error('Description changed during translation.'),
        { statusCode: 409, code: 'TRANSLATION_CONFLICT' });
    return item;
  }
}

module.exports = new PoiTranslationRepository();
