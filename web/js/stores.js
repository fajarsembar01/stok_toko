import {
  escapeHtml,
  fetchJson,
  initPullToRefresh,
  initNav,
  refreshStoreSelector,
  showUndoSnack,
  showToast,
  triggerSwipeFeedback
} from './shared.js';

const storeRows = document.getElementById('store-rows');
const refreshBtn = document.getElementById('refresh-btn');
const createForm = document.getElementById('create-form');
const drawer = document.getElementById('drawer');
const drawerBackdrop = document.getElementById('drawer-backdrop');
const drawerTitle = document.getElementById('drawer-title');
const drawerSummary = document.getElementById('drawer-summary');
const closeDrawerBtn = document.getElementById('close-drawer');
const editForm = document.getElementById('edit-form');
const deactivateBtn = document.getElementById('deactivate-btn');
const storeMobileList = document.getElementById('store-mobile-list');

const state = {
  stores: [],
  selected: null
};

function openDrawer() {
  if (!drawer) return;
  drawer.classList.add('open');
  if (drawerBackdrop) drawerBackdrop.classList.remove('hidden');
}

function closeDrawer() {
  if (!drawer) return;
  drawer.classList.remove('open');
  if (drawerBackdrop) drawerBackdrop.classList.add('hidden');
}

function renderTable() {
  const rows = state.stores
    .map((store) => {
      const statusClass = store.is_active ? 'status-active' : 'status-inactive';
      const statusLabel = store.is_active ? 'Aktif' : 'Nonaktif';
      return `
        <tr data-id="${store.id}">
          <td>
            <div class="cell-title">${escapeHtml(store.name)}</div>
            <div class="cell-meta">ID ${store.id}</div>
          </td>
          <td>${escapeHtml(store.slug)}</td>
          <td>${escapeHtml(store.wa_trigger || '-')}</td>
          <td>${escapeHtml(store.category || '-')}</td>
          <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
          <td>
            <button
              class="ghost table-icon-btn"
              data-action="edit"
              aria-label="Edit toko"
              title="Edit toko"
            >
              <svg class="action-icon-symbol" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path
                  d="M4 20h4l10-10-4-4L4 16v4Zm11-13 2 2M14 6l2-2 4 4-2 2"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                ></path>
              </svg>
              <span class="sr-only">Edit</span>
            </button>
          </td>
        </tr>
      `;
    })
    .join('');

  storeRows.innerHTML = rows ||
    '<tr><td colspan="6">Belum ada toko.</td></tr>';
  renderStoreMobileList();
}

function renderStoreMobileList() {
  if (!storeMobileList) return;
  const cards = state.stores
    .map((store) => {
      const statusClass = store.is_active ? 'status-active' : 'status-inactive';
      const statusLabel = store.is_active ? 'Aktif' : 'Nonaktif';
      const triggerLabel = store.wa_trigger ? escapeHtml(store.wa_trigger) : '-';
      const categoryLabel = store.category ? escapeHtml(store.category) : '-';
      return `
        <article
          class="entity-mobile-card"
          data-id="${store.id}"
          tabindex="0"
          role="button"
          aria-label="Detail toko ${escapeHtml(store.name)}"
        >
          <div class="entity-mobile-head">
            <div>
              <strong>${escapeHtml(store.name)}</strong>
              <p>ID ${store.id} | ${escapeHtml(store.slug || '-')}</p>
            </div>
            <span class="status-pill ${statusClass}">${statusLabel}</span>
          </div>
          <div class="entity-mobile-grid">
            <div>
              <span>Trigger</span>
              <strong>${triggerLabel}</strong>
            </div>
            <div>
              <span>Kategori</span>
              <strong>${categoryLabel}</strong>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
  storeMobileList.innerHTML = cards || '<div class="audit-mobile-empty">Belum ada toko.</div>';
}

function openStoreDetailById(storeId) {
  const id = Number(storeId);
  if (!Number.isFinite(id) || id <= 0) return;
  const store = state.stores.find((item) => item.id === id);
  if (!store) return;
  state.selected = store;
  renderDrawer(store);
}

function getStoreMobileCard(storeId) {
  if (!storeMobileList) return null;
  return storeMobileList.querySelector(`.entity-mobile-card[data-id="${storeId}"]`);
}

function setStoreActiveLocal(storeId, isActive) {
  const id = Number(storeId);
  const store = state.stores.find((item) => item.id === id);
  if (!store) return false;
  store.is_active = Boolean(isActive);
  if (state.selected?.id === id) {
    state.selected = store;
    if (drawer?.classList.contains('open')) {
      renderDrawer(store);
    }
  }
  renderTable();
  return true;
}

function queueStoreActiveToggle(storeId, nextActive, fallbackTarget = null) {
  const id = Number(storeId);
  const store = state.stores.find((item) => item.id === id);
  if (!store) return;
  const previousActive = Boolean(store.is_active);
  const targetActive = Boolean(nextActive);
  if (previousActive === targetActive) return;

  setStoreActiveLocal(id, targetActive);
  const visual = getStoreMobileCard(id) || fallbackTarget;
  triggerSwipeFeedback(visual, targetActive ? 'success' : 'danger');

  showUndoSnack({
    message: targetActive ? 'Toko diaktifkan.' : 'Toko dinonaktifkan.',
    actionLabel: 'Urungkan',
    duration: 4300,
    onUndo: () => {
      setStoreActiveLocal(id, previousActive);
      const undoVisual = getStoreMobileCard(id) || fallbackTarget;
      triggerSwipeFeedback(undoVisual, 'success');
    },
    onCommit: () => {
      void (async () => {
        try {
          const res = await fetchJson(`/api/stores/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: targetActive })
          });
          if (!res) return;
        } catch (err) {
          setStoreActiveLocal(id, previousActive);
          showToast('Gagal ubah status toko.', true);
        }
      })();
    }
  });
}

