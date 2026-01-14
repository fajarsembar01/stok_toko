import {
  escapeHtml,
  fetchJson,
  initNav,
  setActiveStoreId,
  showToast
} from './shared.js';

const storeGrid = document.getElementById('store-grid');
const refreshBtn = document.getElementById('refresh-btn');

const state = {
  stores: [],
  activeId: null
};

function renderStores() {
  const cards = state.stores
    .map((store) => {
      const isActive = Number(store.id) === Number(state.activeId);
      const metaParts = [store.category, store.description].filter(Boolean);
      const meta = metaParts.length ? metaParts.join(' • ') : 'Tanpa deskripsi';
      const trigger = store.wa_trigger ? `Trigger: ${store.wa_trigger}` : null;
      return `
        <article class="product-card store-card" data-id="${store.id}">
          <div>
            ${isActive ? '<span class="pill">Aktif sekarang</span>' : ''}
            <h3>${escapeHtml(store.name)}</h3>
            <p class="product-meta">${escapeHtml(meta)}</p>
            <p class="product-meta">${escapeHtml(trigger || '')}</p>
          </div>
          <button class="primary" data-action="select">Pilih toko</button>
        </article>
      `;
    })
    .join('');

  storeGrid.innerHTML = cards || '<p>Belum ada toko aktif.</p>';
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

storeGrid.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="select"]');
  if (!button) return;
  const card = event.target.closest('.store-card');
  if (!card) return;
  const storeId = Number(card.dataset.id);
  if (!Number.isFinite(storeId)) return;

  try {
    const res = await fetchJson('/api/store/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: storeId })
    });
    if (!res) return;
    setActiveStoreId(storeId);
    window.location.href = '/dashboard';
  } catch (err) {
    showToast('Gagal memilih toko.', true);
  }
});

if (refreshBtn) {
  refreshBtn.addEventListener('click', fetchStores);
}

(async function init() {
  await initNav();
  fetchStores();
})();
