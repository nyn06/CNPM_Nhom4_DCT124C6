const express = require('express');
const narrationController = require('../controllers/narration.controller');

const router = express.Router();
// Legacy content/TTS endpoints are management APIs, not a tourist bypass.
router.use('/narrations', require('../middlewares/demoAdmin'));

router.post('/narrations', narrationController.createNarration);
router.get('/narrations', narrationController.getNarrations);
router.get('/narrations/:id', narrationController.getNarration);

module.exports = router;
