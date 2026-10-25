// public/js/common.js
// Общее поведение для всех страниц, кроме index.html.

document.addEventListener('DOMContentLoaded', () => {
    // Нет токена — на вход
    if (!getToken()) {
      location.href = '/index.html';
      return;
    }
  
    const user = getUser();
    const nameEl = document.getElementById('user-name');
    if (nameEl && user) nameEl.textContent = `${user.name} (${user.role})`;
  
    // Показать ссылку «Админ» только админу
    const adminLink = document.getElementById('admin-link');
    if (adminLink && user && user.role === 'admin') {
      adminLink.style.display = '';
    }
  
    // Кнопка «Выйти»
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        clearSession();
        location.href = '/index.html';
      });
    }
  });