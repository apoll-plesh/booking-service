// server.js
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const pool = require('./src/db');
const logger = require('./src/logger');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ===== traceId для каждого запроса =====
// Нужен, чтобы по коду из ответа можно было найти запись в логах и аудите.
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Trace-Id', req.id);
  next();
});

// Логирование каждого запроса
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('http', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
      traceId: req.id,
    });
  });
  next();
});

app.get('/health/live', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not ready', reason: 'database unavailable' });
  }
});

// ===== API-маршруты =====
app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api/resources', require('./src/routes/resources.routes'));
app.use('/api/bookings', require('./src/routes/bookings.routes'));
app.use('/api/admin', require('./src/routes/admin.routes'));

// ===== 404 для неизвестных путей =====
app.use((req, res) => {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: 'Маршрут не найден',
    traceId: req.id,
  });
});

// ===== Общий обработчик ошибок =====
// Сюда попадают ошибки, которые кто-то бросил через next(err) или async-обработчик.
// ВАЖНО: не отдаём клиенту err.message и стектрейс.
app.use((err, req, res, next) => {
  logger.error('unhandled', {
    method: req.method,
    path: req.url,
    traceId: req.id,
    error: err.message,
  });
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера', traceId: req.id });
});

// ===== Запуск =====
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});