const express = require('express');
const controller = require('../controllers/access.controller');
const { requireAdmin, requireRoles } = require('../middlewares/requireAdmin');
const csrf = require('../middlewares/csrf');
const { requireAccess } = require('../middlewares/requireAccess');

const router = express.Router();
router.use('/access', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.post('/access/vouchers', requireAdmin, requireRoles('ADMIN'), csrf(), controller.createVoucher);
router.get('/access/vouchers', requireAdmin, requireRoles('ADMIN'), controller.listVouchers);
router.post('/access/redeem', controller.redeem);
router.get('/access/session', requireAccess, controller.getSession);
module.exports = router;
