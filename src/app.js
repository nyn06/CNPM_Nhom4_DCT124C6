const path = require('path');
const express = require('express');
const cors = require('cors');
const jobRoutes = require('./routes/job.routes');
const narrationRoutes = require('./routes/narration.routes');
const poiRoutes = require('./routes/poi.routes');
const errorHandler = require('./middlewares/errorHandler');
const accessRoutes = require('./routes/access.routes');
const demoAdmin = require('./middlewares/demoAdmin');
const { requireAccess } = require('./middlewares/requireAccess');
const serveAudio = require('./controllers/audio.controller');

const app = express();

app.use(cors());
app.use(express.json());
app.use((req, res, next) => { res.set('Referrer-Policy', 'no-referrer'); next(); });
app.use('/audio', requireAccess, serveAudio);
app.use('/api/admin/audio', demoAdmin, serveAudio);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', jobRoutes);
app.use('/api', narrationRoutes);
app.use('/api', poiRoutes);
app.use('/api', accessRoutes);

// Phục vụ WebApp cùng origin; không có SPA fallback bắt nhầm API.
// Only expose known UI assets. Serving all of public would let encoded aliases
// such as /%61udio/file.wav bypass the protected /audio route.
const publicDir = path.join(__dirname, '..', 'public');
app.use('/css', express.static(path.join(publicDir, 'css')));
app.use('/js', express.static(path.join(publicDir, 'js')));
app.get(['/', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.get('/admin.html', demoAdmin, (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));

// Middleware xử lý lỗi phải đặt SAU cùng
app.use(errorHandler);

module.exports = app;
