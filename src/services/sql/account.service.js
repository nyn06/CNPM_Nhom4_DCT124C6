const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const repository = require('../../repositories/account.repository');
const authRepository = require('../../repositories/auth.repository');
const { ROLES } = require('../../config/auth');
const { error, username, passwordHash } = require('../../utils/auth');

class AccountService {
  publicAccount(account) {
    return { id: account.id, username: account.username, role: account.role, isLocked: account.isLocked,
      createdAt: account.createdAt, updatedAt: account.updatedAt };
  }
  async assertAdmin(actorId) {
    const actor = await repository.findById(actorId);
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
    const existing = await repository.findAll();
    if (existing.length) {
      if (!existing.some((account) => account.role === 'ADMIN' && !account.isLocked)) {
        throw error('Database không có ADMIN hoạt động; cần khôi phục tài khoản có kiểm soát.', 503);
      }
      return;
    }
    const name = username(env.ADMIN_BOOTSTRAP_USERNAME);
    const hash = await passwordHash(env.ADMIN_BOOTSTRAP_PASSWORD);
    // A concurrent bootstrap cannot create a second initial account.
    await repository.createInitial(this._account(name, hash, 'ADMIN'));
  }
  async list(actorId) { await this.assertAdmin(actorId); return (await repository.findAll()).map((account) => this.publicAccount(account)); }
  async create(data, actorId) {
    await this.assertAdmin(actorId);
    this._body(data, ['username', 'password', 'role']);
    const name = username(data.username);
    this._role(data.role);
    const hash = await passwordHash(data.password);
    await this.assertAdmin(actorId);
    return this.publicAccount(await repository.create(this._account(name, hash, data.role)));
  }
  async update(id, data, actorId) {
    await this.assertAdmin(actorId);
    this._body(data, ['role', 'isLocked']);
    if (Object.hasOwn(data, 'role')) this._role(data.role);
    if (Object.hasOwn(data, 'isLocked') && typeof data.isLocked !== 'boolean') throw error('isLocked phải là boolean.', 400);
    if (id === actorId && (Object.hasOwn(data, 'role') || data.isLocked === true)) throw error('Cannot change the role or lock the signed-in account.', 403);
    const updated = await repository.update(id, { ...data, updatedAt: new Date(Date.now()).toISOString() });
    await authRepository.revokeUser(id);
    return this.publicAccount(updated);
  }
  async resetPassword(id, data, actorId) {
    await this.assertAdmin(actorId);
    if (id === actorId) throw error('Use the personal password change endpoint.', 403);
    this._body(data, ['password']);
    const current = await repository.findById(id);
    if (!current) throw error('Không tìm thấy tài khoản.', 404);
    const hash = await passwordHash(data.password);
    await this.assertAdmin(actorId);
    // Prevent a late reset from overwriting a concurrently changed account.
    const updated = await repository.update(id, { passwordHash: hash, updatedAt: new Date(Date.now()).toISOString() }, current.version);
    await authRepository.revokeUser(id);
    return this.publicAccount(updated);
  }

  async changeOwnPassword(data, actorId) {
    await this.assertAdmin(actorId);
    this._body(data, ['currentPassword', 'newPassword']);
    if (!Object.hasOwn(data, 'currentPassword') || !Object.hasOwn(data, 'newPassword')) throw error('Current and new passwords are required.', 400);
    const current = await repository.findById(actorId);
    if (typeof data.currentPassword !== 'string' || !await bcrypt.compare(data.currentPassword, current.passwordHash)) throw error('Current password is incorrect.', 400);
    if (data.currentPassword === data.newPassword) throw error('New password must differ from the current password.', 400);
    const hash = await passwordHash(data.newPassword);
    await this.assertAdmin(actorId);
    const updated = await repository.update(actorId, { passwordHash: hash, updatedAt: new Date(Date.now()).toISOString() }, current.version);
    await authRepository.revokeUser(actorId);
    return this.publicAccount(updated);
  }

}
module.exports = new AccountService();