function renderStoresSkeleton(count = 6) {
  storeRows.innerHTML = Array.from({ length: count })
    .map(() => {
      return `
        <tr class="audit-skeleton-row">
          <td><span class="audit-skeleton-line w-24"></span></td>
          <td><span class="audit-skeleton-line w-16"></span></td>
          <td><span class="audit-skeleton-line w-20"></span></td>
          <td><span class="audit-skeleton-line w-16"></span></td>
          <td><span class="audit-skeleton-line w-16"></span></td>
          <td><span class="audit-skeleton-line w-10"></span></td>
        </tr>
      `;
    })
    .join('');
  if (storeMobileList) {
    storeMobileList.innerHTML = Array.from({ length: Math.max(2, Math.ceil(count / 2)) })
      .map(
        () => `
          <article class="entity-mobile-card audit-skeleton-row">
            <span class="audit-skeleton-line w-28"></span>
            <span class="audit-skeleton-line w-20"></span>
            <span class="audit-skeleton-line w-24"></span>
          </article>
        `
      )
      .join('');
  }
}

function bindStoreMobileSwipeActions() {
  if (!storeMobileList || storeMobileList.dataset.swipeBound === 'true') return;
  storeMobileList.dataset.swipeBound = 'true';

  const swipe = {
    card: null,
    startX: 0,
    startY: 0,
    offsetX: 0,
    dragging: false,
    suppressClickUntil: 0
  };

  const resolveCard = (target) => {
    if (!(target instanceof Element)) return null;
    return target.closest('.entity-mobile-card[data-id]');
  };

  const releaseCard = () => {
    if (!swipe.card) return;
    const card = swipe.card;
    card.classList.remove('is-swiping');
    card.style.transition = 'transform 150ms ease';
    card.style.transform = 'translateX(0px)';
    window.setTimeout(() => {
      card.style.transition = '';
      card.style.transform = '';
    }, 170);
  };

  storeMobileList.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) return;
      const card = resolveCard(event.target);
      if (!card) return;
      swipe.card = card;
      swipe.startX = event.touches[0].clientX;
      swipe.startY = event.touches[0].clientY;
      swipe.offsetX = 0;
      swipe.dragging = false;
    },
    { passive: true }
  );

  storeMobileList.addEventListener(
    'touchmove',
    (event) => {
      if (!swipe.card || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - swipe.startX;
      const deltaY = touch.clientY - swipe.startY;

      if (!swipe.dragging) {
        if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
        if (Math.abs(deltaX) <= Math.abs(deltaY) + 6) {
          swipe.card = null;
          return;
        }
        swipe.dragging = true;
        swipe.card.classList.add('is-swiping');
        swipe.card.style.transition = 'none';
      }

      swipe.offsetX = Math.max(-74, Math.min(74, deltaX));
      swipe.card.style.transform = `translateX(${swipe.offsetX}px)`;
      event.preventDefault();
    },
    { passive: false }
  );

  const endSwipe = () => {
    if (!swipe.card) return;
    const card = swipe.card;
    const delta = swipe.offsetX;
    const shouldToggle = delta >= 56;
    const shouldDetail = delta <= -56;
    const id = Number(card.dataset.id);

    releaseCard();
    swipe.card = null;
    swipe.offsetX = 0;
    swipe.dragging = false;

    if (!Number.isFinite(id) || id <= 0) return;
    if (!shouldToggle && !shouldDetail) return;

    swipe.suppressClickUntil = Date.now() + 300;
    if (shouldDetail) {
      openStoreDetailById(id);
      triggerSwipeFeedback(getStoreMobileCard(id), 'success');
      return;
    }

    const store = state.stores.find((item) => item.id === id);
    if (!store) return;
    queueStoreActiveToggle(id, !Boolean(store.is_active), card);
  };

  storeMobileList.addEventListener('touchend', endSwipe);
  storeMobileList.addEventListener('touchcancel', endSwipe);

  storeMobileList.addEventListener('click', (event) => {
    if (Date.now() < swipe.suppressClickUntil) return;
    const card = resolveCard(event.target);
    if (!card) return;
    openStoreDetailById(card.dataset.id);
  });

  storeMobileList.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = resolveCard(event.target);
    if (!card) return;
    event.preventDefault();
    openStoreDetailById(card.dataset.id);
  });
}

