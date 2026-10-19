const express = require('express');
const narrationController = require('../controllers/narration.controller');

const router = express.Router();
const { requireAdmin, requireRoles } = require('../middlewares/requireAdmin');
router.use('/narrations', requireAdmin, requireRoles('ADMIN', 'POI_MANAGER'), require('../middlewares/csrf')());

router.post('/narrations', narrationController.createNarration);
router.get('/narrations', narrationController.getNarrations);
router.get('/narrations/:id', narrationController.getNarration);

module.exports = router;
