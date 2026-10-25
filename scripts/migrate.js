// scripts/migrate.js
// Простой механизм миграций: применяет SQL-файлы из migrations/ по порядку,
// записывает применённые в таблицу _migrations и пропускает уже сделанные.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function main() {
  const client = new Client({
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  await client.connect();
  console.log('Подключение к PostgreSQL установлено');

  // 1. Создаём журнал, если его нет
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(255) NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
  `);

  // 2. Что уже применено
  const { rows: applied } = await client.query('SELECT name FROM _migrations');
  const appliedSet = new Set(applied.map((r) => r.name));

  // 3. Все файлы из migrations/, кроме служебных
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('ℹ️  Файлов миграций нет');
    await client.end();
    return;
  }

  // 4. Применяем по порядку
  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`Пропускаем (уже применено): ${file}`);
      continue;
    }

    console.log(`Применяем: ${file}`);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    try {
      // Оборачиваем в транзакцию: если упадёт — откатится целиком
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`${file} применён`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`   Ошибка в ${file}:`, err.message);
      await client.end();
      process.exit(1);
    }
  }

  console.log('Все миграции применены');
  await client.end();
}

main().catch((err) => {
  console.error('Фатальная ошибка:', err.message);
  process.exit(1);
});