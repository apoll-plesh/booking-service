// src/controllers/bookings.controller.js
// Создание брони с защитой от гонки и идемпотентностью.
const pool = require('../db');
const { validateBookingInput } = require('../bookings/validate');
const crypto = require('crypto');

// Считаем отпечаток запроса: одинаковый отпечаток = "тот же самый запрос".
// Нормализуем: цель обрезаем, время — в ISO.
function fingerprintOf({ resourceId, startTime, endTime, purpose }) {
  const raw = JSON.stringify({
    resourceId,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    purpose,
  });
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// POST /api/bookings
async function create(req, res) {
  // 0. Обязательный Idempotency-Key
  const idempotencyKey = (req.headers['idempotency-key'] || '').trim();
  if (!idempotencyKey) {
    return res.status(400).json({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'Заголовок Idempotency-Key обязателен',
      traceId: req.id,
    });
  }
  if (idempotencyKey.length > 100) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Idempotency-Key слишком длинный (максимум 100 символов)',
      traceId: req.id,
    });
  }

  // 1. Валидация тела
  const v = validateBookingInput(req.body);
  if (!v.ok) {
    return res.status(400).json({
      code: v.code,
      message: v.message,
      traceId: req.id,
    });
  }
  const { resourceId, startTime, endTime, purpose } = v.data;
  const ownerId = req.user.id;
  const fingerprint = fingerprintOf({ resourceId, startTime, endTime, purpose });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. Уже был такой ключ у этого пользователя?
    const existing = await client.query(
      `SELECT id, request_fingerprint, booking_id
       FROM idempotency_keys
       WHERE user_id = $1 AND key = $2`,
      [ownerId, idempotencyKey]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];

      // 2a. Тот же ключ, другие данные → 409
      if (row.request_fingerprint !== fingerprint) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: 'Idempotency-Key уже использован с другими данными',
          traceId: req.id,
        });
      }

      // 2b. Тот же ключ, те же данные → вернуть исходную бронь
      const b = await client.query(
        `SELECT id, resource_id, owner_id, start_time, end_time, purpose, status, created_at
         FROM bookings WHERE id = $1`,
        [row.booking_id]
      );
      await client.query('ROLLBACK'); // ничего не меняли
      const created = b.rows[0];
      return res.status(201).json({
        id: created.id,
        resourceId: created.resource_id,
        ownerId: created.owner_id,
        start: created.start_time.toISOString(),
        end: created.end_time.toISOString(),
        purpose: created.purpose,
        status: created.status,
        createdAt: created.created_at.toISOString(),
      });
    }

    // 3. Ключа нет — проверяем ресурс
    const r = await client.query(
      'SELECT id, is_active FROM resources WHERE id = $1 FOR SHARE',
      [resourceId]
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Ресурс не найден',
        traceId: req.id,
      });
    }
    if (!r.rows[0].is_active) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        code: 'RESOURCE_INACTIVE',
        message: 'Ресурс недоступен для бронирования',
        traceId: req.id,
      });
    }

    // 4. Вставка брони. EXCLUDE отвергнет пересечение.
    let created;
    try {
      const ins = await client.query(
        `INSERT INTO bookings (resource_id, owner_id, start_time, end_time, purpose, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING id, resource_id, owner_id, start_time, end_time, purpose, status, created_at`,
        [resourceId, ownerId, startTime, endTime, purpose]
      );
      created = ins.rows[0];
    } catch (err) {
      if (err.code === '23P01') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'BOOKING_CONFLICT',
          message: 'Ресурс уже занят в выбранное время',
          traceId: req.id,
        });
      }
      throw err;
    }

    // 5. Сохраняем ключ идемпотентности В ТОЙ ЖЕ транзакции
    try {
      await client.query(
        `INSERT INTO idempotency_keys (user_id, key, request_fingerprint, booking_id)
         VALUES ($1, $2, $3, $4)`,
        [ownerId, idempotencyKey, fingerprint, created.id]
      );
    } catch (err) {
      // 23505 = unique_violation (кто-то одновременно вставил тот же ключ)
      if (err.code === '23505') {
        await client.query('ROLLBACK');
        // Конкурент уже создал бронь с этим ключом. Возвращаем 409,
        // чтобы клиент повторил запрос и получил результат конкурента.
        return res.status(409).json({
          code: 'IDEMPOTENCY_CONCURRENT',
          message: 'Одновременный запрос с тем же ключом, повторите',
          traceId: req.id,
        });
      }
      throw err;
    }

    // 6. Аудит успешного создания
    await client.query(
      `INSERT INTO audit_events (actor_id, action, target_type, target_id, result, request_id)
       VALUES ($1, 'booking.created', 'booking', $2, 'success', $3)`,
      [ownerId, created.id, req.id]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      id: created.id,
      resourceId: created.resource_id,
      ownerId: created.owner_id,
      start: created.start_time.toISOString(),
      end: created.end_time.toISOString(),
      purpose: created.purpose,
      status: created.status,
      createdAt: created.created_at.toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[bookings.create]', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка сервера',
      traceId: req.id,
    });
  } finally {
    client.release();
  }
}

module.exports = { create };