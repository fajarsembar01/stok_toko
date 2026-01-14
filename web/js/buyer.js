import {
  fetchJson,
  formatCurrency,
  formatNumber,
  initThemeToggle,
  showToast,
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
            <button type="button" class="ghost" data-action="dec" ${disabled ? 'disabled' : ''}>-</button>
            <input
              type="number"
              min="0"
              step="1"
              data-qty
              value="${qty}"
              ${disabled ? 'disabled' : ''}
            />
            <button type="button" class="ghost" data-action="inc" ${disabled ? 'disabled' : ''}>+</button>
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

productGrid.addEventListener('click', (event) => {
  const action = event.target?.dataset?.action;
  if (!action) return;
  const card = event.target.closest('.product-card');
  if (!card) return;
  const productId = Number(card.dataset.id);
  if (!Number.isFinite(productId)) return;

  const current = state.cart.get(productId) || 0;
  if (action === 'inc') {
    setQty(productId, current + 1);
  }
  if (action === 'dec') {
    setQty(productId, current - 1);
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
fetchProducts();
