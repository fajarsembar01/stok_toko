const formatter = new Intl.NumberFormat('id-ID');
const STORE_KEY = 'stockpilot-store-id';
const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
});

const THEME_KEY = 'stockpilot-theme';
const OFFLINE_QUEUE_KEY = 'stockpilot:offline-queue:v1';
const COMMAND_HISTORY_KEY = 'stockpilot:command-history:v1';
const COMMAND_PRODUCTS_LIMIT = 6;
const COMMAND_TRANSACTIONS_LIMIT = 6;
const COMMAND_ACTIONS_LIMIT = 12;
const COMMAND_HISTORY_LIMIT = 6;
let mobileStoreObserver;
let quickSheetEscBound = false;
let globalFetchPatched = false;
let globalFetchInflight = 0;
let globalFetchShowTimer = null;
let globalFetchHideTimer = null;
let nativeFetchRef = null;
let networkBadgeInit = false;
let networkBadgeHideTimer = null;
let offlineQueueSize = 0;
let offlineQueueInit = false;
let offlineQueueProcessing = false;
let offlineQueueToastAt = 0;
let commandPaletteInit = false;
let commandEscBound = false;
let commandSearchTimer = null;
let commandSearchAbort = null;
let commandSearchSeq = 0;
let pullRefreshBoundKeys = new Set();
let undoSnackTimer = null;
let undoSnackCurrent = null;
let undoSnackQueue = [];

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
    document.body.classList.toggle('mobile-nav-open', open && !desktopQuery.matches);
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
  drawer.querySelectorAll('a.nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      if (!desktopQuery.matches) setMobileOpen(false);
    });
  });
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

function initDrawerStoreSelector() {
  const topSelect = document.getElementById('store-select');
  const drawer = document.getElementById('mobile-drawer');
  if (!topSelect || !drawer) return;
  if (document.body.classList.contains('products-page')) return;
  if (drawer.querySelector('#mobile-store-select')) return;

  let wrap = drawer.querySelector('.global-mobile-store-wrap');
  let mobileSelect = drawer.querySelector('#mobile-store-select-global');

  if (!wrap || !mobileSelect) {
    wrap = document.createElement('div');
    wrap.className = 'mobile-store-wrap global-mobile-store-wrap';
    wrap.innerHTML = `
      <div class="mobile-store-label">Toko aktif</div>
      <select
        id="mobile-store-select-global"
        class="select mobile-store-select"
        aria-label="Pilih toko aktif"
      ></select>
    `;
    const nav = drawer.querySelector('.nav-links');
    if (nav) {
      drawer.insertBefore(wrap, nav);
    } else {
      drawer.appendChild(wrap);
    }
    mobileSelect = wrap.querySelector('#mobile-store-select-global');
  }

  if (!(mobileSelect instanceof HTMLSelectElement)) return;

  const syncSelect = () => {
    mobileSelect.innerHTML = topSelect.innerHTML;
    mobileSelect.disabled = Boolean(topSelect.disabled);
    mobileSelect.value = topSelect.value;
  };

  if (mobileSelect.dataset.bound === 'true') {
    syncSelect();
    return;
  }

  mobileSelect.dataset.bound = 'true';
  syncSelect();

  mobileSelect.addEventListener('change', () => {
    const next = String(mobileSelect.value || '');
    if (!next || topSelect.value === next) return;
    topSelect.value = next;
    topSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });

  topSelect.addEventListener('change', syncSelect);
  window.addEventListener('store:change', syncSelect);

  if (typeof MutationObserver !== 'undefined') {
    if (mobileStoreObserver) mobileStoreObserver.disconnect();
    mobileStoreObserver = new MutationObserver(syncSelect);
    mobileStoreObserver.observe(topSelect, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled']
    });
  }
}

function closeDrawerWithFallback(drawer) {
  if (!(drawer instanceof HTMLElement)) return;
  const closeBtn = drawer.querySelector('.drawer-close-btn, #close-drawer');
  if (closeBtn instanceof HTMLElement) {
    closeBtn.click();
    return;
  }

  drawer.classList.remove('open');
  const backdrop =
    drawer.previousElementSibling instanceof HTMLElement &&
    drawer.previousElementSibling.classList.contains('drawer-backdrop')
      ? drawer.previousElementSibling
      : document.querySelector('.drawer-backdrop:not(.hidden)');
  if (backdrop instanceof HTMLElement) {
    backdrop.classList.add('hidden');
  }
}

function bindDrawerSwipeClose(drawer) {
  if (!(drawer instanceof HTMLElement)) return;
  if (drawer.dataset.swipeCloseBound === 'true') return;
  drawer.dataset.swipeCloseBound = 'true';

  const mobileQuery = window.matchMedia('(max-width: 1023px)');
  const swipe = {
    tracking: false,
    startY: 0,
    startX: 0,
    offsetY: 0
  };

  const reset = () => {
    drawer.style.transform = '';
    drawer.style.transition = '';
    drawer.style.willChange = '';
    swipe.tracking = false;
    swipe.offsetY = 0;
  };

  drawer.addEventListener(
    'touchstart',
    (event) => {
      if (!mobileQuery.matches || !drawer.classList.contains('open')) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const swipeHandle = event.target.closest('.sheet-grab, .drawer-header');
      if (!swipeHandle || !drawer.contains(swipeHandle)) return;

      swipe.tracking = true;
      swipe.startY = touch.clientY;
      swipe.startX = touch.clientX;
      swipe.offsetY = 0;
      drawer.style.transition = 'none';
      drawer.style.willChange = 'transform';
    },
    { passive: true }
  );

  drawer.addEventListener(
    'touchmove',
    (event) => {
      if (!swipe.tracking) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const deltaY = touch.clientY - swipe.startY;
      const deltaX = touch.clientX - swipe.startX;
      if (deltaY <= 0 || Math.abs(deltaY) < Math.abs(deltaX)) return;

      event.preventDefault();
      swipe.offsetY = Math.min(deltaY, 280);
      drawer.style.transform = `translateY(${swipe.offsetY}px)`;
    },
    { passive: false }
  );

  const endSwipe = () => {
    if (!swipe.tracking) return;
    const offsetY = swipe.offsetY;
    swipe.tracking = false;
    drawer.style.willChange = '';
    drawer.style.transition = 'transform 170ms ease';

    if (offsetY > 88) {
      closeDrawerWithFallback(drawer);
      reset();
      return;
    }

    drawer.style.transform = 'translateY(0px)';
    window.setTimeout(() => {
      if (!drawer.classList.contains('open')) return;
      drawer.style.transform = '';
      drawer.style.transition = '';
    }, 180);
  };

  drawer.addEventListener('touchend', endSwipe);
  drawer.addEventListener('touchcancel', endSwipe);
  mobileQuery.addEventListener('change', reset);
}

