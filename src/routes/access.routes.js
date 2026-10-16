const express = require('express');
const controller = require('../controllers/access.controller');
const demoAdmin = require('../middlewares/demoAdmin');
const { requireAccess } = require('../middlewares/requireAccess');

const router = express.Router();
router.use('/access', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.post('/access/vouchers', demoAdmin, controller.createVoucher);
router.get('/access/vouchers', demoAdmin, controller.listVouchers);
router.post('/access/redeem', controller.redeem);
router.get('/access/session', requireAccess, controller.getSession);
module.exports = router;
