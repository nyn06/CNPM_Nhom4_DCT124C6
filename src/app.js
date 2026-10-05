const path = require('path');
const express = require('express');
const cors = require('cors');
const jobRoutes = require('./routes/job.routes');
const narrationRoutes = require('./routes/narration.routes');
const poiRoutes = require('./routes/poi.routes');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.use(cors());
app.use(express.json());
app.use(
  '/audio',
  express.static(path.join(process.cwd(), 'public', 'audio'))
);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', jobRoutes);
app.use('/api', narrationRoutes);
app.use('/api', poiRoutes);

// Phục vụ WebApp cùng origin; không có SPA fallback bắt nhầm API.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Middleware xử lý lỗi phải đặt SAU cùng
app.use(errorHandler);

module.exports = app;
