const express = require('express');
const poiController = require('../controllers/poi.controller');
const demoAdmin = require('../middlewares/demoAdmin');
const { narrationAccess } = require('../middlewares/requireAccess');

const router = express.Router();

router.post('/pois', demoAdmin, poiController.createPoi);
router.get('/pois', poiController.getPois);
// Route cố định phải đứng trước /pois/:id.
router.get('/pois/nearby', poiController.getNearbyPois);
router.put('/pois/:id/narrations/vi', demoAdmin, poiController.setVietnameseNarration);
router.get('/pois/:id/narrations', narrationAccess, poiController.getPoiNarrations);
router.get('/pois/:id/narrations/:language', narrationAccess, poiController.getPoiNarration);
router.post('/pois/:id/narrations/:language/audio', demoAdmin, poiController.createPoiAudio);
router.post('/pois/:id/translations', demoAdmin, poiController.createTranslations);
router.get('/pois/:id', poiController.getPoi);
router.put('/pois/:id', demoAdmin, poiController.updatePoi);
router.delete('/pois/:id', demoAdmin, poiController.deletePoi);

module.exports = router;
