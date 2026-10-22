const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const jobRoutes = require('./routes/job.routes');
const narrationRoutes = require('./routes/narration.routes');
const poiRoutes = require('./routes/poi.routes');
const errorHandler = require('./middlewares/errorHandler');
const accessRoutes = require('./routes/access.routes');
const { requireAdmin, requireRoles, adminPage } = require('./middlewares/requireAdmin');
const authRoutes = require('./routes/auth.routes');
const accountRoutes = require('./routes/account.routes');
const geocodeRoutes = require('./routes/geocode.routes');
const { requireAccess } = require('./middlewares/requireAccess');
const serveAudio = require('./controllers/audio.controller');
const sqlRuntime = process.env.NODE_ENV !== 'test' || process.env.DB_INTEGRATION === '1';

const app = express();

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  next();
});
app.use('/audio', requireAccess, serveAudio);
app.use('/api/admin/audio', requireAdmin, requireRoles('ADMIN', 'POI_MANAGER'), serveAudio);

app.get('/health', async (req, res) => {
  if (!sqlRuntime) return res.json({ status: 'ok' });
  try {
    const { getPool } = require('./database/connection');
    await (await getPool()).request().query('SELECT 1');
    return res.json({ status: 'ok' });
  } catch { return res.status(503).json({ status: 'unavailable' }); }
});

app.use('/api', jobRoutes);
app.use('/api', narrationRoutes);
app.use('/api', poiRoutes);
app.use('/api', accessRoutes);
app.use('/api', authRoutes);
app.use('/api', accountRoutes);
app.use('/api', geocodeRoutes);

// Phục vụ WebApp cùng origin; không có SPA fallback bắt nhầm API.
// Only expose known UI assets. Serving all of public would let encoded aliases
// such as /%61udio/file.wav bypass the protected /audio route.
const publicDir = path.join(__dirname, '..', 'public');
const touristHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
app.use('/css', express.static(path.join(publicDir, 'css')));
app.use('/js', express.static(path.join(publicDir, 'js')));
app.use('/leaflet', express.static(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist')));
app.get(['/', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-store');
  // OSM tiles need an origin Referer; voucher codes in the query must stay private.
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.type('html').send(touristHtml.replace(/ data-development-only/g, ' hidden'));
  } else res.sendFile(path.join(publicDir, 'index.html'));
});
app.get('/admin-login.html', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'admin-login.html'));
});
app.get('/admin.html', adminPage, requireRoles('ADMIN', 'POI_MANAGER'), (req, res) => {
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.sendFile(path.join(publicDir, 'admin.html'));
});

// Middleware xử lý lỗi phải đặt SAU cùng
app.use(errorHandler);

module.exports = app;
