const { sql, getPool, request, iso, uuid } = require('../../database/repository');
const { error } = require('../../utils/auth');
const { MAX_ACCOUNTS } = require('../../config/auth');
const map = (r) => r && ({ id: uuid(r.Id), username: r.Username, passwordHash: r.PasswordHash,
  role: r.Role, isLocked: r.IsLocked, version: r.Version,
  createdAt: iso(r.CreatedAt), updatedAt: iso(r.UpdatedAt) });
class SqlAccountRepository {
  async findAll() { return (await (await getPool()).request().query('SELECT * FROM dbo.Accounts')).recordset.map(map); }
  async findById(id) {
    return map((await request(await getPool(), { id }).query('SELECT * FROM dbo.Accounts WHERE Id=TRY_CONVERT(uniqueidentifier, @id)')).recordset[0]);
  }
  async findByUsername(username) {
    return map((await request(await getPool(), { username }).query('SELECT * FROM dbo.Accounts WHERE Username=@username')).recordset[0]);
  }
  async create(account) {
    const tx = new sql.Transaction(await getPool());
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const count = (await new sql.Request(tx).query('SELECT COUNT(*) AS total FROM dbo.Accounts WITH (TABLOCKX, HOLDLOCK)')).recordset[0].total;
      if (count >= MAX_ACCOUNTS) throw error('Đã đạt giới hạn tài khoản.', 503);
      await request(tx, account).query(`INSERT dbo.Accounts
        (Id, Username, PasswordHash, Role, IsLocked, Version, CreatedAt, UpdatedAt)
        VALUES (@id, @username, @passwordHash, @role, @isLocked, @version, @createdAt, @updatedAt)`);
      await tx.commit();
    } catch (cause) {
      await tx.rollback();
      if ([2601, 2627].includes(cause.number)) throw error('Username đã được sử dụng.', 409);
      throw cause;
    }
    return { ...account, id: uuid(account.id) };
  }
  async createInitial(account) {
    const tx = new sql.Transaction(await getPool());
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const count = (await new sql.Request(tx).query('SELECT COUNT(*) AS total FROM dbo.Accounts WITH (TABLOCKX, HOLDLOCK)')).recordset[0].total;
      if (!count) await request(tx, account).query(`INSERT dbo.Accounts
        (Id, Username, PasswordHash, Role, IsLocked, Version, CreatedAt, UpdatedAt)
        VALUES (@id, @username, @passwordHash, @role, @isLocked, @version, @createdAt, @updatedAt)`);
      await tx.commit();
      return !count;
    } catch (cause) { await tx.rollback(); throw cause; }
  }
  async update(id, patch, expectedVersion) {
    const tx = new sql.Transaction(await getPool());
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const lock = (await new sql.Request(tx).query(`DECLARE @result int;
        EXEC @result = sp_getapplock @Resource='AccountsLastAdmin', @LockMode='Exclusive',
          @LockOwner='Transaction', @LockTimeout=10000;
        SELECT @result AS result`)).recordset[0].result;
      if (lock < 0) throw error('Không thể cập nhật tài khoản lúc này. Hãy thử lại.', 503);
      const current = map((await request(tx, { id }).query(
        'SELECT * FROM dbo.Accounts WITH (UPDLOCK, HOLDLOCK) WHERE Id=TRY_CONVERT(uniqueidentifier, @id)')).recordset[0]);
      if (!current) throw error('Không tìm thấy tài khoản.', 404);
      if (expectedVersion != null && current.version !== expectedVersion) throw error('Tài khoản đã thay đổi. Hãy thử lại.', 409);
      const updated = { ...current, ...patch, version: current.version + 1 };
      if (current.role === 'ADMIN' && !current.isLocked && (updated.role !== 'ADMIN' || updated.isLocked)) {
        const count = (await new sql.Request(tx).query(
          "SELECT COUNT(*) AS total FROM dbo.Accounts WITH (TABLOCKX, HOLDLOCK) WHERE Role='ADMIN' AND IsLocked=0")).recordset[0].total;
        if (count <= 1) throw error('Không thể vô hiệu hóa hoặc bỏ quyền ADMIN hoạt động cuối cùng.', 409);
      }
      await request(tx, { ...updated, id }).query(`UPDATE dbo.Accounts SET Role=@role, IsLocked=@isLocked,
        PasswordHash=@passwordHash, Version=@version, UpdatedAt=@updatedAt
        WHERE Id=TRY_CONVERT(uniqueidentifier, @id)`);
      await request(tx, { id }).query('UPDATE dbo.AdminSessions SET RevokedAt=SYSUTCDATETIME() WHERE AccountId=TRY_CONVERT(uniqueidentifier, @id) AND RevokedAt IS NULL');
      await tx.commit();
      return updated;
    } catch (cause) { await tx.rollback(); throw cause; }
  }
}
module.exports = new SqlAccountRepository();
