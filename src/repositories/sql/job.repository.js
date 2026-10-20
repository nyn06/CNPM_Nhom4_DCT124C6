const { getPool, request, iso, uuid } = require('../../database/repository');
const map = (r) => r && ({ id: uuid(r.Id), fileName: r.FileName, targetLang: r.TargetLang,
  status: r.Status, resultText: r.ResultText, resultAudioFile: r.ResultAudioFile, createdAt: iso(r.CreatedAt) });
class SqlJobRepository {
  async create(item) {
    await request(await getPool(), item).query(`INSERT dbo.Jobs (Id, FileName, TargetLang, Status, ResultText, ResultAudioFile, CreatedAt)
      VALUES (@id, @fileName, @targetLang, @status, @resultText, @resultAudioFile, @createdAt)`);
    return { ...item, id: uuid(item.id) };
  }
  async findById(id) {
    return map((await request(await getPool(), { id }).query('SELECT * FROM dbo.Jobs WHERE Id=TRY_CONVERT(uniqueidentifier, @id)')).recordset[0]);
  }
  async findAll() { return (await (await getPool()).request().query('SELECT * FROM dbo.Jobs')).recordset.map(map); }
  async update(id, patch) {
    const current = await this.findById(id);
    if (!current) return null;
    const item = { ...current, ...patch };
    await request(await getPool(), item).query(`UPDATE dbo.Jobs SET FileName=@fileName, TargetLang=@targetLang,
      Status=@status, ResultText=@resultText, ResultAudioFile=@resultAudioFile WHERE Id=TRY_CONVERT(uniqueidentifier, @id)`);
    return item;
  }
  async delete(id) {
    const result = await request(await getPool(), { id }).query('DELETE dbo.Jobs WHERE Id=TRY_CONVERT(uniqueidentifier, @id)');
    return result.rowsAffected[0] > 0;
  }
}
module.exports = new SqlJobRepository();