function initDrawerSwipeClose() {
  const drawers = document.querySelectorAll('.drawer');
  drawers.forEach((drawer) => {
    bindDrawerSwipeClose(drawer);
  });
}

function ensureGlobalProgressNode() {
  let node = document.getElementById('global-progress');
  if (node) return node;

  node = document.createElement('div');
  node.id = 'global-progress';
  node.className = 'global-progress hidden';
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = '<span class="global-progress-bar"></span>';
  document.body.appendChild(node);
  return node;
}

function setGlobalProgressVisible(visible) {
  const node = ensureGlobalProgressNode();
  node.classList.toggle('hidden', !visible);
}

function initGlobalFetchProgress() {
  if (globalFetchPatched || typeof window.fetch !== 'function') return;
  globalFetchPatched = true;
  const nativeFetch = window.fetch.bind(window);
  nativeFetchRef = nativeFetch;

  const onStart = () => {
    globalFetchInflight += 1;
    if (globalFetchInflight !== 1) return;
    if (globalFetchHideTimer) {
      window.clearTimeout(globalFetchHideTimer);
      globalFetchHideTimer = null;
    }
    globalFetchShowTimer = window.setTimeout(() => {
      if (globalFetchInflight > 0) {
        setGlobalProgressVisible(true);
      }
      globalFetchShowTimer = null;
    }, 120);
  };

  const onFinish = () => {
    globalFetchInflight = Math.max(0, globalFetchInflight - 1);
    if (globalFetchInflight > 0) return;
    if (globalFetchShowTimer) {
      window.clearTimeout(globalFetchShowTimer);
      globalFetchShowTimer = null;
    }
    globalFetchHideTimer = window.setTimeout(() => {
      setGlobalProgressVisible(false);
      globalFetchHideTimer = null;
    }, 160);
  };

  window.fetch = (...args) => {
    onStart();
    return nativeFetch(...args).finally(onFinish);
  };
}

function ensureNetworkBadgeNode() {
  let badge = document.getElementById('global-network-status');
  if (badge) return badge;

  badge = document.createElement('div');
  badge.id = 'global-network-status';
  badge.className = 'global-network-status hidden';
  badge.setAttribute('aria-live', 'polite');
  badge.setAttribute('aria-atomic', 'true');
  badge.innerHTML = `
    <span class="global-network-status-dot" aria-hidden="true"></span>
    <span class="global-network-status-text">Offline</span>
  `;
  document.body.appendChild(badge);
  return badge;
}

function updateNetworkBadgeState(state) {
  const badge = ensureNetworkBadgeNode();
  const text = badge.querySelector('.global-network-status-text');
  badge.classList.remove('online', 'offline', 'queue');

  if (state === 'offline') {
    if (networkBadgeHideTimer) {
      window.clearTimeout(networkBadgeHideTimer);
      networkBadgeHideTimer = null;
    }
    badge.classList.add('offline');
    badge.classList.remove('hidden');
    if (text) text.textContent = 'Offline mode';
    return;
  }

  if (state === 'online') {
    badge.classList.add('online');
    badge.classList.remove('hidden');
    if (text) text.textContent = 'Online lagi';
    if (networkBadgeHideTimer) window.clearTimeout(networkBadgeHideTimer);
    networkBadgeHideTimer = window.setTimeout(() => {
      badge.classList.add('hidden');
      badge.classList.remove('online');
      networkBadgeHideTimer = null;
    }, 1600);
    return;
  }

  if (state === 'queue') {
    if (networkBadgeHideTimer) {
      window.clearTimeout(networkBadgeHideTimer);
      networkBadgeHideTimer = null;
    }
    badge.classList.add('queue');
    badge.classList.remove('hidden');
    if (text) {
      text.textContent = `${offlineQueueSize} antrean menunggu sinkron`;
    }
    return;
  }

  badge.classList.add('hidden');
}

function initNetworkStatusBadge() {
  if (networkBadgeInit || !document.body.classList.contains('panel-page')) return;
  networkBadgeInit = true;
  ensureNetworkBadgeNode();

  updateNetworkBadgeState(window.navigator.onLine ? 'hidden' : 'offline');
  window.addEventListener('offline', () => updateNetworkBadgeState('offline'));
  window.addEventListener('online', () => {
    if (offlineQueueSize > 0) {
      updateNetworkBadgeState('queue');
    } else {
      updateNetworkBadgeState('online');
    }
  });
  window.addEventListener('offline-queue:changed', (event) => {
    const size = Number(event?.detail?.size) || 0;
    offlineQueueSize = size;
    if (!window.navigator.onLine) return;
    if (size > 0) {
      updateNetworkBadgeState('queue');
    } else {
      updateNetworkBadgeState('online');
    }
  });
  window.addEventListener('offline-queue:synced', () => {
    offlineQueueSize = 0;
    if (window.navigator.onLine) {
      updateNetworkBadgeState('online');
    }
  });
}

