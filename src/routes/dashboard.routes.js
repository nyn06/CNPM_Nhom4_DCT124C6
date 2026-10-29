const express = require('express');
const controller = require('../controllers/dashboard.controller');
const { requireAdmin, requireRoles } = require('../middlewares/requireAdmin');

const router = express.Router();
router.get('/admin/dashboard', requireAdmin, requireRoles('ADMIN'), controller.get);
module.exports = router;
