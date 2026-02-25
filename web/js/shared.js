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
  const layout = document.querySelector('.app-layout');
  if (!toggle || !drawer || !backdrop) return;

  const desktopQuery = window.matchMedia('(min-width: 1024px)');

  toggle.setAttribute('aria-controls', 'mobile-drawer');

  const setToggleState = (open) => {
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Tutup navigasi' : 'Buka navigasi');
    toggle.setAttribute('title', open ? 'Tutup navigasi' : 'Buka navigasi');
  };

  const setMobileOpen = (open) => {
    drawer.classList.toggle('open', open);
    backdrop.classList.toggle('hidden', !open);
    setToggleState(open);
  };

  const setDesktopOpen = (open) => {
    if (layout) {
      layout.classList.toggle('nav-open', open);
    }
    setToggleState(open);
  };

  const toggleNav = () => {
    if (desktopQuery.matches) {
      const isOpen = layout?.classList.contains('nav-open');
      setDesktopOpen(!isOpen);
    } else {
      setMobileOpen(!drawer.classList.contains('open'));
    }
  };

  const handleViewportChange = () => {
    if (desktopQuery.matches) {
      setMobileOpen(false);
      setDesktopOpen(false);
    } else {
      setDesktopOpen(false);
      setToggleState(drawer.classList.contains('open'));
    }
  };

  toggle.addEventListener('click', toggleNav);
  backdrop.addEventListener('click', () => setMobileOpen(false));
  if (closeBtn) closeBtn.addEventListener('click', () => setMobileOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (desktopQuery.matches) {
      if (layout?.classList.contains('nav-open')) {
        setDesktopOpen(false);
      }
    } else if (drawer.classList.contains('open')) {
      setMobileOpen(false);
    }
  });

  handleViewportChange();
  desktopQuery.addEventListener('change', handleViewportChange);
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

let detailToggleInited = false;
function initDetailToggle() {
  if (detailToggleInited) return;
  detailToggleInited = true;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'detail-toggle-btn';

  const updateLabel = () => {
    const showing = document.documentElement.classList.contains('show-details');
    btn.textContent = showing ? 'Sembunyikan detail' : 'Tampilkan detail';
  };

  btn.addEventListener('click', () => {
    document.documentElement.classList.toggle('show-details');
    updateLabel();
  });

  // Hanya tampil di mobile; sembunyikan otomatis saat layar besar
  const media = window.matchMedia('(max-width: 768px)');
  const syncVisibility = () => {
    if (media.matches) {
      btn.style.display = 'inline-flex';
    } else {
      btn.style.display = 'none';
      document.documentElement.classList.remove('show-details');
    }
    updateLabel();
  };
  media.addEventListener('change', syncVisibility);
  syncVisibility();

  document.body.appendChild(btn);
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
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9,.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === ',' || cleaned === '.') return null;

  const negative = cleaned.startsWith('-');
  const unsigned = cleaned.replace(/-/g, '');
  const hasSeparator = /[.,]/.test(unsigned);

  let normalized = unsigned;
  if (hasSeparator) {
    const lastDot = unsigned.lastIndexOf('.');
    const lastComma = unsigned.lastIndexOf(',');
    const lastSep = Math.max(lastDot, lastComma);
    const decimals = unsigned.slice(lastSep + 1);
    if (decimals.length > 0 && decimals.length <= 2) {
      const integerPart = unsigned.slice(0, lastSep).replace(/[.,]/g, '');
      normalized = `${integerPart}.${decimals}`;
    } else {
      normalized = unsigned.replace(/[.,]/g, '');
    }
  }

  const num = Number(normalized);
  if (Number.isNaN(num)) return null;
  return negative ? -Math.abs(num) : num;
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

function parseCurrencyInput(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isNaN(raw) ? null : raw;
  }
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  return Number(digits);
}

export function formatCurrencyInputValue(input) {
  if (!(input instanceof HTMLInputElement)) return;
  const num = parseCurrencyInput(input.value);
  if (num === null) {
    input.value = '';
    return;
  }
  input.value = rupiah.format(num);
}

export function initCurrencyInputs(root = document) {
  const inputs = root.querySelectorAll('input[data-currency]');
  inputs.forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.currencyBound === 'true') {
      formatCurrencyInputValue(input);
      return;
    }
    input.dataset.currencyBound = 'true';
    input.addEventListener('input', () => {
      const num = parseCurrencyInput(input.value);
      if (num === null) {
        input.value = '';
        return;
      }
      input.value = rupiah.format(num);
      input.setSelectionRange(input.value.length, input.value.length);
    });
    input.addEventListener('blur', () => {
      formatCurrencyInputValue(input);
    });
    formatCurrencyInputValue(input);
  });
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
    const aiLinks = document.querySelectorAll(
      '.nav-links a[data-page="ai-settings"]'
    );
    if (aiLinks.length && data.user?.role) {
      aiLinks.forEach((link) =>
        link.classList.toggle('hidden', data.user.role !== 'admin')
      );
    }
    return data.user || null;
  } catch (err) {
    return null;
  }
}

function normalizeStoreId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function getStoredStoreId() {
  try {
    return normalizeStoreId(window.localStorage.getItem(STORE_KEY));
  } catch (err) {
    return null;
  }
}

function getStoreSelectId() {
  const select = document.getElementById('store-select');
  if (!select) return null;
  return normalizeStoreId(select.value);
}

export function getActiveStoreId() {
  return getStoreSelectId() || getStoredStoreId();
}

export function setActiveStoreId(value) {
  const next = normalizeStoreId(value);
  if (!next) return;
  const current = getStoredStoreId();
  if (current === next) return;
  try {
    window.localStorage.setItem(STORE_KEY, String(next));
  } catch (err) {
    // ignore storage errors
  }
  window.dispatchEvent(new CustomEvent('store:change', { detail: { storeId: next } }));
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

    const activeId = normalizeStoreId(active?.store?.id);
    const stored = getStoredStoreId();
    const fallback = normalizeStoreId(stores[0]?.id);
    const hasStore = (value) =>
      value != null &&
      stores.some((store) => normalizeStoreId(store.id) === value);
    const selected = hasStore(activeId)
      ? activeId
      : hasStore(stored)
        ? stored
        : fallback;
    if (selected) {
      select.value = String(selected);
      setActiveStoreId(selected);
      if (selected !== activeId) {
        try {
          await fetchJson('/api/store/active', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ store_id: selected })
          });
        } catch (err) {
          // ignore
        }
      }
    }

    select.onchange = async () => {
      const next = normalizeStoreId(select.value);
      if (next) {
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
  initCurrencyInputs();
  initDetailToggle();
  await initStoreSelector();
  fetchMe();
}
