const path = require('path');
const express = require('express');
const cors = require('cors');
const jobRoutes = require('./routes/job.routes');
const narrationRoutes = require('./routes/narration.routes');
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

// Middleware xử lý lỗi phải đặt SAU cùng
app.use(errorHandler);

module.exports = app;
