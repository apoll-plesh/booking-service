// src/db.js
// Пул подключений к PostgreSQL. Один на всё приложение.
require('dotenv').config();
const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Лёгкая проверка при старте — чтобы сразу видеть проблему
pool.query('SELECT 1')
  .then(() => console.log('PostgreSQL: подключение работает'))
  .catch((err) => {
    logger.error('PostgreSQL: подключение НЕ работает');
    logger.error('   ', err.message);
  });

module.exports = pool;