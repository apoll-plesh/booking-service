// src/controllers/auth.controller.js
// Вход в систему: проверка логина/пароля, выдача JWT.
const pool = require('../db');
const { verifyPassword } = require('../auth/password');
const { signToken } = require('../auth/jwt');

// POST /api/auth/signin
// Тело: { login, password }
// Ответ: { token, user: { id, name, login, role } }
async function signin(req, res) {
  try {
    const { login, password } = req.body || {};

    // 1. Проверка входных данных
    if (typeof login !== 'string' || typeof password !== 'string'
        || login.trim() === '' || password === '') {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Поля login и password обязательны',
        traceId: req.id,
      });
    }

    // 2. Ищем пользователя
    const { rows } = await pool.query(
      'SELECT id, name, login, password_hash, role FROM users WHERE login = $1',
      [login.trim()]
    );
    const user = rows[0];

    // 3. Если нет пользователя ИЛИ пароль не совпал — один и тот же ответ.
    //    Это защита от «перебора логинов»: нельзя понять, существует ли логин.
    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    if (!ok) {
      return res.status(401).json({
        code: 'INVALID_CREDENTIALS',
        message: 'Неверный логин или пароль',
        traceId: req.id,
      });
    }

    // 4. Выдаём токен
    const token = signToken({ id: user.id, role: user.role });

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        login: user.login,
        role: user.role,
      },
    });
  } catch (err) {
    // Непредвиденная ошибка — логируем на сервере, клиенту не раскрываем детали
    console.error('[signin]', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка сервера',
      traceId: req.id,
    });
  }
}

module.exports = { signin };