const { sql, getPool, request, iso, uuid } = require('../../database/repository');

function mapPoi(row) {
  return {
    id: uuid(row.Id), name: row.Name, description: row.Description, category: row.Category,
    address: row.Address, streetAddress: row.StreetAddress, ward: row.Ward, city: row.City,
    latitude: row.Latitude, longitude: row.Longitude,
    geofenceRadius: row.GeofenceRadius, isActive: row.IsActive,
    createdAt: iso(row.CreatedAt), updatedAt: iso(row.UpdatedAt), narrations: {},
  };
}
async function attachNarrations(pois) {
  if (!pois.length) return pois;
  const rows = (await (await getPool()).request().query('SELECT POIId, Language, Text, AudioFile FROM dbo.POINarrations')).recordset;
  const index = new Map(pois.map((poi) => [poi.id, poi]));
  for (const row of rows) {
    const poi = index.get(uuid(row.POIId));
    if (poi) poi.narrations[row.Language] = { text: row.Text, ...(row.AudioFile ? { audioFile: row.AudioFile } : {}) };
  }
  return pois;
}
class SqlPoiRepository {
  async create(poi) {
    await request(await getPool(), poi).query(`INSERT dbo.POIs
      (Id, Name, Description, Category, Address, StreetAddress, Ward, City, Latitude, Longitude, GeofenceRadius, IsActive, CreatedAt, UpdatedAt)
      VALUES (@id, @name, @description, @category, @address, @streetAddress, @ward, @city, @latitude, @longitude, @geofenceRadius,
      @isActive, @createdAt, @updatedAt)`);
    return { ...poi, id: uuid(poi.id) };
  }
  async findAll() {
    const rows = (await (await getPool()).request().query('SELECT * FROM dbo.POIs')).recordset;
    return attachNarrations(rows.map(mapPoi));
  }
  async findById(id) {
    const rows = (await request(await getPool(), { id }).query('SELECT * FROM dbo.POIs WHERE Id = TRY_CONVERT(uniqueidentifier, @id)')).recordset;
    return (await attachNarrations(rows.map(mapPoi)))[0] || null;
  }
  async update(id, patch) {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const current = (await request(tx, { id }).query('SELECT * FROM dbo.POIs WITH (UPDLOCK) WHERE Id = TRY_CONVERT(uniqueidentifier, @id)')).recordset[0];
      if (!current) { await tx.rollback(); return null; }
      const old = mapPoi(current);
      const poi = { ...old, ...patch };
      const fields = { id, name: poi.name, description: poi.description, category: poi.category,
        address: poi.address, streetAddress: poi.streetAddress, ward: poi.ward, city: poi.city,
        latitude: poi.latitude, longitude: poi.longitude,
        geofenceRadius: poi.geofenceRadius, isActive: poi.isActive, updatedAt: poi.updatedAt };
      await request(tx, fields).query(`UPDATE dbo.POIs SET Name=@name, Description=@description,
        Category=@category, Address=@address, StreetAddress=@streetAddress, Ward=@ward, City=@city,
        Latitude=@latitude, Longitude=@longitude,
        GeofenceRadius=@geofenceRadius, IsActive=@isActive, UpdatedAt=@updatedAt WHERE Id=TRY_CONVERT(uniqueidentifier, @id)`);
      if (Object.hasOwn(patch, 'narrations')) {
        await request(tx, { id }).query('DELETE dbo.POINarrations WHERE POIId=TRY_CONVERT(uniqueidentifier, @id)');
        for (const [language, narration] of Object.entries(patch.narrations)) {
          await request(tx, { id, language, text: narration.text, audioFile: narration.audioFile || null })
            .query(`INSERT dbo.POINarrations (POIId, Language, Text, AudioFile)
              VALUES (TRY_CONVERT(uniqueidentifier, @id), @language, @text, @audioFile)`);
        }
      }
      await tx.commit();
      return this.findById(id);
    } catch (error) { await tx.rollback(); throw error; }
  }
  async delete(id) {
    const result = await request(await getPool(), { id }).query('DELETE dbo.POIs WHERE Id=TRY_CONVERT(uniqueidentifier, @id)');
    return result.rowsAffected[0] > 0;
  }
}
module.exports = new SqlPoiRepository();