function bindQuickSheetSwipeClose(sheet, closeSheet) {
  if (!(sheet instanceof HTMLElement) || typeof closeSheet !== 'function') return;
  if (sheet.dataset.swipeCloseBound === 'true') return;
  sheet.dataset.swipeCloseBound = 'true';

  const mobileQuery = window.matchMedia('(max-width: 1023px)');
  const swipe = {
    tracking: false,
    startY: 0,
    startX: 0,
    offsetY: 0
  };

  const reset = () => {
    swipe.tracking = false;
    swipe.offsetY = 0;
    sheet.style.transform = '';
    sheet.style.transition = '';
    sheet.style.willChange = '';
  };

  sheet.addEventListener(
    'touchstart',
    (event) => {
      if (!mobileQuery.matches || sheet.classList.contains('hidden')) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const swipeHandle = event.target.closest('.sheet-grab, .quick-sheet-head');
      if (!swipeHandle || !sheet.contains(swipeHandle)) return;

      swipe.tracking = true;
      swipe.startY = touch.clientY;
      swipe.startX = touch.clientX;
      swipe.offsetY = 0;
      sheet.style.transition = 'none';
      sheet.style.willChange = 'transform';
    },
    { passive: true }
  );

  sheet.addEventListener(
    'touchmove',
    (event) => {
      if (!swipe.tracking) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const deltaY = touch.clientY - swipe.startY;
      const deltaX = touch.clientX - swipe.startX;
      if (deltaY <= 0 || Math.abs(deltaY) < Math.abs(deltaX)) return;

      event.preventDefault();
      swipe.offsetY = Math.min(deltaY, 280);
      sheet.style.transform = `translateY(${swipe.offsetY}px)`;
    },
    { passive: false }
  );

  const endSwipe = () => {
    if (!swipe.tracking) return;
    const offsetY = swipe.offsetY;
    swipe.tracking = false;
    sheet.style.willChange = '';
    sheet.style.transition = 'transform 170ms ease';

    if (offsetY > 88) {
      closeSheet();
      reset();
      return;
    }

    sheet.style.transform = 'translateY(0px)';
    window.setTimeout(() => {
      if (sheet.classList.contains('hidden')) return;
      sheet.style.transform = '';
      sheet.style.transition = '';
    }, 180);
  };

  sheet.addEventListener('touchend', endSwipe);
  sheet.addEventListener('touchcancel', endSwipe);
  mobileQuery.addEventListener('change', reset);
}

function initMobileBottomNav(activePage) {
  if (!document.body.classList.contains('panel-page')) return;

  let nav = document.getElementById('mobile-bottom-nav');
  if (!nav) {
    nav = document.createElement('nav');
    nav.id = 'mobile-bottom-nav';
    nav.className = 'mobile-bottom-nav';
    nav.setAttribute('aria-label', 'Navigasi cepat');
    document.body.appendChild(nav);
  }

  const items = [
    {
      page: 'dashboard',
      href: '/dashboard',
      label: 'Home',
      icon: `
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="M3 11l9-8 9 8M5 10.8V21h14V10.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      `
    },
    {
      page: 'products',
      href: '/products',
      label: 'Produk',
      icon: `
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      `
    },
    {
      page: 'transactions',
      href: '/transactions',
      label: 'Transaksi',
      icon: `
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="M4 6h13M4 12h9M4 18h11M18 16l3 3-3 3M21 19h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      `
    }
  ];

  const links = items
    .map((item) => {
      const active = item.page === activePage;
      return `
        <a
          class="mobile-bottom-link${active ? ' active' : ''}"
          href="${item.href}"
          data-page="${item.page}"
          ${active ? 'aria-current="page"' : ''}
        >
          <span class="mobile-bottom-icon">${item.icon}</span>
          <span class="mobile-bottom-text">${item.label}</span>
        </a>
      `;
    })
    .join('');

  nav.innerHTML = `
    ${links}
    <button
      class="mobile-bottom-link mobile-bottom-menu"
      type="button"
      data-action="open-menu"
      aria-label="Buka menu lainnya"
      title="Menu lainnya"
    >
      <span class="mobile-bottom-icon">
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </span>
      <span class="mobile-bottom-text">Menu</span>
    </button>
  `;

  const menuBtn = nav.querySelector('[data-action="open-menu"]');
  if (menuBtn && menuBtn.dataset.bound !== 'true') {
    menuBtn.dataset.bound = 'true';
    menuBtn.addEventListener('click', () => {
      const menuToggle = document.getElementById('menu-toggle');
      if (menuToggle instanceof HTMLElement) {
        menuToggle.click();
        return;
      }
      const drawer = document.getElementById('mobile-drawer');
      const backdrop = document.getElementById('mobile-backdrop');
      if (!drawer || !backdrop) return;
      drawer.classList.add('open');
      backdrop.classList.remove('hidden');
      document.body.classList.add('mobile-nav-open');
    });
  }
}

