import { initThemeToggle } from './shared.js';

const form = document.getElementById('login-form');
const errorBox = document.getElementById('login-error');

async function redirectIfLoggedIn() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (!data?.activeStore) {
        window.location.href = '/select-store';
      } else {
        window.location.href = '/dashboard';
      }
    }
  } catch (err) {
    // Ignore
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data?.error === 'account_disabled') {
        errorBox.textContent = 'Akun nonaktif. Hubungi admin.';
      } else {
        errorBox.textContent = 'Login gagal. Periksa username & password.';
      }
      return;
    }

    const redirect = data?.redirect || '/dashboard';
    window.location.href = redirect;
  } catch (err) {
    errorBox.textContent = 'Tidak bisa login. Coba lagi.';
  }
});

redirectIfLoggedIn();
initThemeToggle();
