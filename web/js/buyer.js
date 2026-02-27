import {
  fetchJson,
  formatCurrency,
  formatNumber,
  initPullToRefresh,
  initThemeToggle,
  showUndoSnack,
  showToast,
  triggerSwipeFeedback,
  toNumber
} from './shared.js';

const productGrid = document.getElementById('product-grid');
const summaryItems = document.getElementById('summary-items');
const summarySubtotal = document.getElementById('summary-subtotal');
const summaryShipping = document.getElementById('summary-shipping');
const summaryTotal = document.getElementById('summary-total');
const summaryNote = document.getElementById('summary-note');
const storeChip = document.getElementById('store-pill');
const orderForm = document.getElementById('order-form');
const submitBtn = orderForm?.querySelector('button[type=\"submit\"]');

const state = {
  products: [],
  cart: new Map(),
  store: null,
  storeKey: ''
};

function getStoreParam() {
  const params = new URLSearchParams(window.location.search);
  const queryStore = params.get('store');
  const pathMatch = window.location.pathname.match(/\/(?:order|buy)\/([^/]+)/i);
  const pathStore = pathMatch ? pathMatch[1] : '';
  if (queryStore || pathStore) {
    return String(queryStore || pathStore || '').trim().toLowerCase();
  }

  const host = window.location.hostname || '';
  const isLocal =
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (!isLocal) {
    const parts = host.split('.').filter(Boolean);
    if (parts.length >= 3) {
      return String(parts[0]).trim().toLowerCase();
    }
  }

  return '';
}

function renderStoreInfo() {
  if (!storeChip) return;
  if (state.store?.name) {
    storeChip.textContent = state.store.name;
    storeChip.classList.remove('hidden');
    document.title = `Belanja - ${state.store.name}`;
  } else {
    storeChip.textContent = 'Toko';
  }
}

function renderProducts() {
  const cards = state.products
    .map((product) => {
      const qty = state.cart.get(product.id) || 0;
      const disabled = product.sell_price == null || product.sell_price <= 0;
      const stockLabel = Number.isFinite(product.stock)
        ? `Stok: ${formatNumber(product.stock)}`
        : 'Stok: -';

      return `
        <article class="product-card" data-id="${product.id}">
          <div>
            <h3>${product.name}</h3>
            <p>${formatCurrency(product.sell_price)} / ${product.unit || 'unit'}</p>
            <p class="product-meta">${stockLabel}</p>
          </div>
          <div class="qty-control">
            <button
              type="button"
              class="icon-btn"
              data-action="dec"
              aria-label="Kurangi jumlah"
              title="Kurangi jumlah"
              ${disabled ? 'disabled' : ''}
            >
              <span class="icon-symbol" aria-hidden="true">−</span>
            </button>
            <input
              type="number"
              min="0"
              step="1"
              data-qty
              value="${qty}"
              ${disabled ? 'disabled' : ''}
            />
            <button
              type="button"
              class="icon-btn"
              data-action="inc"
              aria-label="Tambah jumlah"
              title="Tambah jumlah"
              ${disabled ? 'disabled' : ''}
            >
              <span class="icon-symbol" aria-hidden="true">+</span>
            </button>
          </div>
        </article>
      `;
    })
    .join('');

  productGrid.innerHTML = cards || '<p>Belum ada produk yang bisa dibeli.</p>';
}

function updateSummary() {
  const items = [];
  let subtotal = 0;

  for (const [productId, qty] of state.cart.entries()) {
    const product = state.products.find((item) => item.id === productId);
    if (!product) continue;
    const lineTotal = qty * product.sell_price;
    subtotal += lineTotal;
    items.push({
      name: product.name,
      qty,
      total: lineTotal
    });
  }

  const shippingFee = subtotal >= 20000 || subtotal === 0 ? 0 : 1000;
  const total = subtotal + shippingFee;

  summarySubtotal.textContent = formatCurrency(subtotal);
  summaryShipping.textContent = shippingFee > 0 ? formatCurrency(shippingFee) : 'Gratis';
  summaryTotal.textContent = formatCurrency(total);

  if (items.length === 0) {
    summaryItems.innerHTML = '<p>Belum ada barang dipilih.</p>';
    summaryNote.textContent = '';
    return;
  }

  summaryItems.innerHTML = items
    .map((item) => {
      return `
        <div class="summary-item">
          <span>${item.name} x${item.qty}</span>
          <strong>${formatCurrency(item.total)}</strong>
        </div>
      `;
    })
    .join('');

  if (subtotal >= 20000) {
    summaryNote.textContent = 'Gratis ongkir aktif untuk pesanan ini.';
  } else {
    const diff = 20000 - subtotal;
    summaryNote.textContent = `Tambah belanja ${formatCurrency(diff)} lagi untuk gratis ongkir.`;
  }
}

function setQty(productId, qty) {
  const nextQty = Math.max(0, Math.floor(qty));
  if (nextQty <= 0) {
    state.cart.delete(productId);
  } else {
    state.cart.set(productId, nextQty);
  }

  const card = productGrid.querySelector(`.product-card[data-id="${productId}"]`);
  const input = card?.querySelector('input[data-qty]');
  if (input) {
    input.value = nextQty;
  }

  updateSummary();
}

