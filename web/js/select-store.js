import {
  escapeHtml,
  fetchJson,
  initPullToRefresh,
  initNav,
  setActiveStoreId,
  showToast,
  triggerSwipeFeedback
} from './shared.js';

const storeGrid = document.getElementById('store-grid');
const refreshBtn = document.getElementById('refresh-btn');

const state = {
  stores: [],
  activeId: null,
  selectingId: null
};

function renderStores() {
  const cards = state.stores
    .map((store) => {
      const isActive = Number(store.id) === Number(state.activeId);
      const isSelecting = Number(store.id) === Number(state.selectingId);
      const metaParts = [store.category, store.description].filter(Boolean);
      const meta = metaParts.length ? metaParts.join(' | ') : 'Tanpa deskripsi';
      const trigger = store.wa_trigger ? `Trigger: ${store.wa_trigger}` : null;
      return `
        <article
          class="product-card store-card${isSelecting ? ' is-loading' : ''}"
          data-id="${store.id}"
          tabindex="0"
          role="button"
          aria-label="Pilih toko ${escapeHtml(store.name)}"
        >
          <div>
            ${isActive ? '<span class="pill">Aktif sekarang</span>' : ''}
            <h3>${escapeHtml(store.name)}</h3>
            <p class="product-meta">${escapeHtml(meta)}</p>
            <p class="product-meta">${escapeHtml(trigger || '')}</p>
          </div>
          <button
            class="primary action-icon-btn action-icon-btn-primary"
            data-action="select"
            aria-label="Pilih toko"
            title="Pilih toko"
            ${isSelecting ? 'disabled' : ''}
          >
            <span class="action-icon-symbol" aria-hidden="true">&#x279c;</span>
            <span class="action-icon-text">${isSelecting ? 'Memilih...' : 'Pilih toko'}</span>
          </button>
        </article>
      `;
    })
    .join('');

  storeGrid.innerHTML = cards || '<p>Belum ada toko aktif.</p>';
}

function getStoreCard(storeId) {
  return storeGrid.querySelector(`.store-card[data-id="${storeId}"]`);
}

async function selectStore(storeId, { card = null } = {}) {
  const id = Number(storeId);
  if (!Number.isFinite(id) || id <= 0) return;
  if (state.selectingId != null) return;

  state.selectingId = id;
  renderStores();
  const activeCard = getStoreCard(id) || card;
  triggerSwipeFeedback(activeCard, 'success');

  try {
    const res = await fetchJson('/api/store/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: id })
    });
    if (!res) return;
    setActiveStoreId(id);
    window.location.href = '/dashboard';
  } catch (err) {
    showToast('Gagal memilih toko.', true);
  } finally {
    state.selectingId = null;
    renderStores();
  }
}

async function fetchStores() {
  try {
    const [storesData, activeData] = await Promise.all([
      fetchJson('/api/stores'),
      fetchJson('/api/store/active')
    ]);
    if (!storesData) return;
    state.stores = storesData.data || [];
    state.activeId = activeData?.store?.id ? Number(activeData.store.id) : null;
    renderStores();
  } catch (err) {
    showToast('Gagal memuat daftar toko.', true);
  }
}

function bindStoreSwipeSelection() {
  if (!storeGrid || storeGrid.dataset.swipeBound === 'true') return;
  storeGrid.dataset.swipeBound = 'true';

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
    return target.closest('.store-card[data-id]');
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

  storeGrid.addEventListener(
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

  storeGrid.addEventListener(
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
    const shouldSelect = swipe.offsetX >= 56;
    const id = Number(card.dataset.id);
    releaseCard();
    swipe.card = null;
    swipe.offsetX = 0;
    swipe.dragging = false;

    if (!Number.isFinite(id) || id <= 0 || !shouldSelect) return;
    swipe.suppressClickUntil = Date.now() + 280;
    void selectStore(id, { card });
  };

  storeGrid.addEventListener('touchend', endSwipe);
  storeGrid.addEventListener('touchcancel', endSwipe);

  storeGrid.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = resolveCard(event.target);
    if (!card) return;
    event.preventDefault();
    void selectStore(card.dataset.id, { card });
  });

  storeGrid.addEventListener('click', (event) => {
    if (Date.now() < swipe.suppressClickUntil) return;
    const button = event.target.closest('[data-action="select"]');
    const card = resolveCard(event.target);
    if (!card) return;
    if (!button) {
      if (!window.matchMedia('(max-width: 767px)').matches) return;
    }
    void selectStore(card.dataset.id, { card });
  });
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', fetchStores);
}

(async function init() {
  await initNav();
  bindStoreSwipeSelection();
  initPullToRefresh({
    key: 'select-store',
    onRefresh: fetchStores
  });
  fetchStores();
})();