function initGlobalQuickActions(activePage) {
  if (!document.body.classList.contains('panel-page')) return;
  if (document.querySelector('.fab-toggle')) return;

  let fab = document.getElementById('global-quick-fab');
  let backdrop = document.getElementById('quick-sheet-backdrop');
  let sheet = document.getElementById('quick-sheet');
  const hasNodes = fab && backdrop && sheet;

  if (!hasNodes) {
    fab = document.createElement('button');
    fab.id = 'global-quick-fab';
    fab.className = 'global-quick-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Aksi cepat');
    fab.setAttribute('title', 'Aksi cepat');
    fab.innerHTML = `
      <span class="global-quick-fab-icon" aria-hidden="true">+</span>
      <span class="sr-only">Aksi cepat</span>
    `;

    backdrop = document.createElement('div');
    backdrop.id = 'quick-sheet-backdrop';
    backdrop.className = 'quick-sheet-backdrop hidden';

    sheet = document.createElement('aside');
    sheet.id = 'quick-sheet';
    sheet.className = 'quick-sheet hidden';
    sheet.setAttribute('aria-label', 'Aksi cepat');
    sheet.innerHTML = `
      <div class="sheet-grab" aria-hidden="true"></div>
      <div class="quick-sheet-head">
        <div>
          <p class="eyebrow">Aksi cepat</p>
          <h3>Pilih modul</h3>
        </div>
      </div>
      <div class="quick-sheet-list" id="quick-sheet-list"></div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
    document.body.appendChild(fab);
  }

  const quickList = sheet.querySelector('#quick-sheet-list');
  if (quickList) {
    const actions = [
      {
        href: '/products',
        label: 'Tambah barang',
        icon: `
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        `
      },
      {
        href: '/transactions',
        label: 'Input transaksi',
        icon: `
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M4 6h13M4 12h9M4 18h11M18 16l3 3-3 3M21 19h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        `
      },
      {
        href: '/receipts',
        label: 'Cetak struk',
        icon: `
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M7 7V3h10v4M5 9h14v9H5V9Zm2 6h10M7 12h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        `
      },
      {
        href: '/payables',
        label: 'Bayar modal',
        icon: `
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M3 7h18v10H3V7Zm3 3h6m-6 4h8m6-4h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        `
      }
    ];

    quickList.innerHTML = actions
      .map((action) => {
        const active = activePage && action.href === `/${activePage}`;
        return `
          <a
            class="quick-sheet-item${active ? ' active' : ''}"
            href="${action.href}"
            data-close-sheet="true"
          >
            <span class="quick-sheet-item-icon">${action.icon}</span>
            <span class="quick-sheet-item-text">${action.label}</span>
          </a>
        `;
      })
      .join('');
  }

  const closeSheet = () => {
    sheet.classList.add('hidden');
    backdrop.classList.add('hidden');
    fab.classList.remove('open');
    document.body.classList.remove('quick-sheet-open');
    sheet.style.transform = '';
    sheet.style.transition = '';
    sheet.style.willChange = '';
  };

  const openSheet = () => {
    sheet.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    fab.classList.add('open');
    document.body.classList.add('quick-sheet-open');
  };

  if (fab.dataset.bound !== 'true') {
    fab.dataset.bound = 'true';
    fab.addEventListener('click', () => {
      if (sheet.classList.contains('hidden')) {
        openSheet();
      } else {
        closeSheet();
      }
    });
  }

  if (backdrop.dataset.bound !== 'true') {
    backdrop.dataset.bound = 'true';
    backdrop.addEventListener('click', closeSheet);
  }

  if (sheet.dataset.bound !== 'true') {
    sheet.dataset.bound = 'true';
    sheet.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-close-sheet]');
      if (!trigger) return;
      closeSheet();
    });
  }

  bindQuickSheetSwipeClose(sheet, closeSheet);

  if (!quickSheetEscBound) {
    quickSheetEscBound = true;
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const quickSheet = document.getElementById('quick-sheet');
      const quickBackdrop = document.getElementById('quick-sheet-backdrop');
      const quickFab = document.getElementById('global-quick-fab');
      if (!quickSheet || quickSheet.classList.contains('hidden')) return;
      quickSheet.classList.add('hidden');
      quickBackdrop?.classList.add('hidden');
      quickFab?.classList.remove('open');
      document.body.classList.remove('quick-sheet-open');
    });
  }
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

function normalizeApiUrl(url) {
  try {
    const parsed = new URL(String(url || ''), window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch (err) {
    return null;
  }
}

function normalizeHeaders(headers) {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    const out = {};
    headers.forEach(([key, value]) => {
      if (!key) return;
      out[String(key).toLowerCase()] = String(value);
    });
    return out;
  }
  if (typeof headers === 'object') {
    const out = {};
    Object.entries(headers).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      out[String(key).toLowerCase()] = String(value);
    });
    return out;
  }
  return {};
}

function shouldQueueOfflineRequest(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;

  const normalizedUrl = normalizeApiUrl(url);
  if (!normalizedUrl || !normalizedUrl.startsWith('/api/')) return false;

  const excluded = [
    '/api/login',
    '/api/logout',
    '/api/health',
    '/api/store/active',
    '/api/public/'
  ];
  return !excluded.some((prefix) => normalizedUrl.startsWith(prefix));
}

function readOfflineQueue() {
  try {
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function writeOfflineQueue(queue) {
  try {
    window.localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    // Ignore storage errors.
  }
}

function dispatchOfflineQueueChanged(size) {
  offlineQueueSize = Number.isFinite(size) ? size : 0;
  window.dispatchEvent(
    new CustomEvent('offline-queue:changed', {
      detail: { size: offlineQueueSize }
    })
  );
}

function enqueueOfflineRequest(url, options = {}) {
  const normalizedUrl = normalizeApiUrl(url);
  if (!normalizedUrl) return false;

  const method = String(options.method || 'GET').toUpperCase();
  const body =
    typeof options.body === 'string' ? options.body : options.body ? String(options.body) : null;

  const queue = readOfflineQueue();
  queue.push({
    id: `oq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    url: normalizedUrl,
    method,
    headers: normalizeHeaders(options.headers),
    body,
    queued_at: new Date().toISOString()
  });
  writeOfflineQueue(queue);
  dispatchOfflineQueueChanged(queue.length);

  const now = Date.now();
  if (now - offlineQueueToastAt > 1400) {
    offlineQueueToastAt = now;
    showToast('Offline: aksi disimpan ke antrean sinkron.');
  }
  return true;
}

async function processOfflineQueue() {
  if (offlineQueueProcessing || !window.navigator.onLine) return;
  offlineQueueProcessing = true;

  let queue = readOfflineQueue();
  if (!queue.length) {
    dispatchOfflineQueueChanged(0);
    offlineQueueProcessing = false;
    return;
  }

  const fetcher = nativeFetchRef || window.fetch.bind(window);
  let syncedCount = 0;
  let droppedCount = 0;

  while (queue.length && window.navigator.onLine) {
    const item = queue[0];
    try {
      const response = await fetcher(item.url, {
        method: item.method || 'POST',
        headers: item.headers || {},
        body: item.body
      });

      if (response.status === 401) {
        window.location.href = '/login';
        break;
      }

      // 4xx (kecuali 429) dianggap tidak bisa diperbaiki dengan retry.
      if (!response.ok && response.status >= 400 && response.status < 500 && response.status !== 429) {
        droppedCount += 1;
        queue.shift();
        writeOfflineQueue(queue);
        dispatchOfflineQueueChanged(queue.length);
        continue;
      }

      if (!response.ok) {
        break;
      }

      syncedCount += 1;
      queue.shift();
      writeOfflineQueue(queue);
      dispatchOfflineQueueChanged(queue.length);
    } catch (err) {
      break;
    }
  }

  if (syncedCount > 0) {
    showToast(`${syncedCount} antrean offline berhasil sinkron.`);
    window.dispatchEvent(
      new CustomEvent('offline-queue:synced', { detail: { count: syncedCount } })
    );
  }

  if (droppedCount > 0) {
    showToast(`${droppedCount} antrean dilewati karena data tidak valid.`, true);
  }

  offlineQueueProcessing = false;
}