function getProductById(productId) {
  return state.products.find((item) => item.id === Number(productId)) || null;
}

function getProductCard(productId) {
  return productGrid.querySelector(`.product-card[data-id="${productId}"]`);
}

function changeQty(productId, delta, { withUndo = false, fallbackCard = null } = {}) {
  const id = Number(productId);
  if (!Number.isFinite(id) || id <= 0) return;
  const product = getProductById(id);
  if (!product || !Number.isFinite(Number(product.sell_price)) || Number(product.sell_price) <= 0) {
    return;
  }

  const previousQty = state.cart.get(id) || 0;
  const nextQty = Math.max(0, previousQty + Number(delta || 0));
  if (previousQty === nextQty) return;

  setQty(id, nextQty);
  const visual = getProductCard(id) || fallbackCard;
  triggerSwipeFeedback(visual, delta > 0 ? 'success' : 'danger');

  if (!withUndo) return;
  showUndoSnack({
    message: delta > 0 ? `${product.name} ditambah.` : `${product.name} dikurangi.`,
    actionLabel: 'Urungkan',
    duration: 3200,
    onUndo: () => {
      setQty(id, previousQty);
      const undoVisual = getProductCard(id) || fallbackCard;
      triggerSwipeFeedback(undoVisual, 'success');
    }
  });
}

function bindBuyerSwipeQty() {
  if (!productGrid || productGrid.dataset.swipeBound === 'true') return;
  productGrid.dataset.swipeBound = 'true';

  const swipe = {
    card: null,
    startX: 0,
    startY: 0,
    offsetX: 0,
    dragging: false
  };

  const resolveCard = (target) => {
    if (!(target instanceof Element)) return null;
    return target.closest('.product-card[data-id]');
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

  productGrid.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) return;
      const targetEl = event.target;
      if (
        targetEl instanceof Element &&
        targetEl.closest('input, button, textarea, select, a')
      ) {
        return;
      }
      const card = resolveCard(targetEl);
      if (!card) return;
      swipe.card = card;
      swipe.startX = event.touches[0].clientX;
      swipe.startY = event.touches[0].clientY;
      swipe.offsetX = 0;
      swipe.dragging = false;
    },
    { passive: true }
  );

  productGrid.addEventListener(
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
    const id = Number(card.dataset.id);
    const shouldInc = swipe.offsetX >= 56;
    const shouldDec = swipe.offsetX <= -56;

    releaseCard();
    swipe.card = null;
    swipe.offsetX = 0;
    swipe.dragging = false;

    if (!Number.isFinite(id) || id <= 0) return;
    if (!shouldInc && !shouldDec) return;

    changeQty(id, shouldInc ? 1 : -1, { withUndo: true, fallbackCard: card });
  };

  productGrid.addEventListener('touchend', endSwipe);
  productGrid.addEventListener('touchcancel', endSwipe);
}

productGrid.addEventListener('click', (event) => {
  const action = event.target?.dataset?.action;
  if (!action) return;
  const card = event.target.closest('.product-card');
  if (!card) return;
  const productId = Number(card.dataset.id);
  if (!Number.isFinite(productId)) return;

  if (action === 'inc') {
    changeQty(productId, 1, { withUndo: false, fallbackCard: card });
  }
  if (action === 'dec') {
    changeQty(productId, -1, { withUndo: false, fallbackCard: card });
  }
});

productGrid.addEventListener('input', (event) => {
  const input = event.target;
  if (!input?.matches('input[data-qty]')) return;
  const card = input.closest('.product-card');
  if (!card) return;
  const productId = Number(card.dataset.id);
  const qty = toNumber(input.value || 0) || 0;
  setQty(productId, qty);
});

orderForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (state.cart.size === 0) {
    showToast('Pilih barang terlebih dahulu.', true);
    return;
  }

  const formData = new FormData(orderForm);
  const payload = Object.fromEntries(formData.entries());
  payload.items = Array.from(state.cart.entries()).map(([productId, qty]) => ({
    product_id: productId,
    qty
  }));
  if (state.store?.id) payload.store_id = state.store.id;
  if (state.store?.slug || state.storeKey) {
    payload.store = state.store?.slug || state.storeKey;
  }

  try {
    if (submitBtn) submitBtn.disabled = true;
    const res = await fetchJson('/api/public/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res) return;

    showToast(`Pesanan terkirim. ID: #${res.orderId}`);
    orderForm.reset();
    state.cart.clear();
    renderProducts();
    updateSummary();
  } catch (err) {
    showToast('Gagal kirim pesanan. Coba lagi.', true);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

async function fetchProducts() {
  const params = new URLSearchParams();
  if (state.storeKey) params.set('store', state.storeKey);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  try {
    const data = await fetchJson(`/api/public/products${suffix}`);
    if (!data) return;
    state.store = data.store || null;
    state.products = (data.data || []).map((item) => ({
      ...item,
      id: Number(item.id),
      sell_price: Number(item.sell_price)
    }));
    renderStoreInfo();
    renderProducts();
    updateSummary();
  } catch (err) {
    showToast('Gagal memuat produk.', true);
  }
}

state.storeKey = getStoreParam();
initThemeToggle();
bindBuyerSwipeQty();
initPullToRefresh({
  key: 'buyer',
  onRefresh: fetchProducts
});
fetchProducts();
