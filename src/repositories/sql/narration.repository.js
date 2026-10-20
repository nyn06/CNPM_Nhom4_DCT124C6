const { getPool, request, iso, uuid } = require('../../database/repository');
const map = (r) => r && ({ id: uuid(r.Id), text: r.Text, language: r.Language, status: r.Status,
  audioFile: r.AudioFile, createdAt: iso(r.CreatedAt) });
class SqlNarrationRepository {
  async create(item) {
    await request(await getPool(), item).query(`INSERT dbo.Narrations (Id, Text, Language, Status, AudioFile, CreatedAt)
      VALUES (@id, @text, @language, @status, @audioFile, @createdAt)`);
    return { ...item, id: uuid(item.id) };
  }
  async findById(id) {
    return map((await request(await getPool(), { id }).query('SELECT * FROM dbo.Narrations WHERE Id=TRY_CONVERT(uniqueidentifier, @id)')).recordset[0]);
  }
  async findAll() { return (await (await getPool()).request().query('SELECT * FROM dbo.Narrations')).recordset.map(map); }
  async update(id, patch) {
    const current = await this.findById(id);
    if (!current) return null;
    const item = { ...current, ...patch };
    await request(await getPool(), item).query(`UPDATE dbo.Narrations SET Text=@text, Language=@language,
      Status=@status, AudioFile=@audioFile WHERE Id=TRY_CONVERT(uniqueidentifier, @id)`);
    return item;
  }
}
module.exports = new SqlNarrationRepository();