function initOfflineQueueSync() {
  if (offlineQueueInit) return;
  offlineQueueInit = true;

  offlineQueueSize = readOfflineQueue().length;
  dispatchOfflineQueueChanged(offlineQueueSize);
  window.addEventListener('online', () => {
    processOfflineQueue();
  });
  window.addEventListener('focus', () => {
    if (window.navigator.onLine) processOfflineQueue();
  });
  if (window.navigator.onLine) {
    processOfflineQueue();
  }
}

function commandBaseActions(activePage) {
  const actions = [
    {
      id: 'go-dashboard',
      label: 'Dashboard',
      hint: 'Ringkasan harian',
      href: '/dashboard',
      icon: 'home'
    },
    {
      id: 'go-products',
      label: 'Produk',
      hint: 'Kelola barang',
      href: '/products',
      icon: 'box'
    },
    {
      id: 'go-transactions',
      label: 'Transaksi',
      hint: 'Input barang masuk/keluar',
      href: '/transactions',
      icon: 'tx'
    },
    {
      id: 'go-receipts',
      label: 'Struk',
      hint: 'Kasir dan cetak struk',
      href: '/receipts',
      icon: 'receipt'
    },
    {
      id: 'go-payables',
      label: 'Modal',
      hint: 'Bayar modal dan cek saldo',
      href: '/payables',
      icon: 'wallet'
    },
    {
      id: 'new-product',
      label: 'Tambah barang',
      hint: 'Buka form tambah barang',
      href: '/products?quick=create',
      icon: 'plus'
    },
    {
      id: 'new-transaction',
      label: 'Input transaksi',
      hint: 'Buka form transaksi baru',
      href: '/transactions?quick=create',
      icon: 'plus'
    },
    {
      id: 'new-payment',
      label: 'Bayar modal',
      hint: 'Buka form pembayaran',
      href: '/payables?quick=payment',
      icon: 'plus'
    }
  ];

  return actions.map((item) => ({
    ...item,
    active: item.href === `/${activePage}`
  }));
}

