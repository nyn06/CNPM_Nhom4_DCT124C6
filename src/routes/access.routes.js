const express = require('express');
const controller = require('../controllers/access.controller');
const { requireAdmin, requireRoles } = require('../middlewares/requireAdmin');
const csrf = require('../middlewares/csrf');
const { requireAccess } = require('../middlewares/requireAccess');
const limitVoucherRedeems = require('../middlewares/limitVoucherRedeems');

const router = express.Router();
router.use('/access', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.post('/access/vouchers', requireAdmin, requireRoles('ADMIN'), csrf(), controller.createVoucher);
router.get('/access/vouchers', requireAdmin, requireRoles('ADMIN'), controller.listVouchers);
router.get('/access/vouchers/overview', requireAdmin, requireRoles('ADMIN'), controller.voucherOverview);
router.get('/access/vouchers/activations', requireAdmin, requireRoles('ADMIN'), controller.activationHistory);
router.post('/access/redeem', limitVoucherRedeems, controller.redeem);
router.get('/access/session', requireAccess, controller.getSession);
module.exports = router;
