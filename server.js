// ===== 1. Загружаем переменные окружения из .env =====
require('dotenv').config();

// ===== 2. Подключаем нужные модули =====
const express = require('express');
const { Pool } = require('pg');

// ===== 3. Создаём приложение Express =====
const app = express();

// Чтобы сервер понимал JSON в теле запросов
app.use(express.json());

// ===== 4. Пул подключений к PostgreSQL =====
const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Проверка: при старте делаем один лёгкий запрос к БД
pool.query('SELECT 1')
  .then(() => console.log('PostgreSQL: подключение работает'))
  .catch((err) => {
    console.error('PostgreSQL: подключение НЕ работает');
    console.error('   ', err.message);
  });

// ===== 5. Простые маршруты =====

// GET / — приветствие
app.get('/', (req, res) => {
  res.json({ message: 'Booking Service API работает' });
});

// GET /health/live — "процесс жив" (используется в CI/CD)
app.get('/health/live', (req, res) => {
  res.json({ status: 'ok' });
});

// GET /health/ready — "сервис готов обслуживать" (проверяет БД)
app.get('/health/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch (err) {
    // 503 = "Service Unavailable"
    res.status(503).json({ status: 'not ready', reason: 'database unavailable' });
  }
});

// ===== 6. Запуск сервера =====
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});