function readCommandHistory() {
  try {
    const raw = window.localStorage.getItem(COMMAND_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function writeCommandHistory(items) {
  try {
    window.localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(items));
  } catch (err) {
    // Ignore storage errors.
  }
}

function pushCommandHistory(item) {
  const href = String(item?.href || '').trim();
  if (!href) return;
  const cleanHint = String(item?.hint || '')
    .replace(/^terakhir\s*•\s*/i, '')
    .trim();
  const entry = {
    id: String(item.id || href),
    label: String(item.label || 'Aksi'),
    hint: cleanHint,
    href,
    icon: String(item.icon || 'plus'),
    at: Date.now()
  };
  const current = readCommandHistory();
  const deduped = [entry, ...current.filter((row) => String(row?.href || '') !== href)];
  writeCommandHistory(deduped.slice(0, COMMAND_HISTORY_LIMIT));
}

function getCommandDefaultItems(activePage) {
  const actions = commandBaseActions(activePage);
  const history = readCommandHistory().map((item) => ({
    ...item,
    id: `recent-${item.id || item.href}`,
    hint: item.hint ? `Terakhir • ${item.hint}` : 'Terakhir dibuka'
  }));
  const seenHrefs = new Set(history.map((item) => item.href));
  const restActions = actions.filter((item) => !seenHrefs.has(item.href));
  return [...history, ...restActions];
}

function commandIcon(iconName) {
  if (iconName === 'home') {
    return `
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M3 11l9-8 9 8M5 10.8V21h14V10.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
  }
  if (iconName === 'box') {
    return `
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
  }
  if (iconName === 'tx') {
    return `
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M4 6h13M4 12h9M4 18h11M18 16l3 3-3 3M21 19h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
  }
  if (iconName === 'receipt') {
    return `
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M7 7V3h10v4M5 9h14v9H5V9Zm2 6h10M7 12h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
  }
  if (iconName === 'wallet') {
    return `
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M3 7h18v10H3V7Zm3 3h6m-6 4h8m6-4h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function ensureCommandButton() {
  const topbarActions = document.querySelector('.topbar-actions');
  if (!topbarActions) return null;

  let button = document.getElementById('global-command-btn');
  if (button) return button;

  button = document.createElement('button');
  button.id = 'global-command-btn';
  button.type = 'button';
  button.className = 'ghost action-icon-btn global-command-btn';
  button.setAttribute('aria-label', 'Cari & perintah');
  button.setAttribute('title', 'Cari & perintah');
  button.innerHTML = `
    <span class="action-icon-symbol" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M21 21l-4.35-4.35M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    </span>
    <span class="action-icon-text">Cari</span>
  `;
  topbarActions.insertBefore(button, topbarActions.firstChild);
  return button;
}

function ensureCommandPaletteNodes() {
  let backdrop = document.getElementById('command-backdrop');
  let palette = document.getElementById('command-palette');

  if (backdrop && palette) {
    return { backdrop, palette };
  }

  backdrop = document.createElement('div');
  backdrop.id = 'command-backdrop';
  backdrop.className = 'command-backdrop hidden';

  palette = document.createElement('section');
  palette.id = 'command-palette';
  palette.className = 'command-palette hidden';
  palette.setAttribute('aria-hidden', 'true');
  palette.setAttribute('aria-label', 'Cari dan perintah');
  palette.innerHTML = `
    <div class="command-head">
      <span class="command-head-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M21 21l-4.35-4.35M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </span>
      <input
        id="command-input"
        class="command-input"
        type="search"
        autocomplete="off"
        placeholder="Cari halaman, produk, transaksi, aksi..."
        aria-label="Cari perintah"
      />
      <button class="command-close" id="command-close" type="button" aria-label="Tutup">
        &times;
      </button>
    </div>
    <div class="command-meta">
      <span>Shortcut: Ctrl + K</span>
      <span>Swipe bawah untuk tutup sheet</span>
    </div>
    <div class="command-list" id="command-list"></div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(palette);
  return { backdrop, palette };
}

function renderCommandList(items) {
  const list = document.getElementById('command-list');
  if (!list) return;
  if (!items?.length) {
    list.innerHTML = '<div class="command-empty">Tidak ada hasil.</div>';
    return;
  }

  list.innerHTML = items
    .slice(0, COMMAND_ACTIONS_LIMIT)
    .map((item, index) => {
      const hrefAttr = item.href ? `href="${item.href}"` : '';
      const activeClass = item.active ? ' active' : '';
      return `
        <a
          class="command-item${activeClass}"
          ${hrefAttr}
          data-command-id="${escapeHtml(item.id || String(index))}"
          data-command-label="${escapeHtml(item.label || '-')}"
          data-command-hint="${escapeHtml(item.hint || '')}"
          data-command-icon="${escapeHtml(item.icon || 'plus')}"
          data-command-href="${escapeHtml(item.href || '')}"
        >
          <span class="command-item-icon">${commandIcon(item.icon)}</span>
          <span class="command-item-text">
            <strong>${escapeHtml(item.label || '-')}</strong>
            <small>${escapeHtml(item.hint || '')}</small>
          </span>
        </a>
      `;
    })
    .join('');
}

async function searchCommandItems(query, activePage, seq) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const actions = getCommandDefaultItems(activePage);
  const matchedActions = normalizedQuery
    ? actions.filter((item) => {
        const label = `${item.label} ${item.hint}`.toLowerCase();
        return label.includes(normalizedQuery);
      })
    : actions.slice(0, COMMAND_ACTIONS_LIMIT);

  let productMatches = [];
  let transactionMatches = [];
  if (normalizedQuery.length >= 2) {
    const storeId = getActiveStoreId();
    const productsParams = new URLSearchParams();
    productsParams.set('search', normalizedQuery);
    productsParams.set('limit', String(COMMAND_PRODUCTS_LIMIT));
    if (storeId) productsParams.set('storeId', String(storeId));

    const transactionParams = new URLSearchParams();
    transactionParams.set('search', normalizedQuery);
    transactionParams.set('limit', String(COMMAND_TRANSACTIONS_LIMIT));
    if (storeId) transactionParams.set('storeId', String(storeId));

    try {
      if (commandSearchAbort) commandSearchAbort.abort();
      commandSearchAbort = new AbortController();
      const signal = commandSearchAbort.signal;
      const fetcher = nativeFetchRef || window.fetch.bind(window);
      const [productsRes, transactionsRes] = await Promise.all([
        fetcher(`/api/products?${productsParams.toString()}`, { signal }),
        fetcher(`/api/transactions?${transactionParams.toString()}`, { signal })
      ]);

      const productsData = productsRes.ok
        ? await productsRes.json().catch(() => ({ data: [] }))
        : { data: [] };
      const transactionsData = transactionsRes.ok
        ? await transactionsRes.json().catch(() => ({ data: [] }))
        : { data: [] };

      if (seq !== commandSearchSeq) return;

      productMatches = (productsData?.data || [])
        .slice(0, COMMAND_PRODUCTS_LIMIT)
        .map((product) => ({
          id: `product-${product.id}`,
          label: String(product.name || 'Produk'),
          hint: `Stok ${formatNumber(product.stock)} | ${product.category || 'Tanpa kategori'}`,
          href: `/products?productId=${product.id}`,
          icon: 'box'
        }));

      transactionMatches = (transactionsData?.data || [])
        .slice(0, COMMAND_TRANSACTIONS_LIMIT)
        .map((tx) => ({
          id: `tx-${tx.id}`,
          label: String(tx.item || 'Transaksi'),
          hint: `${tx.type || '-'} | ${formatCurrency(tx.total)} | ${new Date(tx.created_at).toLocaleDateString('id-ID')}`,
          href: `/transactions?search=${encodeURIComponent(tx.item || '')}`,
          icon: 'tx'
        }));
    } catch (err) {
      if (err?.name !== 'AbortError') {
        // Ignore network errors in palette search.
      }
    }
  }

  if (seq !== commandSearchSeq) return;
  renderCommandList([
    ...matchedActions,
    ...productMatches,
    ...transactionMatches
  ]);
}

function initGlobalCommandPalette(activePage) {
  if (!document.body.classList.contains('panel-page')) return;
  if (commandPaletteInit) return;
  commandPaletteInit = true;

  const button = ensureCommandButton();
  if (!button) return;

  const { backdrop, palette } = ensureCommandPaletteNodes();
  const input = palette.querySelector('#command-input');
  const closeBtn = palette.querySelector('#command-close');
  const isOpen = () => !palette.classList.contains('hidden');
  const rememberItem = (itemEl) => {
    if (!(itemEl instanceof HTMLElement)) return;
    const href = String(itemEl.dataset.commandHref || itemEl.getAttribute('href') || '').trim();
    if (!href) return;
    pushCommandHistory({
      id: itemEl.dataset.commandId || href,
      label: itemEl.dataset.commandLabel || itemEl.textContent || 'Aksi',
      hint: itemEl.dataset.commandHint || '',
      href,
      icon: itemEl.dataset.commandIcon || 'plus'
    });
  };

  const close = () => {
    palette.classList.add('hidden');
    backdrop.classList.add('hidden');
    palette.setAttribute('aria-hidden', 'true');
    palette.style.transform = '';
    palette.style.transition = '';
    palette.style.willChange = '';
    document.body.classList.remove('command-open');
    if (commandSearchTimer) {
      window.clearTimeout(commandSearchTimer);
      commandSearchTimer = null;
    }
    if (commandSearchAbort) {
      commandSearchAbort.abort();
      commandSearchAbort = null;
    }
  };

  const open = () => {
    palette.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    palette.setAttribute('aria-hidden', 'false');
    document.body.classList.add('command-open');
    renderCommandList(getCommandDefaultItems(activePage));
    window.setTimeout(() => {
      if (input instanceof HTMLInputElement) input.focus();
    }, 30);
  };

  button.addEventListener('click', () => {
    if (isOpen()) {
      close();
    } else {
      open();
    }
  });

  if (closeBtn instanceof HTMLElement) {
    closeBtn.addEventListener('click', close);
  }
  backdrop.addEventListener('click', close);

  palette.addEventListener('click', (event) => {
    const link = event.target.closest('.command-item[href]');
    if (!link) return;
    rememberItem(link);
    close();
  });

  if (palette.dataset.swipeBound !== 'true') {
    palette.dataset.swipeBound = 'true';
    const mobileQuery = window.matchMedia('(max-width: 1023px)');
    const swipe = {
      tracking: false,
      startY: 0,
      startX: 0,
      offsetY: 0
    };

    palette.addEventListener(
      'touchstart',
      (event) => {
        if (!mobileQuery.matches || !isOpen()) return;
        const touch = event.touches?.[0];
        if (!touch) return;
        const handle = event.target.closest('.command-head');
        if (!handle) return;
        swipe.tracking = true;
        swipe.startY = touch.clientY;
        swipe.startX = touch.clientX;
        swipe.offsetY = 0;
        palette.style.transition = 'none';
        palette.style.willChange = 'transform';
      },
      { passive: true }
    );

    palette.addEventListener(
      'touchmove',
      (event) => {
        if (!swipe.tracking) return;
        const touch = event.touches?.[0];
        if (!touch) return;
        const deltaY = touch.clientY - swipe.startY;
        const deltaX = touch.clientX - swipe.startX;
        if (deltaY <= 0 || Math.abs(deltaY) < Math.abs(deltaX)) return;
        event.preventDefault();
        swipe.offsetY = Math.min(deltaY, 250);
        palette.style.transform = `translateY(${swipe.offsetY}px)`;
      },
      { passive: false }
    );

    const endSwipe = () => {
      if (!swipe.tracking) return;
      const offsetY = swipe.offsetY;
      swipe.tracking = false;
      swipe.offsetY = 0;
      palette.style.willChange = '';
      palette.style.transition = 'transform 170ms ease';

      if (offsetY > 84) {
        close();
        palette.style.transform = '';
        palette.style.transition = '';
        return;
      }

      palette.style.transform = 'translateY(0px)';
      window.setTimeout(() => {
        if (!isOpen()) return;
        palette.style.transform = '';
        palette.style.transition = '';
      }, 180);
    };

    palette.addEventListener('touchend', endSwipe);
    palette.addEventListener('touchcancel', endSwipe);
  }

  if (input instanceof HTMLInputElement) {
    input.addEventListener('input', (event) => {
      const query = String(event.target.value || '').trim();
      if (commandSearchTimer) window.clearTimeout(commandSearchTimer);
      commandSearchTimer = window.setTimeout(() => {
        commandSearchSeq += 1;
        searchCommandItems(query, activePage, commandSearchSeq);
      }, 120);
    });
  }

  if (!commandEscBound) {
    commandEscBound = true;
    document.addEventListener('keydown', (event) => {
      const hotkey =
        (event.ctrlKey || event.metaKey) &&
        String(event.key || '').toLowerCase() === 'k';
      if (hotkey) {
        event.preventDefault();
        if (isOpen()) close();
        else open();
        return;
      }

      if (event.key === 'Escape' && isOpen()) {
        event.preventDefault();
        close();
      }
    });
  }
}

export function initPullToRefresh({
  key,
  onRefresh,
  minDistance = 88,
  maxDistance = 132
} = {}) {
  if (typeof onRefresh !== 'function') return;
  const bindKey = String(key || window.location.pathname || 'default');
  if (pullRefreshBoundKeys.has(bindKey)) return;
  pullRefreshBoundKeys.add(bindKey);

  const mobileQuery = window.matchMedia('(max-width: 1023px)');
  const canUseTouch = 'ontouchstart' in window;
  if (!canUseTouch) return;

  let indicator = document.getElementById('pull-refresh-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'pull-refresh-indicator';
    indicator.className = 'pull-refresh-indicator hidden';
    indicator.innerHTML = `
      <div class="pull-refresh-pill">
        <span class="pull-refresh-spinner" aria-hidden="true"></span>
        <span class="pull-refresh-text">Tarik untuk refresh</span>
      </div>
    `;
    document.body.appendChild(indicator);
  }
  const text = indicator.querySelector('.pull-refresh-text');

  const state = {
    tracking: false,
    armed: false,
    refreshing: false,
    startY: 0,
    startX: 0,
    offset: 0
  };

  const setIndicator = (offset, message, loading = false) => {
    indicator.classList.remove('hidden');
    indicator.classList.toggle('loading', loading);
    indicator.style.setProperty('--pull-offset', `${Math.max(0, Math.min(offset, maxDistance))}px`);
    if (text) text.textContent = message;
  };

  const resetIndicator = () => {
    indicator.classList.add('hidden');
    indicator.classList.remove('loading');
    indicator.style.removeProperty('--pull-offset');
  };

  const onTouchStart = (event) => {
    if (!mobileQuery.matches) return;
    if (state.refreshing) return;
    if (document.body.classList.contains('mobile-nav-open')) return;
    if (document.body.classList.contains('quick-sheet-open')) return;
    if (document.body.classList.contains('command-open')) return;

    const scrollingElement = document.scrollingElement || document.documentElement;
    if (!scrollingElement || scrollingElement.scrollTop > 2) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    state.tracking = true;
    state.armed = false;
    state.startY = touch.clientY;
    state.startX = touch.clientX;
    state.offset = 0;
  };

  const onTouchMove = (event) => {
    if (!state.tracking || state.refreshing) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    const deltaY = touch.clientY - state.startY;
    const deltaX = touch.clientX - state.startX;

    if (deltaY <= 0 || Math.abs(deltaY) < Math.abs(deltaX)) return;
    event.preventDefault();

    state.offset = Math.min(deltaY, maxDistance);
    state.armed = state.offset >= minDistance;
    setIndicator(
      state.offset,
      state.armed ? 'Lepas untuk refresh' : 'Tarik untuk refresh',
      false
    );
  };

  const endTracking = async () => {
    if (!state.tracking) return;
    state.tracking = false;

    if (!state.armed || state.refreshing) {
      state.armed = false;
      state.offset = 0;
      resetIndicator();
      return;
    }

    state.refreshing = true;
    setIndicator(maxDistance, 'Memuat data terbaru...', true);
    try {
      await Promise.resolve(onRefresh());
      if (text) text.textContent = 'Data diperbarui';
      window.setTimeout(resetIndicator, 420);
    } catch (err) {
      if (text) text.textContent = 'Gagal refresh';
      indicator.classList.add('error');
      window.setTimeout(() => {
        indicator.classList.remove('error');
        resetIndicator();
      }, 520);
    } finally {
      state.refreshing = false;
      state.armed = false;
      state.offset = 0;
    }
  };

  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', endTracking, { passive: true });
  window.addEventListener('touchcancel', endTracking, { passive: true });
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

function ensureUndoSnackNode() {
  let snack = document.getElementById('undo-snack');
  if (snack) return snack;
  snack = document.createElement('div');
  snack.id = 'undo-snack';
  snack.className = 'undo-snack hidden';
  snack.innerHTML = `
    <span class="undo-snack-text" id="undo-snack-text"></span>
    <span class="undo-snack-count hidden" id="undo-snack-count" aria-hidden="true"></span>
    <button class="undo-snack-btn" id="undo-snack-btn" type="button">Urungkan</button>
  `;
  document.body.appendChild(snack);
  return snack;
}

function clearUndoSnackTimer() {
  if (!undoSnackTimer) return;
  window.clearTimeout(undoSnackTimer);
  undoSnackTimer = null;
}

function hideUndoSnack() {
  const snack = document.getElementById('undo-snack');
  if (!snack) return;
  snack.classList.add('hidden');
  const button = snack.querySelector('#undo-snack-btn');
  if (button instanceof HTMLButtonElement) button.onclick = null;
}

function runUndoSnackCallback(callback) {
  if (typeof callback !== 'function') return;
  try {
    callback();
  } catch (err) {
    // Ignore callback errors.
  }
}

function renderUndoSnackCurrent() {
  const snack = ensureUndoSnackNode();
  if (!undoSnackCurrent) {
    hideUndoSnack();
    return;
  }

  const text = snack.querySelector('#undo-snack-text');
  const button = snack.querySelector('#undo-snack-btn');
  const count = snack.querySelector('#undo-snack-count');
  const pendingCount = undoSnackQueue.length;

  if (text) {
    text.textContent = String(undoSnackCurrent.message || 'Perubahan tersimpan.');
  }

  if (count instanceof HTMLElement) {
    count.classList.toggle('hidden', pendingCount < 1);
    count.textContent = pendingCount > 99 ? '+99' : `+${pendingCount}`;
  }

  if (button instanceof HTMLButtonElement) {
    button.textContent = String(undoSnackCurrent.actionLabel || 'Urungkan');
    button.onclick = () => {
      clearUndoSnackTimer();
      const active = undoSnackCurrent;
      undoSnackCurrent = null;
      runUndoSnackCallback(active?.onUndo);
      if (undoSnackQueue.length > 0) {
        undoSnackCurrent = undoSnackQueue.shift();
        renderUndoSnackCurrent();
      } else {
        hideUndoSnack();
      }
    };
  }

  snack.classList.remove('hidden');
  clearUndoSnackTimer();
  undoSnackTimer = window.setTimeout(() => {
    const active = undoSnackCurrent;
    undoSnackCurrent = null;
    runUndoSnackCallback(active?.onCommit);
    if (undoSnackQueue.length > 0) {
      undoSnackCurrent = undoSnackQueue.shift();
      renderUndoSnackCurrent();
    } else {
      hideUndoSnack();
    }
  }, Math.max(1200, Number(undoSnackCurrent.duration) || 3600));
}

export function showUndoSnack({
  message = 'Perubahan tersimpan.',
  actionLabel = 'Urungkan',
  duration = 3600,
  onUndo,
  onCommit
} = {}) {
  const entry = {
    message: String(message || 'Perubahan tersimpan.'),
    actionLabel: String(actionLabel || 'Urungkan'),
    duration: Math.max(1200, Number(duration) || 3600),
    onUndo: typeof onUndo === 'function' ? onUndo : null,
    onCommit: typeof onCommit === 'function' ? onCommit : null
  };

  if (undoSnackCurrent) {
    undoSnackQueue.unshift(undoSnackCurrent);
    if (undoSnackQueue.length > 20) {
      const dropped = undoSnackQueue.splice(20);
      dropped.forEach((item) => runUndoSnackCallback(item?.onCommit));
    }
  }
  undoSnackCurrent = entry;
  renderUndoSnackCurrent();
}

export function triggerSwipeFeedback(target, tone = 'success') {
  if (!(target instanceof HTMLElement)) return;
  const danger = tone === 'danger';
  target.classList.remove('swipe-feedback', 'swipe-feedback-danger');
  // Restart animation
  void target.offsetWidth;
  target.classList.add(danger ? 'swipe-feedback-danger' : 'swipe-feedback');
  window.setTimeout(() => {
    target.classList.remove('swipe-feedback', 'swipe-feedback-danger');
  }, 340);
}

export async function fetchJson(url, options) {
  const requestOptions = options || {};
  let res;
  try {
    res = await fetch(url, requestOptions);
  } catch (err) {
    const networkLikeError =
      err instanceof TypeError || !window.navigator.onLine;
    if (networkLikeError && shouldQueueOfflineRequest(url, requestOptions)) {
      const queued = enqueueOfflineRequest(url, requestOptions);
      if (queued) return null;
    }
    throw err;
  }

  if (res.status === 401) {
    window.location.href = '/login';
    return null;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = data?.error || 'request_failed';
    if (error === 'missing_store') {
      if (window.location.pathname !== '/select-store') {
        window.location.href = '/select-store';
      }
      return null;
    }
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
  initGlobalFetchProgress();
  initNetworkStatusBadge();
  initOfflineQueueSync();
  initMobileNav();
  initMobileBottomNav(activePage);
  initGlobalQuickActions(activePage);
  initGlobalCommandPalette(activePage);
  initAccountMenu();
  initDrawerSwipeClose();
  initCurrencyInputs();
  await initStoreSelector();
  initDrawerStoreSelector();
  fetchMe();
}
