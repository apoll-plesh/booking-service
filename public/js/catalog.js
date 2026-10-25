// public/js/catalog.js
// Каталог: загрузка списка, поиск, фильтр.

const listEl = document.getElementById('list');
const loadingEl = document.getElementById('list-loading');
const errorEl = document.getElementById('list-error');
const emptyEl = document.getElementById('list-empty');
const searchEl = document.getElementById('search');
const locationEl = document.getElementById('location');

let debounceTimer = null;

async function loadList() {
  loadingEl.style.display = '';
  errorEl.textContent = '';
  emptyEl.style.display = 'none';
  listEl.innerHTML = '';

  const params = new URLSearchParams();
  if (searchEl.value.trim()) params.set('search', searchEl.value.trim());
  if (locationEl.value.trim()) params.set('location', locationEl.value.trim());
  const qs = params.toString();
  const url = '/api/resources' + (qs ? `?${qs}` : '');

  try {
    const data = await apiFetch(url);
    loadingEl.style.display = 'none';

    if (!data.items || data.items.length === 0) {
      emptyEl.style.display = '';
      return;
    }

    listEl.innerHTML = data.items.map((r) => `
      <div class="card">
        <h3><a href="/resource.html?id=${r.id}">${escapeHtml(r.name)}</a></h3>
        <div><strong>Где:</strong> ${escapeHtml(r.location)}</div>
        ${r.description ? `<div style="margin-top:6px;color:#555;">${escapeHtml(r.description)}</div>` : ''}
        <div style="margin-top:10px;">
          <a href="/resource.html?id=${r.id}"><button type="button">Открыть</button></a>
        </div>
      </div>
    `).join('');
  } catch (err) {
    loadingEl.style.display = 'none';
    errorEl.textContent = err.message || 'Не удалось загрузить каталог';
  }
}

function debouncedLoad() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadList, 300);
}

searchEl.addEventListener('input', debouncedLoad);
locationEl.addEventListener('input', debouncedLoad);

// Первичная загрузка
loadList();