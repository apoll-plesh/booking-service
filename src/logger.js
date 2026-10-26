// src/logger.js
// Минимальный логгер: JSON в stdout.
// При ошибке клиенту отдаём traceId — по нему в логах можно найти запись.

function log(level, message, meta = {}) {
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
      ...meta,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  }
  
  module.exports = {
    info:  (msg, meta) => log('info',  msg, meta),
    warn:  (msg, meta) => log('warn',  msg, meta),
    error: (msg, meta) => log('error', msg, meta),
  };