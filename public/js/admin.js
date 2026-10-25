// public/js/admin.js
// Админ-панель: все брони с фильтрами + отмена с причиной.

const loadingEl = document.getElementById('list-loading');
const errorEl = document.getElementById('list-error');
const emptyEl = document.getElementById('list-empty');
const tableEl = document.getElementById('list-table');
const tbodyEl = document.getElementById('list-body');
const filterStatus = document.getElementById('filter-status');
const filterResource = document.getElementById('filter-resource');
const filterDate = document.getElementById('filter-date');
const cancelSuccess = document.getElementById('cancel-success');
const cancelError = document.getElementById('cancel-error');

let debounceTimer = null;

async function loadList() {
  loadingEl.style.display = '';
  errorEl.textContent = '';
  emptyEl.style.display = 'none';
  tableEl.style.display = 'none';
  tbodyEl.innerHTML = '';

  const params = new URLSearchParams();
  if (filterStatus.value) params.set('status', filterStatus.value);
  if (filterResource.value) params.set('resourceId', filterResource.value);
  if (filterDate.value) params.set('date', filterDate.value);
  const qs = params.toString();
  const url = '/api/admin/bookings' + (qs ? `?${qs}` : '');

  try {
    const data = await apiFetch(url);
    loadingEl.style.display = 'none';

    if (!data.items || data.items.length === 0) {
      emptyEl.style.display = '';
      return;
    }

    tableEl.style.display = '';
    tbodyEl.innerHTML = data.items.map((b) => {
      const startStr = toMskString(b.start);
      const endStr = toMskString(b.end).split(' ')[1];
      const canCancel = b.status === 'active' && new Date(b.start) > new Date();

      const statusTag = b.status === 'active'
        ? '<span class="tag">Активна</span>'
        : '<span class="tag cancelled">Отменена</span>';

      const actionBtn = canCancel
        ? `<button class="danger" data-id="${b.id}" type="button">Отменить</button>`
        : '';

      return `
        <tr>
          <td>${b.id}</td>
          <td>${escapeHtml(b.resourceName)}</td>
          <td>${escapeHtml(b.ownerName)}<br><span style="color:#777;font-size:12px;">${escapeHtml(b.ownerLogin)}</span></td>
          <td>${startStr} – ${endStr}</td>
          <td>${escapeHtml(b.purpose)}${b.cancelReason ? `<div style="font-size:12px;color:#777;margin-top:4px;">Причина: ${escapeHtml(b.cancelReason)}</div>` : ''}</td>
          <td>${statusTag}<br>${actionBtn}</td>
        </tr>
      `;
    }).join('');

    tbodyEl.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => onCancel(Number(btn.dataset.id), btn));
    });
  } catch (err) {
    loadingEl.style.display = 'none';
    errorEl.textContent = err.message || 'Не удалось загрузить список';
  }
}

async function onCancel(id, btn) {
  cancelSuccess.textContent = '';
  cancelError.textContent = '';

  const reason = prompt(`Отменить бронь №${id}?\nУкажите причину (обязательно для администратора):`);
  if (reason === null) return; // отмена диалога
  if (reason.trim().length === 0) {
    cancelError.textContent = 'Причина обязательна для администратора.';
    return;
  }

  btn.disabled = true;
  btn.textContent = '…';

  try {
    await apiFetch(`/api/bookings/${id}/cancel`, {
      method: 'POST',
      body: { reason: reason.trim() },
    });
    cancelSuccess.textContent = `Бронь №${id} отменена.`;
    await loadList();
  } catch (err) {
    cancelError.textContent = err.message || 'Не удалось отменить';
    btn.disabled = false;
    btn.textContent = 'Отменить';
  }
}

function debouncedLoad() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadList, 300);
}

filterStatus.addEventListener('change', loadList);
filterResource.addEventListener('input', debouncedLoad);
filterDate.addEventListener('change', loadList);

loadList();