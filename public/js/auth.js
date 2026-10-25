// public/js/auth.js
// Логика входа на странице index.html.
// Если токен уже есть — редирект в каталог.

document.addEventListener('DOMContentLoaded', () => {
    // Уже вошли? — в каталог
    if (getToken()) {
      location.href = '/catalog.html';
      return;
    }
  
    const form = document.getElementById('signin-form');
    const errEl = document.getElementById('form-error');
    const btn = document.getElementById('signin-btn');
    if (!form) return;
  
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      errEl.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Входим...';
  
      const login = form.login.value.trim();
      const password = form.password.value;
  
      try {
        const data = await apiFetch('/api/auth/signin', {
          method: 'POST',
          body: { login, password },
          redirectOn401: false, // при неверном пароле — не редиректим
        });
        saveSession(data.token, data.user);
        location.href = '/catalog.html';
      } catch (err) {
        if (err.status === 401) {
          errEl.textContent = 'Неверный логин или пароль';
        } else if (err.status === 400) {
          errEl.textContent = err.message || 'Проверьте введённые данные';
        } else if (err.code === 'NETWORK_ERROR') {
          errEl.textContent = err.message;
        } else {
          errEl.textContent = err.message || 'Не удалось войти';
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Войти';
      }
    });
  });