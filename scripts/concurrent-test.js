// scripts/concurrent-test.js
// Делает ДВА одновременных запроса на создание брони.
// Ожидаемо: один 201, один 409, в БД одна запись.

require('dotenv').config();
const crypto = require('crypto');

const BASE = 'http://localhost:3000';

async function signin(login, password) {
  const r = await fetch(`${BASE}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  if (!r.ok) throw new Error(`signin ${login}: ${r.status}`);
  return (await r.json()).token;
}

async function createBooking(token, key, body) {
  const r = await fetch(`${BASE}/api/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: r.status, data };
}

async function main() {
  const token = await signin('user1', 'password123');

  const date = process.argv[2] || '2026-10-30';
  const body = {
    resourceId: 2, // «Бета», чтобы не мешать предыдущим тестам
    startTime: `${date}T16:00:00+03:00`,
    endTime:   `${date}T17:00:00+03:00`,
    purpose:   'Конкурентный тест: два одновременных запроса',
  };

  console.log(`Запускаем два одновременных запроса на ${date} 16:00–17:00, ресурс 2…`);

  const key1 = crypto.randomUUID();
  const key2 = crypto.randomUUID();

  const [r1, r2] = await Promise.all([
    createBooking(token, key1, body),
    createBooking(token, key2, body),
  ]);

  console.log('Ответ 1:', r1.status, r1.data);
  console.log('Ответ 2:', r2.status, r2.data);

  const statuses = [r1.status, r2.status].sort();
  const ok = statuses[0] === 201 && statuses[1] === 409;
  console.log(ok
    ? '✅ УСПЕХ: один 201, один 409. Защита от гонки работает.'
    : '❌ НЕОЖИДАННО: проверьте, не была ли уже занята дата/время.');
}

main().catch((e) => { console.error('Ошибка:', e); process.exit(1); });