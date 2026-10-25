// src/auth/middleware.js
// Middleware — функции, которые выполняются ДО контроллера.
// Здесь: проверка JWT и проверка роли.
const { verifyToken: jwtVerify } = require('./jwt');

// Проверяет, что в заголовке Authorization есть валидный Bearer-токен.
// Если да — кладёт { id, role } в req.user и вызывает next().
// Если нет — отвечает 401.
function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Требуется токен в заголовке Authorization: Bearer <token>',
      traceId: req.id,
    });
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    const payload = jwtVerify(token);
    // payload.sub — id пользователя, payload.role — роль
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch (err) {
    // Истёк или невалиден — в обоих случаях 401
    return res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Токен недействителен или истёк',
      traceId: req.id,
    });
  }
}

// Проверяет, что пользователь — администратор.
// Должен использоваться ПОСЛЕ verifyToken.
function isAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({
    code: 'FORBIDDEN',
    message: 'Требуются права администратора',
    traceId: req.id,
  });
}

module.exports = { verifyToken, isAdmin };