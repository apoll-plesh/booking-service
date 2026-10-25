// public/js/api.js
// Обёртка над fetch: добавляет токен, парсит JSON, обрабатывает ошибки.

const TOKEN_KEY = 'booking_token';
const USER_KEY = 'booking_user';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// Универсальная функция запроса.
// options: { method, body, headers, redirectOn401 }
async function apiFetch(path, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    redirectOn401 = true,
  } = options;

  const finalHeaders = { ...headers };
  if (body !== undefined) {
    finalHeaders['Content-Type'] = finalHeaders['Content-Type'] || 'application/json';
  }

  const token = getToken();
  if (token) {
    finalHeaders['Authorization'] = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (networkErr) {
    // Сетевая ошибка (нет связи, сервер выключен)
    const e = new Error('Нет связи с сервером. Проверьте интернет или повторите позже.');
    e.code = 'NETWORK_ERROR';
    e.status = 0;
    throw e;
  }

  // 204 No Content — тело пустое
  if (response.status === 204) {
    return null;
  }

  let data = null;
  const text = await response.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }

  if (response.ok) {
    return data;
  }

  // 401 — токен истёк или отсутствует
  if (response.status === 401) {
    clearSession();
    if (redirectOn401 && !location.pathname.endsWith('/index.html') && location.pathname !== '/') {
      location.href = '/index.html';
    }
  }

  const err = new Error((data && data.message) || `Ошибка ${response.status}`);
  err.code = (data && data.code) || 'ERROR';
  err.status = response.status;
  err.traceId = data && data.traceId;
  throw err;
}

// Утилиты форматирования дат (МСК)
function toMskString(isoUtc) {
  if (!isoUtc) return '—';
  const d = new Date(isoUtc);
  // МСК = UTC+3
  const msk = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const y = msk.getUTCFullYear();
  const mo = String(msk.getUTCMonth() + 1).padStart(2, '0');
  const da = String(msk.getUTCDate()).padStart(2, '0');
  const h = String(msk.getUTCHours()).padStart(2, '0');
  const mi = String(msk.getUTCMinutes()).padStart(2, '0');
  return `${da}.${mo}.${y} ${h}:${mi} МСК`;
}

// Утилита: генерация UUID v4 для Idempotency-Key
function uuidv4() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  // fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Утилита: экранирование HTML
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}