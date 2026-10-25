// src/controllers/bookings.controller.js
// Создание брони с защитой от гонки.
// Стратегия:
// 1. Валидируем вход (400 при ошибке).
// 2. Открываем транзакцию.
// 3. Проверяем существование и активность ресурса.
// 4. Вставляем бронь. Если EXCLUDE-ограничение в БД отвергнет пересечение,
//    получаем ошибку 23P01 → превращаем в 409.
// 5. Проверку «свободно ли время» отдельно НЕ ДЕЛАЕМ —
//    это и есть защита от гонки: проверку делает сама БД атомарно.
const pool = require('../db');
const { validateBookingInput } = require('../bookings/validate');

// POST /api/bookings
async function create(req, res) {
  // 1. Валидация
  const v = validateBookingInput(req.body);
  if (!v.ok) {
    return res.status(400).json({
      code: v.code,
      message: v.message,
      traceId: req.id,
    });
  }
  const { resourceId, startTime, endTime, purpose } = v.data;
  const ownerId = req.user.id; // доверяем только токену

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. Проверка ресурса: существует и активен.
    //    FOR SHARE — блокируем строку ресурса от конкурентного отключения
    //    на время создания брони. Порядок блокировок тот же, что в PATCH ресурса.
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

    // 3. Вставка. Здесь в игру вступает EXCLUDE-ограничение bookings_no_overlap.
    //    Оно атомарно отвергнет пересечение с активной бронью того же ресурса.
    const insertSql = `
      INSERT INTO bookings (resource_id, owner_id, start_time, end_time, purpose, status)
      VALUES ($1, $2, $3, $4, $5, 'active')
      RETURNING id, resource_id, owner_id, start_time, end_time, purpose, status, created_at
    `;
    let created;
    try {
      const ins = await client.query(insertSql, [resourceId, ownerId, startTime, endTime, purpose]);
      created = ins.rows[0];
    } catch (err) {
      // 23P01 = exclusion_violation (нарушено EXCLUDE-ограничение)
      if (err.code === '23P01') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'BOOKING_CONFLICT',
          message: 'Ресурс уже занят в выбранное время',
          traceId: req.id,
        });
      }
      throw err; // другие ошибки — наверх, в общий обработчик
    }

    // 4. Аудит: успешное создание
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
    client.release(); // обязательно вернуть соединение в пул
  }
}

module.exports = { create };