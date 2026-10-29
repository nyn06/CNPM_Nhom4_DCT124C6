const express = require('express');

const router = express.Router();
const languages = Object.freeze(['vi', 'en', 'ja', 'ko', 'fr', 'zh']);

router.get('/languages', (req, res) => res.json({ languages }));

module.exports = router;
