const express = require('express');
const narrationController = require('../controllers/narration.controller');

const router = express.Router();

router.post('/narrations', narrationController.createNarration);
router.get('/narrations', narrationController.getNarrations);
router.get('/narrations/:id', narrationController.getNarration);

module.exports = router;