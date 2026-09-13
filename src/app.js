const express = require('express');
const cors = require('cors');
const jobRoutes = require('./routes/job.routes');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', jobRoutes);

// Middleware xử lý lỗi phải đặt SAU cùng
app.use(errorHandler);

module.exports = app;
