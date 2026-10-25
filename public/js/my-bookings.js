// public/js/my-bookings.js
// Список своих броней + отмена.

const loadingEl = document.getElementById('list-loading');
const errorEl = document.getElementById('list-error');
const emptyEl = document.getElementById('list-empty');
const tableEl = document.getElementById('list-table');
const tbodyEl = document.getElementById('list-body');
const statusFilter = document.getElementById('status-filter');
const cancelSuccess = document.getElementById('cancel-success');
const cancelError = document.getElementById('cancel-error');

async function loadList() {
  loadingEl.style.display = '';
  errorEl.textContent = '';
  emptyEl.style.display = 'none';
  tableEl.style.display = 'none';
  tbodyEl.innerHTML = '';

  const status = statusFilter.value;
  const url = '/api/bookings/my' + (status ? `?status=${status}` : '');

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
      const endStr = toMskString(b.end).split(' ')[1]; // только время
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
          <td>${startStr} – ${endStr}</td>
          <td>${escapeHtml(b.purpose)}${b.cancelReason ? `<div style="font-size:12px;color:#777;margin-top:4px;">Причина отмены: ${escapeHtml(b.cancelReason)}</div>` : ''}</td>
          <td>${statusTag}</td>
          <td class="row-actions">${actionBtn}</td>
        </tr>
      `;
    }).join('');

    // Обработчики «Отменить»
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

  if (!confirm(`Отменить бронь №${id}?`)) return;

  btn.disabled = true;
  btn.textContent = '…';

  try {
    await apiFetch(`/api/bookings/${id}/cancel`, {
      method: 'POST',
      body: {},
    });
    cancelSuccess.textContent = `Бронь №${id} отменена.`;
    await loadList();
  } catch (err) {
    cancelError.textContent = err.message || 'Не удалось отменить';
    btn.disabled = false;
    btn.textContent = 'Отменить';
  }
}

statusFilter.addEventListener('change', loadList);
loadList();