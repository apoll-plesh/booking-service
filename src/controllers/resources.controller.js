// src/controllers/resources.controller.js
// Просмотр каталога переговорных: список, карточка, занятость.
const pool = require('../db');

// GET /api/resources?search=...&location=...
// Каталог активных ресурсов с поиском по названию и фильтром по местоположению.
async function list(req, res) {
  try {
    const search = (req.query.search || '').trim();
    const location = (req.query.location || '').trim();

    const conditions = ['is_active = TRUE'];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`name ILIKE $${params.length}`);
    }
    if (location) {
      params.push(`%${location}%`);
      conditions.push(`location ILIKE $${params.length}`);
    }

    const sql = `
      SELECT id, name, description, location
      FROM resources
      WHERE ${conditions.join(' AND ')}
      ORDER BY name
    `;

    const { rows } = await pool.query(sql, params);
    res.json({ items: rows, total: rows.length });
  } catch (err) {
    console.error('[resources.list]', err);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка сервера',
      traceId: req.id,
    });
  }
}

// GET /api/resources/:id
// Карточка ресурса. Отключённый ресурс тоже доступен (для просмотра),
// но с флагом isActive = false.
async function getById(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'id должен быть положительным целым числом',
        traceId: req.id,
      });
    }

    const { rows } = await pool.query(
      `SELECT id, name, description, location, is_active AS "isActive"
       FROM resources WHERE id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Ресурс не найден',
        traceId: req.id,
      });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('[resources.getById]', err);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка сервера',
      traceId: req.id,
    });
  }
}

// GET /api/resources/:id/availability?date=YYYY-MM-DD
// Занятые интервалы на выбранную дату (в МСК). Без ФИО и целей.
async function availability(req, res) {
  try {
    const id = Number(req.params.id);
    const date = (req.query.date || '').trim();

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'id должен быть положительным целым числом',
        traceId: req.id,
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'date должен быть в формате YYYY-MM-DD',
        traceId: req.id,
      });
    }

    // Проверим, что ресурс существует
    const resourceCheck = await pool.query(
      'SELECT id FROM resources WHERE id = $1',
      [id]
    );
    if (resourceCheck.rows.length === 0) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Ресурс не найден',
        traceId: req.id,
      });
    }

    // Границы дня в МСК → UTC.
    // Простой приём: считаем, что date — это дата по МСК,
    // и берём интервал [date 00:00 МСК, date+1 00:00 МСК) в UTC.
    const { rows } = await pool.query(
      `SELECT start_time, end_time
       FROM bookings
       WHERE resource_id = $1
         AND status = 'active'
         AND start_time < (($2::date + INTERVAL '1 day') AT TIME ZONE 'Europe/Moscow')
         AND end_time   >  ($2::date AT TIME ZONE 'Europe/Moscow')
       ORDER BY start_time`,
      [id, date]
    );

    // Возвращаем в UTC ISO-8601, клиент сам покажет в МСК
    res.json({
      resourceId: id,
      date,
      busy: rows.map((r) => ({
        start: r.start_time.toISOString(),
        end:   r.end_time.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[resources.availability]', err);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка сервера',
      traceId: req.id,
    });
  }
}

module.exports = { list, getById, availability };