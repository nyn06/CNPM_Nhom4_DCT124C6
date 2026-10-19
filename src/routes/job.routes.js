const express = require('express');
const jobController = require('../controllers/job.controller');

const router = express.Router();
const { requireAdmin, requireRoles } = require('../middlewares/requireAdmin');
router.use('/jobs', requireAdmin, requireRoles('ADMIN', 'POI_MANAGER'), require('../middlewares/csrf')());

// POST /api/jobs           -> tạo job thuyết minh mới
router.post('/jobs', jobController.createJob);

// GET  /api/jobs           -> danh sách job
router.get('/jobs', jobController.listJobs);

// GET  /api/jobs/:id       -> tra cứu 1 job theo id
router.get('/jobs/:id', jobController.getJob);

// GET  /api/languages      -> danh sách ngôn ngữ hỗ trợ
router.get('/languages', jobController.getLanguages);

module.exports = router;
