const express = require('express');
const poiController = require('../controllers/poi.controller');
const { requireAdmin, requireRoles } = require('../middlewares/requireAdmin');
const csrf = require('../middlewares/csrf');
const { narrationAccess } = require('../middlewares/requireAccess');

const router = express.Router();
const manage = [requireAdmin, requireRoles('ADMIN', 'POI_MANAGER'), csrf()];

router.get('/admin/pois', ...manage, poiController.getAdminPois);
router.get('/admin/pois/:id', ...manage, poiController.getAdminPoi);
router.post('/pois', ...manage, poiController.createPoi);
router.get('/pois', poiController.getPois);
// Route cố định phải đứng trước /pois/:id.
router.get('/pois/nearby', poiController.getNearbyPois);
router.put('/pois/:id/narrations/vi', ...manage, poiController.setVietnameseNarration);
router.get('/pois/:id/narrations', narrationAccess, poiController.getPoiNarrations);
router.get('/pois/:id/narrations/:language', narrationAccess, poiController.getPoiNarration);
router.post('/pois/:id/narrations/:language/audio', ...manage, poiController.createPoiAudio);
router.post('/pois/:id/translations', ...manage, poiController.createTranslations);
router.get('/pois/:id', poiController.getPoi);
router.put('/pois/:id', ...manage, poiController.updatePoi);
router.delete('/pois/:id', ...manage, poiController.deletePoi);

module.exports = router;