function renderDrawer(store) {
  if (!store) return;
  drawerTitle.textContent = store.name;
  drawerSummary.innerHTML = `
    <div>Slug<br /><span>${escapeHtml(store.slug)}</span></div>
    <div>Trigger<br /><span>${escapeHtml(store.wa_trigger || '-')}</span></div>
    <div>Kategori<br /><span>${escapeHtml(store.category || '-')}</span></div>
    <div>Status<br /><span>${store.is_active ? 'Aktif' : 'Nonaktif'}</span></div>
  `;

  editForm.elements.id.value = store.id;
  editForm.elements.name.value = store.name || '';
  editForm.elements.slug.value = store.slug || '';
  editForm.elements.wa_trigger.value = store.wa_trigger || '';
  editForm.elements.category.value = store.category || '';
  editForm.elements.description.value = store.description || '';
  editForm.elements.is_active.checked = Boolean(store.is_active);

  deactivateBtn.textContent = store.is_active ? 'Nonaktifkan' : 'Aktifkan';
  openDrawer();
}

async function fetchStores() {
  renderStoresSkeleton();
  try {
    const data = await fetchJson('/api/stores?includeInactive=true');
    if (!data) return;
    state.stores = (data.data || []).map((store) => ({
      ...store,
      id: Number(store.id)
    }));
    renderTable();
  } catch (err) {
    showToast('Gagal memuat data toko.', true);
  }
}

storeRows.addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-id]');
  if (!row) return;
  openStoreDetailById(row.dataset.id);
});

closeDrawerBtn.addEventListener('click', () => {
  closeDrawer();
});

if (drawerBackdrop) {
  drawerBackdrop.addEventListener('click', closeDrawer);
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', fetchStores);
}

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(createForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const res = await fetchJson('/api/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res) return;

    createForm.reset();
    showToast('Toko tersimpan.');
    fetchStores();
    refreshStoreSelector();
  } catch (err) {
    if (err.message === 'duplicate_store') {
      showToast('Nama/slug/trigger sudah digunakan.', true);
    } else {
      showToast('Gagal simpan toko.', true);
    }
  }
});

editForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(editForm);
  const payload = Object.fromEntries(formData.entries());
  payload.is_active = editForm.elements.is_active.checked;

  try {
    const res = await fetchJson(`/api/stores/${payload.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res) return;

    showToast('Toko diperbarui.');
    closeDrawer();
    fetchStores();
    refreshStoreSelector();
  } catch (err) {
    if (err.message === 'duplicate_store') {
      showToast('Nama/slug/trigger sudah digunakan.', true);
    } else {
      showToast('Gagal update toko.', true);
    }
  }
});

deactivateBtn.addEventListener('click', async () => {
  const store = state.selected;
  if (!store) return;

  try {
    const res = await fetchJson(`/api/stores/${store.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !store.is_active })
    });

    if (!res) return;

    showToast(store.is_active ? 'Toko dinonaktifkan.' : 'Toko diaktifkan.');
    closeDrawer();
    fetchStores();
    refreshStoreSelector();
  } catch (err) {
    showToast('Gagal ubah status toko.', true);
  }
});

(async function init() {
  await initNav('stores');
  bindStoreMobileSwipeActions();
  initPullToRefresh({
    key: 'stores',
    onRefresh: fetchStores
  });
  fetchStores();
})();
