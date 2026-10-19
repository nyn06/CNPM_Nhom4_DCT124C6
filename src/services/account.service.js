const crypto = require('crypto');
const repository = require('../repositories/account.repository');
const authRepository = require('../repositories/auth.repository');
const { ROLES } = require('../config/auth');
const { error, username, passwordHash } = require('../utils/auth');

class AccountService {
  publicAccount(account) {
    return { id: account.id, username: account.username, role: account.role, isLocked: account.isLocked,
      createdAt: account.createdAt, updatedAt: account.updatedAt };
  }
  assertAdmin(actorId) {
    const actor = repository.findById(actorId);
    if (!actor || actor.isLocked || actor.role !== 'ADMIN') throw error('Không có quyền quản lý tài khoản.', 403);
  }
  _role(role) { if (!ROLES.includes(role)) throw error('Role chỉ nhận ADMIN hoặc POI_MANAGER.', 400); }
  _body(data, fields) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.keys(data).length
      || Object.keys(data).some((key) => !fields.includes(key))) throw error('Dữ liệu tài khoản không hợp lệ.', 400);
  }
  _account(name, hash, role) {
    const now = new Date(Date.now()).toISOString();
    return { id: crypto.randomUUID(), username: name, passwordHash: hash, role, isLocked: false,
      version: 1, createdAt: now, updatedAt: now };
  }
  async bootstrap(env = process.env) {
    if (repository.findAll().length) return;
    const name = username(env.ADMIN_BOOTSTRAP_USERNAME);
    const hash = await passwordHash(env.ADMIN_BOOTSTRAP_PASSWORD);
    // A concurrent bootstrap cannot create a second initial account.
    if (!repository.findAll().length) repository.create(this._account(name, hash, 'ADMIN'));
  }
  list(actorId) { this.assertAdmin(actorId); return repository.findAll().map((account) => this.publicAccount(account)); }
  async create(data, actorId) {
    this.assertAdmin(actorId);
    this._body(data, ['username', 'password', 'role']);
    const name = username(data.username);
    this._role(data.role);
    const hash = await passwordHash(data.password);
    this.assertAdmin(actorId);
    return this.publicAccount(repository.create(this._account(name, hash, data.role)));
  }
  update(id, data, actorId) {
    this.assertAdmin(actorId);
    this._body(data, ['role', 'isLocked']);
    if (Object.hasOwn(data, 'role')) this._role(data.role);
    if (Object.hasOwn(data, 'isLocked') && typeof data.isLocked !== 'boolean') throw error('isLocked phải là boolean.', 400);
    const updated = repository.update(id, { ...data, updatedAt: new Date(Date.now()).toISOString() });
    authRepository.revokeUser(id);
    return this.publicAccount(updated);
  }
  async resetPassword(id, data, actorId) {
    this.assertAdmin(actorId);
    this._body(data, ['password']);
    const current = repository.findById(id);
    if (!current) throw error('Không tìm thấy tài khoản.', 404);
    const hash = await passwordHash(data.password);
    this.assertAdmin(actorId);
    // Prevent a late reset from overwriting a concurrently changed account.
    if (repository.findById(id)?.version !== current.version) throw error('Tài khoản đã thay đổi. Hãy thử lại.', 409);
    const updated = repository.update(id, { passwordHash: hash, updatedAt: new Date(Date.now()).toISOString() });
    authRepository.revokeUser(id);
    return this.publicAccount(updated);
  }
}
module.exports = new AccountService();
