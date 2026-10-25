// src/auth/password.js
// Хеширование и проверка паролей через bcrypt.
// bcrypt — медленный алгоритм намеренно: чтобы перебор паролей был невыгоден.
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

// Хешировать пароль (при создании пользователя)
async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

// Проверить пароль против хеша (при входе)
async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { hashPassword, verifyPassword };