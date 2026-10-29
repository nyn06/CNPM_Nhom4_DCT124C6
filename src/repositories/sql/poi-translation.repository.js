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
}

module.exports = new PoiTranslationRepository();
