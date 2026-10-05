const express = require('express');
const poiController = require('../controllers/poi.controller');

const router = express.Router();

router.post('/pois', poiController.createPoi);
router.get('/pois', poiController.getPois);
// Route cố định phải đứng trước /pois/:id.
router.get('/pois/nearby', poiController.getNearbyPois);
router.get('/pois/:id', poiController.getPoi);
router.put('/pois/:id', poiController.updatePoi);
router.delete('/pois/:id', poiController.deletePoi);

module.exports = router;
