const express = require('express');
const poiController = require('../controllers/poi.controller');

const router = express.Router();

router.post('/pois', poiController.createPoi);
router.get('/pois', poiController.getPois);
// Route cố định phải đứng trước /pois/:id.
router.get('/pois/nearby', poiController.getNearbyPois);
router.put('/pois/:id/narrations/vi', poiController.setVietnameseNarration);
router.get('/pois/:id/narrations', poiController.getPoiNarrations);
router.get('/pois/:id/narrations/:language', poiController.getPoiNarration);
router.post('/pois/:id/narrations/:language/audio', poiController.createPoiAudio);
router.post('/pois/:id/translations', poiController.createTranslations);
router.get('/pois/:id', poiController.getPoi);
router.put('/pois/:id', poiController.updatePoi);
router.delete('/pois/:id', poiController.deletePoi);

module.exports = router;
