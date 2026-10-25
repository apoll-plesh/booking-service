// src/auth/jwt.js
// Подпись и проверка JWT.
// В токен кладём только то, что нужно для быстрой проверки: id и role.
// Пароль, email и прочее — не кладём (токен читается всеми, у кого он есть).
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

if (!SECRET) {
  throw new Error('JWT_SECRET не задан в .env — сервер не может стартовать');
}

// Подписать токен
function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,       // subject = чей токен (стандартное поле JWT)
      role: user.role,    // роль — чтобы не дёргать БД на каждый запрос
    },
    SECRET,
    { expiresIn: EXPIRES_IN }
  );
}

// Проверить токен. Бросает исключение, если токен невалидный или истёк.
function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { signToken, verifyToken };