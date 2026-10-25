// src/bookings/validate.js
// Валидация входных данных для создания брони.
// Возвращает либо { ok: true, data }, либо { ok: false, code, message }.

const WORK_START_HOUR = 8;   // 08:00 МСК
const WORK_END_HOUR   = 22;  // 22:00 МСК
const MIN_DURATION_MIN = 30;
const MAX_DURATION_MIN = 240;
const STEP_MINUTES = 30;
const MAX_DAYS_AHEAD = 30;

// Проверяет, что момент времени попадает в «сетку» 30 минут
function isStepAligned(date) {
  return date.getUTCMinutes() % STEP_MINUTES === 0 && date.getUTCSeconds() === 0;
}

// Переводит Date в «минуты от полуночи по Москве» (0..1439)
function moscowMinutes(date) {
  // Москва = UTC+3 (без перехода на летнее время с 2014)
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return msk.getUTCHours() * 60 + msk.getUTCMinutes();
}

// Дата в Москве в формате YYYY-MM-DD
function moscowDateString(date) {
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const y = msk.getUTCFullYear();
  const m = String(msk.getUTCMonth() + 1).padStart(2, '0');
  const d = String(msk.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function validateBookingInput(body) {
  const { resourceId, startTime, endTime, purpose } = body || {};

  // --- resourceId ---
  const rid = Number(resourceId);
  if (!Number.isInteger(rid) || rid <= 0) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'resourceId должен быть положительным целым числом' };
  }

  // --- purpose ---
  if (typeof purpose !== 'string') {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'purpose обязателен' };
  }
  const trimmedPurpose = purpose.trim();
  if (trimmedPurpose.length < 5 || trimmedPurpose.length > 300) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Цель должна быть от 5 до 300 символов' };
  }

  // --- startTime, endTime ---
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (isNaN(start.getTime())) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'startTime должен быть ISO 8601 с часовым поясом' };
  }
  if (isNaN(end.getTime())) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'endTime должен быть ISO 8601 с часовым поясом' };
  }

  if (end <= start) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Окончание должно быть позже начала' };
  }

  // --- шаг 30 минут ---
  if (!isStepAligned(start) || !isStepAligned(end)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Время должно быть кратно 30 минутам' };
  }

  // --- длительность ---
  const durationMin = (end - start) / 60000;
  if (durationMin < MIN_DURATION_MIN || durationMin > MAX_DURATION_MIN) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Длительность должна быть от 30 минут до 4 часов' };
  }

  // --- рабочий день МСК ---
  const startMin = moscowMinutes(start);
  const endMin   = moscowMinutes(end);
  if (startMin < WORK_START_HOUR * 60 || endMin > WORK_END_HOUR * 60 || endMin <= startMin) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Время должно быть в пределах 08:00–22:00 МСК и в один день' };
  }

  // --- один рабочий день ---
  if (moscowDateString(start) !== moscowDateString(end)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Бронь должна помещаться в один рабочий день' };
  }

  // --- не в прошлом и не позже 30 суток ---
  const now = new Date();
  if (start <= now) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Начало не должно быть в прошлом' };
  }
  const maxAhead = new Date(now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000);
  if (start > maxAhead) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Начало не позднее чем через 30 суток' };
  }

  return {
    ok: true,
    data: {
      resourceId: rid,
      startTime: start,
      endTime: end,
      purpose: trimmedPurpose,
    },
  };
}

module.exports = { validateBookingInput };// src/bookings/validate.js
// Валидация входных данных для создания брони.
// Возвращает либо { ok: true, data }, либо { ok: false, code, message }.