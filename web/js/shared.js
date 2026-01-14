const formatter = new Intl.NumberFormat('id-ID');
const STORE_KEY = 'stockpilot-store-id';
const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
});

const THEME_KEY = 'stockpilot-theme';

function getPreferredTheme() {
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyTheme(theme) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  return nextTheme;
}

function updateThemeToggle(theme) {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  const next = theme === 'dark' ? 'Light' : 'Dark';
  toggle.textContent = next;
  toggle.setAttribute('aria-label', `Switch to ${next.toLowerCase()} mode`);
}

export function initThemeToggle() {
  const theme = applyTheme(getPreferredTheme());
  updateThemeToggle(theme);

  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const current = document.documentElement.dataset.theme || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      updateThemeToggle(next);
      window.localStorage.setItem(THEME_KEY, next);
    });
  }
}

function initMobileNav() {
  const toggle = document.getElementById('menu-toggle');
  const drawer = document.getElementById('mobile-drawer');
  const backdrop = document.getElementById('mobile-backdrop');
  const closeBtn = document.getElementById('mobile-close');
  if (!toggle || !drawer || !backdrop) return;

  const open = () => {
    drawer.classList.add('open');
    backdrop.classList.remove('hidden');
  };

  const close = () => {
    drawer.classList.remove('open');
    backdrop.classList.add('hidden');
  };

  toggle.addEventListener('click', () => {
    if (drawer.classList.contains('open')) {
      close();
    } else {
      open();
    }
  });

  backdrop.addEventListener('click', close);
  if (closeBtn) closeBtn.addEventListener('click', close);
}

function initAccountMenu() {
  const toggle = document.getElementById('account-toggle');
  const menu = document.getElementById('account-menu');
  if (!toggle || !menu) return;

  const close = () => {
    menu.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
  };

  const open = () => {
    menu.classList.remove('hidden');
    toggle.setAttribute('aria-expanded', 'true');
  };

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.classList.contains('hidden')) {
      open();
    } else {
      close();
    }
  });

  document.addEventListener('click', (event) => {
    if (!menu.contains(event.target) && !toggle.contains(event.target)) {
      close();
    }
  });

  menu.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('button, a')) {
      close();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
    }
  });
}

export function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

export async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    window.location.href = '/login';
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = data?.error || 'request_failed';
    throw new Error(error);
  }
  return data;
}

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function toNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

export function formatCurrency(value) {
  const num = toNumber(value);
  if (num === null) return '-';
  return rupiah.format(num);
}

export function formatSignedCurrency(value) {
  const num = toNumber(value);
  if (num === null) return '-';
  if (num < 0) return `- ${rupiah.format(Math.abs(num))}`;
  if (num > 0) return `+ ${rupiah.format(num)}`;
  return rupiah.format(0);
}

export function formatNumber(value) {
  const num = toNumber(value);
  if (num === null) return '0';
  return formatter.format(num);
}

export async function fetchMe() {
  try {
    const data = await fetchJson('/api/me');
    if (!data) return null;
    const userName = data.user?.username || 'user';
    const userPill = document.getElementById('user-pill');
    if (userPill) {
      userPill.textContent = userName;
    }
    const userAvatar = document.getElementById('user-avatar');
    if (userAvatar) {
      userAvatar.textContent = userName.charAt(0).toUpperCase();
    }
    const userRole = document.getElementById('user-role');
    if (userRole) {
      userRole.textContent = data.user?.role === 'admin' ? 'Admin' : 'Staff';
    }
    const usersLinks = document.querySelectorAll('.nav-links a[data-page="users"]');
    if (usersLinks.length && data.user?.role) {
      usersLinks.forEach((link) =>
        link.classList.toggle('hidden', data.user.role !== 'admin')
      );
    }
    const storesLinks = document.querySelectorAll('.nav-links a[data-page="stores"]');
    if (storesLinks.length && data.user?.role) {
      storesLinks.forEach((link) =>
        link.classList.toggle('hidden', data.user.role !== 'admin')
      );
    }
    return data.user || null;
  } catch (err) {
    return null;
  }
}

export function getActiveStoreId() {
  const stored = window.localStorage.getItem(STORE_KEY);
  const id = Number(stored);
  return Number.isFinite(id) ? id : null;
}

export function setActiveStoreId(value) {
  if (!value) return;
  const current = getActiveStoreId();
  if (current === value) return;
  window.localStorage.setItem(STORE_KEY, String(value));
  window.dispatchEvent(new CustomEvent('store:change', { detail: { storeId: value } }));
}

async function initStoreSelector() {
  const select = document.getElementById('store-select');
  if (!select) return;

  try {
    const [data, active] = await Promise.all([
      fetchJson('/api/stores'),
      fetchJson('/api/store/active')
    ]);
    if (!data) return;
    const stores = data.data || [];

    if (!stores.length) {
      select.innerHTML = '<option value=\"\">No store</option>';
      select.disabled = true;
      return;
    }

    select.innerHTML = stores
      .map(
        (store) =>
          `<option value=\"${store.id}\">${store.name}</option>`
      )
      .join('');

    const activeId = Number(active?.store?.id);
    const stored = getActiveStoreId();
    const fallback = stores[0]?.id;
    const selected = stores.some((store) => store.id === activeId)
      ? activeId
      : stores.some((store) => store.id === stored)
        ? stored
        : fallback;
    if (selected) {
      select.value = String(selected);
      setActiveStoreId(selected);
    }

    select.onchange = async () => {
      const next = Number(select.value);
      if (Number.isFinite(next)) {
        try {
          await fetchJson('/api/store/active', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ store_id: next })
          });
        } catch (err) {
          // ignore
        }
        setActiveStoreId(next);
      }
    };
  } catch (err) {
    // ignore
  }
}

export async function refreshStoreSelector() {
  await initStoreSelector();
}

export async function initNav(activePage) {
  const navLinks = document.querySelectorAll('.nav-links a[data-page]');
  navLinks.forEach((link) => {
    if (link.dataset.page === activePage) {
      link.classList.add('active');
    }
  });

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetchJson('/api/logout', { method: 'POST' });
      } catch (err) {
        // ignore
      }
      window.location.href = '/login';
    });
  }

  initThemeToggle();
  initMobileNav();
  initAccountMenu();
  await initStoreSelector();
  fetchMe();
}
