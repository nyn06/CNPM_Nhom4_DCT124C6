const service = require('../services/account.service');

class AccountController {
  list(req, res, next) {
    try { res.json(service.list(req.admin.user.id)); } catch (error) { next(error); }
  }
  async create(req, res, next) {
    try { res.status(201).json(await service.create(req.body, req.admin.user.id)); } catch (error) { next(error); }
  }
  update(req, res, next) {
    try { res.json(service.update(req.params.id, req.body, req.admin.user.id)); } catch (error) { next(error); }
  }
  async resetPassword(req, res, next) {
    try { res.json(await service.resetPassword(req.params.id, req.body, req.admin.user.id)); } catch (error) { next(error); }
  }
}
module.exports = new AccountController();
