// public/js/resource.js
// Карточка ресурса + создание брони.

const params = new URLSearchParams(location.search);
const resourceId = Number(params.get('id'));

const cardLoading = document.getElementById('card-loading');
const cardError = document.getElementById('card-error');
const resourceCard = document.getElementById('resource-card');
const nameEl = document.getElementById('resource-name');
const locEl = document.getElementById('resource-location');
const descRow = document.getElementById('resource-description-row');
const descEl = document.getElementById('resource-description');
const inactiveEl = document.getElementById('resource-inactive');
const dateEl = document.getElementById('date');
const busyLoading = document.getElementById('busy-loading');
const busyError = document.getElementById('busy-error');
const busyList = document.getElementById('busy-list');
const busyEmpty = document.getElementById('busy-empty');
const form = document.getElementById('booking-form');
const startEl = document.getElementById('start');
const endEl = document.getElementById('end');
const purposeEl = document.getElementById('purpose');
const bookingError = document.getElementById('booking-error');
const bookingSuccess = document.getElementById('booking-success');
const bookingBtn = document.getElementById('booking-btn');

let resourceIsActive = false;
// Один и тот же ключ, пока форма не изменила «смысл» запроса
let currentIdempotencyKey = uuidv4();
let currentFingerprint = null;

function todayMskIsoDate() {
  // Сегодняшняя дата по Москве в формате YYYY-MM-DD
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function timeOptions() {
  // 08:00 ... 21:30 (шаг 30 минут) — начала
  const arr = [];
  for (let h = 8; h < 22; h++) {
    for (const m of [0, 30]) {
      arr.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
    }
  }
  return arr;
}

function fillTimeSelects() {
  const times = timeOptions();
  startEl.innerHTML = times.map(t => `<option value="${t}">${t}</option>`).join('');
  endEl.innerHTML = times.map(t => `<option value="${t}">${t}</option>`).join('');
  // По умолчанию: начало 10:00, окончание 11:00
  startEl.value = '10:00';
  endEl.value = '11:00';
}

async function loadResource() {
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    cardLoading.style.display = 'none';
    cardError.textContent = 'Некорректный id ресурса в адресе';
    return;
  }

  try {
    const r = await apiFetch(`/api/resources/${resourceId}`);
    cardLoading.style.display = 'none';
    resourceCard.style.display = '';
    nameEl.textContent = r.name;
    locEl.textContent = r.location;
    if (r.description) {
      descEl.textContent = r.description;
    } else {
      descRow.style.display = 'none';
    }
    resourceIsActive = !!r.isActive;
    if (!resourceIsActive) {
      inactiveEl.style.display = '';
    } else {
      form.style.display = '';
      fillTimeSelects();
    }
    // Загрузим занятость на сегодня
    dateEl.value = todayMskIsoDate();
    await loadAvailability();
  } catch (err) {
    cardLoading.style.display = 'none';
    cardError.textContent = err.message || 'Не удалось загрузить карточку';
  }
}

async function loadAvailability() {
  const date = dateEl.value;
  if (!date) return;

  busyLoading.style.display = '';
  busyError.textContent = '';
  busyList.innerHTML = '';
  busyEmpty.style.display = 'none';

  try {
    const data = await apiFetch(`/api/resources/${resourceId}/availability?date=${encodeURIComponent(date)}`);
    busyLoading.style.display = 'none';
    if (!data.busy || data.busy.length === 0) {
      busyEmpty.style.display = '';
      return;
    }
    busyList.innerHTML = data.busy.map(b => {
      const s = toMskString(b.start);
      const e = toMskString(b.end);
      // Уберём «дата» из второй части — оставим только время
      const sTime = s.split(' ')[1];
      const eTime = e.split(' ')[1];
      return `<li>${sTime} – ${eTime}</li>`;
    }).join('');
  } catch (err) {
    busyLoading.style.display = 'none';
    busyError.textContent = err.message || 'Не удалось загрузить занятость';
  }
}

// При изменении «смысла» запроса — новый ключ идемпотентности
function markFormChanged() {
  const fp = JSON.stringify({
    resourceId,
    date: dateEl.value,
    start: startEl.value,
    end: endEl.value,
    purpose: purposeEl.value.trim(),
  });
  if (fp !== currentFingerprint) {
    currentFingerprint = fp;
    currentIdempotencyKey = uuidv4();
  }
}

form.addEventListener('input', markFormChanged);
form.addEventListener('change', markFormChanged);

dateEl.addEventListener('change', loadAvailability);

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  bookingError.textContent = '';
  bookingSuccess.textContent = '';

  const date = dateEl.value;
  const start = startEl.value;
  const end = endEl.value;
  const purpose = purposeEl.value.trim();

  if (!date) { bookingError.textContent = 'Выберите дату'; return; }
  if (!purpose || purpose.length < 5) {
    bookingError.textContent = 'Цель должна быть не короче 5 символов';
    return;
  }

  // Собираем ISO-строки в МСК (+03:00)
  const startTime = `${date}T${start}:00+03:00`;
  const endTime = `${date}T${end}:00+03:00`;

  bookingBtn.disabled = true;
  bookingBtn.textContent = 'Отправляем…';

  try {
    const created = await apiFetch('/api/bookings', {
      method: 'POST',
      headers: { 'Idempotency-Key': currentIdempotencyKey },
      body: {
        resourceId,
        startTime,
        endTime,
        purpose,
      },
    });

    bookingSuccess.textContent =
      `Готово! Бронь №${created.id} на ${toMskString(created.start)} – ${toMskString(created.end).split(' ')[1]}.`;

    // После успеха — новый ключ (следующая бронь = новая операция)
    currentFingerprint = null;
    currentIdempotencyKey = uuidv4();
    purposeEl.value = '';

    // Обновим занятость
    await loadAvailability();
  } catch (err) {
    if (err.status === 409) {
      bookingError.textContent = 'Ресурс уже занят в выбранное время. Выберите другой интервал.';
    } else if (err.status === 400) {
      bookingError.textContent = err.message || 'Проверьте параметры брони';
    } else {
      bookingError.textContent = err.message || 'Не удалось создать бронь';
    }
    // Ключ НЕ меняем — можно повторить тот же запрос
  } finally {
    bookingBtn.disabled = false;
    bookingBtn.textContent = 'Забронировать';
  }
});

loadResource();