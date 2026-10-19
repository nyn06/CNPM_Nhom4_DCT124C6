const { MAX_ACCOUNTS } = require('../config/auth');
const { error } = require('../utils/auth');
const accounts = new Map();

class AccountRepository {
  findAll() { return Array.from(accounts.values(), (account) => ({ ...account })); }
  findById(id) { const account = accounts.get(id); return account ? { ...account } : null; }
  findByUsername(username) { return this.findAll().find((account) => account.username === username) || null; }

  create(account) {
    if (this.findByUsername(account.username)) throw error('Username đã được sử dụng.', 409);
    if (accounts.size >= MAX_ACCOUNTS) throw error('Đã đạt giới hạn tài khoản của bản in-memory.', 503);
    accounts.set(account.id, { ...account });
    return { ...account };
  }

  // Check and update without await: concurrent demotions/locks cannot remove
  // the last active ADMIN. Replace with a DB transaction in Stage 10.
  update(id, patch) {
    const current = accounts.get(id);
    if (!current) throw error('Không tìm thấy tài khoản.', 404);
    const updated = { ...current, ...patch, version: current.version + 1 };
    if (current.role === 'ADMIN' && !current.isLocked && (updated.role !== 'ADMIN' || updated.isLocked)
      && this.findAll().filter((account) => account.role === 'ADMIN' && !account.isLocked).length <= 1) {
      throw error('Không thể vô hiệu hóa hoặc bỏ quyền ADMIN hoạt động cuối cùng.', 409);
    }
    accounts.set(id, updated);
    return { ...updated };
  }
  clear() { accounts.clear(); }
}
module.exports = new AccountRepository();
