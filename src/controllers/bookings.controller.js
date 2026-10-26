// src/controllers/bookings.controller.js
// Создание брони с защитой от гонки и идемпотентностью.
const pool = require('../db');
const { validateBookingInput } = require('../bookings/validate');
const crypto = require('crypto');
const logger = require('../logger');

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
      logger.error('booking.create failed', { traceId: req.id, error: err.message });     return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка сервера',
      traceId: req.id,
    });
  } finally {
    client.release();
  }
}

// POST /api/bookings/:id/cancel
// Отмена брони.
// - Владелец может отменить только свою будущую бронь, reason необязателен.
// - Админ может отменить любую будущую бронь, reason обязателен.
// - Начавшуюся/завершённую отменить нельзя.
// - Повторная отмена идемпотентна: возвращает текущее состояние без новых изменений.
async function cancel(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'id должен быть положительным целым числом',
        traceId: req.id,
      });
    }

    const { reason } = req.body || {};
    const isAdmin = req.user.role === 'admin';
    const reasonTrimmed = typeof reason === 'string' ? reason.trim() : '';

    if (isAdmin && reasonTrimmed.length === 0) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Администратор обязан указать причину отмены',
        traceId: req.id,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Загружаем бронь (FOR UPDATE — чтобы не было гонки отмен)
      const b = await client.query(
        `SELECT id, resource_id, owner_id, start_time, end_time, purpose, status, cancel_reason
         FROM bookings WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (b.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          code: 'NOT_FOUND',
          message: 'Бронь не найдена',
          traceId: req.id,
        });
      }
      const booking = b.rows[0];

      // 2. Проверка прав: владелец или админ.
      //    Обычному пользователю чужая бронь → 404 (не 403).
      if (!isAdmin && booking.owner_id !== req.user.id) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          code: 'NOT_FOUND',
          message: 'Бронь не найдена',
          traceId: req.id,
        });
      }

      // 3. Идемпотентность: уже отменена — вернуть текущее состояние без новых изменений
      if (booking.status === 'cancelled') {
        await client.query('ROLLBACK');
        return res.status(200).json({
          id: booking.id,
          resourceId: booking.resource_id,
          ownerId: booking.owner_id,
          start: booking.start_time.toISOString(),
          end: booking.end_time.toISOString(),
          purpose: booking.purpose,
          status: booking.status,
          cancelReason: booking.cancel_reason,
        });
      }

      // 4. Начавшуюся или завершённую отменить нельзя
      const now = new Date();
      if (new Date(booking.start_time) <= now) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          code: 'CANNOT_CANCEL_STARTED',
          message: 'Нельзя отменить начавшуюся или завершённую бронь',
          traceId: req.id,
        });
      }

      // 5. Отменяем
      const updated = await client.query(
        `UPDATE bookings
         SET status = 'cancelled',
             cancelled_at = NOW(),
             cancelled_by = $1,
             cancel_reason = $2
         WHERE id = $3
         RETURNING id, resource_id, owner_id, start_time, end_time, purpose, status,
                   cancelled_at, cancelled_by, cancel_reason`,
        [req.user.id, reasonTrimmed || null, id]
      );

      // 6. Аудит
      await client.query(
        `INSERT INTO audit_events (actor_id, action, target_type, target_id, result, request_id)
         VALUES ($1, 'booking.cancelled', 'booking', $2, 'success', $3)`,
        [req.user.id, id, req.id]
      );

      await client.query('COMMIT');

      const c = updated.rows[0];
      return res.json({
        id: c.id,
        resourceId: c.resource_id,
        ownerId: c.owner_id,
        start: c.start_time.toISOString(),
        end: c.end_time.toISOString(),
        purpose: c.purpose,
        status: c.status,
        cancelledAt: c.cancelled_at ? c.cancelled_at.toISOString() : null,
        cancelledBy: c.cancelled_by,
        cancelReason: c.cancel_reason,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[bookings.cancel]', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка сервера',
      traceId: req.id,
    });
  }
}

// GET /api/bookings/my
// Список собственных броней. Фильтр по статусу необязателен.
async function listMine(req, res) {
  try {
    const status = (req.query.status || '').trim();
    const params = [req.user.id];
    let sql = `
      SELECT id, resource_id, owner_id, start_time, end_time, purpose, status,
             cancelled_at, cancelled_by, cancel_reason
      FROM bookings
      WHERE owner_id = $1
    `;
    if (status && ['active', 'cancelled'].includes(status)) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }
    sql += ` ORDER BY start_time DESC`;

    const { rows } = await pool.query(sql, params);
    res.json({
      items: rows.map((b) => ({
        id: b.id,
        resourceId: b.resource_id,
        ownerId: b.owner_id,
        start: b.start_time.toISOString(),
        end: b.end_time.toISOString(),
        purpose: b.purpose,
        status: b.status,
        cancelledAt: b.cancelled_at ? b.cancelled_at.toISOString() : null,
        cancelledBy: b.cancelled_by,
        cancelReason: b.cancel_reason,
      })),
      total: rows.length,
    });
  } catch (err) {
    console.error('[bookings.listMine]', err);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка сервера',
      traceId: req.id,
    });
  }
}

// GET /api/admin/bookings
// Все брони с фильтрами. Только для админа.
async function listAll(req, res) {
  try {
    const { status, resourceId, date } = req.query;
    const conditions = [];
    const params = [];

    if (status && ['active', 'cancelled'].includes(status)) {
      params.push(status);
      conditions.push(`b.status = $${params.length}`);
    }
    if (resourceId) {
      const rid = Number(resourceId);
      if (!Number.isInteger(rid) || rid <= 0) {
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'resourceId должен быть положительным целым числом',
          traceId: req.id,
        });
      }
      params.push(rid);
      conditions.push(`b.resource_id = $${params.length}`);
    }
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'date должен быть в формате YYYY-MM-DD',
          traceId: req.id,
        });
      }
      params.push(date);
      conditions.push(`(b.start_time AT TIME ZONE 'Europe/Moscow')::date = $${params.length}::date`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT b.id, b.resource_id, r.name AS resource_name,
              b.owner_id, u.name AS owner_name, u.login AS owner_login,
              b.start_time, b.end_time, b.purpose, b.status,
              b.cancelled_at, b.cancelled_by, b.cancel_reason
       FROM bookings b
       JOIN resources r ON r.id = b.resource_id
       JOIN users u     ON u.id = b.owner_id
       ${where}
       ORDER BY b.start_time DESC`,
      params
    );

    res.json({
      items: rows.map((b) => ({
        id: b.id,
        resourceId: b.resource_id,
        resourceName: b.resource_name,
        ownerId: b.owner_id,
        ownerName: b.owner_name,
        ownerLogin: b.owner_login,
        start: b.start_time.toISOString(),
        end: b.end_time.toISOString(),
        purpose: b.purpose,
        status: b.status,
        cancelledAt: b.cancelled_at ? b.cancelled_at.toISOString() : null,
        cancelledBy: b.cancelled_by,
        cancelReason: b.cancel_reason,
      })),
      total: rows.length,
    });
  } catch (err) {
    console.error('[bookings.listAll]', err);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка сервера',
      traceId: req.id,
    });
  }
}

module.exports = { create, cancel, listMine, listAll };