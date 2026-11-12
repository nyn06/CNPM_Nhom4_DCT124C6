const express = require('express');
const poiController = require('../controllers/poi.controller');
const { requireAdmin, requireRoles } = require('../middlewares/requireAdmin');
const csrf = require('../middlewares/csrf');
const uploadPoiImage = require('../middlewares/uploadPoiImage');
const { narrationAccess } = require('../middlewares/requireAccess');

const router = express.Router();
const manage = [requireAdmin, requireRoles('ADMIN', 'POI_MANAGER'), csrf()];

router.get('/admin/pois', ...manage, poiController.getAdminPois);
router.get('/admin/pois/:id', ...manage, poiController.getAdminPoi);
router.post('/pois', ...manage, poiController.createPoi);


router.post(
  '/pois/:id/image',
  requireAdmin,
  requireRoles('ADMIN', 'POI_MANAGER'),
  csrf(false, true),
  uploadPoiImage,
  poiController.uploadPoiImage
);


router.get('/pois', poiController.getPois);
// Route cố định phải đứng trước /pois/:id.
router.get('/pois/nearby', poiController.getNearbyPois);
router.put('/pois/:id/narrations/vi', ...manage, poiController.setVietnameseNarration);
router.get('/pois/:id/narrations', narrationAccess, poiController.getPoiNarrations);
router.get('/pois/:id/narrations/:language', narrationAccess, poiController.getPoiNarration);
router.post('/pois/:id/narrations/:language/audio', ...manage, poiController.createPoiAudio);
router.post('/pois/:id/translations', ...manage, poiController.createTranslations);
router.get('/admin/pois/:id/details-translations', ...manage, poiController.getPoiTranslations);
router.post('/pois/:id/details-translations', ...manage, poiController.translatePoiDetails);
router.put('/pois/:id/details-translations/:language', ...manage, poiController.savePoiTranslation);
router.get('/pois/:id', poiController.getPoi);
router.put('/pois/:id', ...manage, poiController.updatePoi);
router.delete('/pois/:id', ...manage, poiController.deletePoi);

module.exports = router;
