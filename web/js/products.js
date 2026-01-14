import {
  escapeHtml,
  fetchJson,
  formatCurrency,
  formatNumber,
  getActiveStoreId,
  initNav,
  showToast,
  toNumber
} from './shared.js';

const productRows = document.getElementById('product-rows');
const searchInput = document.getElementById('search-input');
const toggleInactive = document.getElementById('toggle-inactive');
const refreshBtn = document.getElementById('refresh-btn');
const createForm = document.getElementById('create-form');
const drawer = document.getElementById('drawer');
const drawerTitle = document.getElementById('drawer-title');
const drawerSummary = document.getElementById('drawer-summary');
const closeDrawerBtn = document.getElementById('close-drawer');
const editForm = document.getElementById('edit-form');
const deactivateBtn = document.getElementById('deactivate-btn');
const quickModal = document.getElementById('quick-modal');
const quickForm = document.getElementById('quick-form');
const quickProductName = document.getElementById('quick-product-name');
const quickProductMeta = document.getElementById('quick-product-meta');
const quickType = document.getElementById('quick-type');
const quickPriceFields = document.getElementById('quick-price-fields');
const quickBuyField = document.getElementById('quick-buy-field');
const quickSellField = document.getElementById('quick-sell-field');
const quickPriceHint = document.getElementById('quick-price-hint');

const state = {
  products: [],
  search: '',
  includeInactive: false,
  selected: null,
  quickProduct: null
};

let searchTimer;

function pickPrice(product, key) {
  const defaultValue = toNumber(product[`default_${key}_price`]);
  if (defaultValue !== null) return defaultValue;
  return toNumber(product[`last_${key}_price`]);
}

function renderTable() {
  const rows = state.products
    .map((product, index) => {
      const statusClass = product.is_active ? 'status-active' : 'status-inactive';
      const statusLabel = product.is_active ? 'Aktif' : 'Nonaktif';
      const buyPrice = pickPrice(product, 'buy');
      const sellPrice = pickPrice(product, 'sell');
      const payableMode = product.payable_mode === 'cash' ? 'Lunas' : 'Utang';
      const payableClass =
        product.payable_mode === 'cash' ? 'status-cash' : 'status-credit';

      return `
        <tr data-id="${product.id}" style="animation-delay:${index * 20}ms">
          <td>
            <div class="cell-title">${escapeHtml(product.name)}</div>
            <div class="cell-meta">${escapeHtml(product.unit || '-')}</div>
          </td>
          <td>${formatNumber(product.stock)}</td>
          <td>${formatCurrency(buyPrice)}</td>
          <td>${formatCurrency(sellPrice)}</td>
          <td>${formatCurrency(product.revenue)}</td>
          <td>${formatCurrency(product.profit)}</td>
          <td><span class="status-pill ${payableClass}">${payableMode}</span></td>
          <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
          <td>
            <div class="flex flex-wrap gap-2">
              <button class="ghost" data-action="edit">Edit</button>
              <button class="ghost" data-action="restock">Tambah stok</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  productRows.innerHTML = rows ||
    '<tr><td colspan="9">Belum ada data barang.</td></tr>';
}

function renderDrawer(product) {
  if (!product) return;
  const buyPrice = pickPrice(product, 'buy');
  const sellPrice = pickPrice(product, 'sell');
  const payableMode = product.payable_mode === 'cash' ? 'Lunas' : 'Utang';

  drawerTitle.textContent = product.name;
  drawerSummary.innerHTML = `
    <div>Stok<br /><span>${formatNumber(product.stock)}</span></div>
    <div>Revenue<br /><span>${formatCurrency(product.revenue)}</span></div>
    <div>Profit<br /><span>${formatCurrency(product.profit)}</span></div>
    <div>Harga jual<br /><span>${formatCurrency(sellPrice)}</span></div>
    <div>Harga beli<br /><span>${formatCurrency(buyPrice)}</span></div>
    <div>Modal<br /><span>${payableMode}</span></div>
    <div>Transaksi keluar<br /><span>${formatNumber(product.stock_out)}</span></div>
  `;

  editForm.elements.id.value = product.id;
  editForm.elements.name.value = product.name || '';
  editForm.elements.unit.value = product.unit || '';
  editForm.elements.default_buy_price.value =
    product.default_buy_price ?? '';
  editForm.elements.default_sell_price.value =
    product.default_sell_price ?? '';
  if (editForm.elements.payable_mode) {
    editForm.elements.payable_mode.value = product.payable_mode || 'credit';
  }
  editForm.elements.note.value = product.note || '';
  editForm.elements.is_active.checked = Boolean(product.is_active);

  deactivateBtn.textContent = product.is_active ? 'Nonaktifkan' : 'Aktifkan';
  drawer.classList.add('open');
}

function renderQuickMeta(product) {
  if (!quickProductMeta) return;
  if (!product) {
    quickProductMeta.innerHTML = '<div>Pilih barang untuk melihat detail.</div>';
    return;
  }

  const buyPrice = pickPrice(product, 'buy');
  const sellPrice = pickPrice(product, 'sell');
  const payableLabel = product.payable_mode === 'cash' ? 'Lunas' : 'Utang';

  quickProductMeta.innerHTML = `
    <div>Stok<br /><span>${formatNumber(product.stock)}</span></div>
    <div>Harga beli<br /><span>${formatCurrency(buyPrice)}</span></div>
    <div>Harga jual<br /><span>${formatCurrency(sellPrice)}</span></div>
    <div>Modal<br /><span>${payableLabel}</span></div>
  `;
}

function updateQuickTypeFields() {
  if (!quickForm) return;
  const type = quickType?.value || 'IN';
  const buyInput = quickForm.elements.buy_price;
  const sellInput = quickForm.elements.sell_price;

  if (type === 'IN') {
    quickPriceFields.classList.remove('hidden');
    quickBuyField.classList.remove('hidden');
    quickSellField.classList.remove('hidden');
    buyInput.required = true;
    quickPriceHint.textContent =
      'Harga beli wajib. Harga jual opsional untuk update harga jual terakhir.';
  } else if (type === 'OUT') {
    quickPriceFields.classList.remove('hidden');
    quickBuyField.classList.add('hidden');
    quickSellField.classList.remove('hidden');
    buyInput.required = false;
    buyInput.value = '';
    quickPriceHint.textContent =
      'Harga jual opsional. Jika kosong, gunakan harga jual terakhir.';
  } else {
    quickPriceFields.classList.add('hidden');
    buyInput.required = false;
    buyInput.value = '';
    sellInput.value = '';
    quickPriceHint.textContent = 'Barang rusak tidak memerlukan harga.';
  }

  if (state.quickProduct) {
    const buyPrice = pickPrice(state.quickProduct, 'buy');
    const sellPrice = pickPrice(state.quickProduct, 'sell');
    if (type === 'IN') {
      if (buyPrice != null && !buyInput.value) buyInput.value = buyPrice;
      if (sellPrice != null && !sellInput.value) sellInput.value = sellPrice;
    }
    if (type === 'OUT' && sellPrice != null && !sellInput.value) {
      sellInput.value = sellPrice;
    }
  }
}

function openQuickModal(product, type = 'IN') {
  if (!quickModal || !quickForm) return;
  state.quickProduct = product;
  quickProductName.textContent = product.name;
  quickForm.reset();
  quickForm.elements.product_id.value = product.id;
  quickType.value = type;
  renderQuickMeta(product);
  updateQuickTypeFields();
  quickModal.classList.remove('hidden');
  quickModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeQuickModal() {
  if (!quickModal || !quickForm) return;
  quickModal.classList.add('hidden');
  quickModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  quickForm.reset();
  state.quickProduct = null;
  renderQuickMeta(null);
}

async function fetchProducts() {
  const params = new URLSearchParams();
  if (state.includeInactive) params.set('includeInactive', 'true');
  if (state.search) params.set('search', state.search);
  const storeId = getActiveStoreId();
  if (storeId) params.set('storeId', storeId);

  try {
    const data = await fetchJson(`/api/products?${params.toString()}`);
    if (!data) return;
    state.products = (data.data || []).map((item) => ({
      ...item,
      id: Number(item.id)
    }));
    renderTable();
    if (state.selected) {
      const updated = state.products.find((item) => item.id === state.selected.id);
      if (updated && drawer.classList.contains('open')) {
        state.selected = updated;
        renderDrawer(updated);
      }
    }
    if (state.quickProduct && quickModal && !quickModal.classList.contains('hidden')) {
      const updated = state.products.find((item) => item.id === state.quickProduct.id);
      if (updated) {
        state.quickProduct = updated;
        renderQuickMeta(updated);
      }
    }
  } catch (err) {
    showToast('Gagal memuat data.', true);
  }
}

productRows.addEventListener('click', (event) => {
  const actionBtn = event.target.closest('[data-action]');
  const row = event.target.closest('tr[data-id]');
  if (!row) return;
  const id = Number(row.dataset.id);
  const product = state.products.find((item) => item.id === id);
  if (!product) return;

  if (actionBtn?.dataset.action === 'restock') {
    openQuickModal(product, 'IN');
    return;
  }

  if (actionBtn?.dataset.action === 'edit') {
    state.selected = product;
    renderDrawer(product);
    return;
  }

  state.selected = product;
  renderDrawer(product);
});

closeDrawerBtn.addEventListener('click', () => {
  drawer.classList.remove('open');
});

if (refreshBtn) {
  refreshBtn.addEventListener('click', fetchProducts);
}

searchInput.addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  state.search = event.target.value.trim();
  searchTimer = setTimeout(fetchProducts, 300);
});

toggleInactive.addEventListener('change', (event) => {
  state.includeInactive = event.target.checked;
  fetchProducts();
});

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(createForm);
  const payload = Object.fromEntries(formData.entries());
  const storeId = getActiveStoreId();
  if (storeId) payload.store_id = storeId;

  try {
    const res = await fetchJson('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res) return;

    createForm.reset();
    showToast('Barang tersimpan.');
    fetchProducts();
  } catch (err) {
    showToast('Gagal simpan barang.', true);
  }
});

editForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(editForm);
  const payload = Object.fromEntries(formData.entries());
  payload.is_active = editForm.elements.is_active.checked;

  try {
    const res = await fetchJson(`/api/products/${payload.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res) return;

    showToast('Barang diperbarui.');
    drawer.classList.remove('open');
    fetchProducts();
  } catch (err) {
    if (err.message === 'duplicate_name') {
      showToast('Nama barang sudah ada.', true);
    } else {
      showToast('Gagal update barang.', true);
    }
  }
});

deactivateBtn.addEventListener('click', async () => {
  const product = state.selected;
  if (!product) return;

  try {
    const res = await fetchJson(`/api/products/${product.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !product.is_active })
    });

    if (!res) return;

    showToast(product.is_active ? 'Barang dinonaktifkan.' : 'Barang diaktifkan.');
    drawer.classList.remove('open');
    fetchProducts();
  } catch (err) {
    showToast('Gagal ubah status.', true);
  }
});

if (quickModal) {
  quickModal.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="close"]')) {
      closeQuickModal();
    }
  });
}

if (quickType) {
  quickType.addEventListener('change', updateQuickTypeFields);
}

if (quickForm) {
  quickForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(quickForm);
    const payload = Object.fromEntries(formData.entries());
    const storeId = getActiveStoreId();
    if (storeId) payload.store_id = storeId;

    const qty = toNumber(payload.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      showToast('Qty harus lebih dari 0.', true);
      return;
    }

    if (payload.type === 'IN' && !payload.buy_price) {
      showToast('Harga beli wajib untuk barang masuk.', true);
      return;
    }

    try {
      const res = await fetchJson('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res) return;

      showToast('Transaksi tersimpan.');
      closeQuickModal();
      fetchProducts();
    } catch (err) {
      if (err.message === 'missing_buy') {
        showToast('Harga beli wajib untuk stok masuk.', true);
      } else if (err.message === 'missing_sell') {
        showToast('Harga jual belum ada. Isi harga jual terlebih dahulu.', true);
      } else if (err.message === 'missing_cost') {
        showToast('Harga beli belum ada. Catat barang masuk dulu.', true);
      } else {
        showToast('Gagal menyimpan transaksi.', true);
      }
    }
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && quickModal && !quickModal.classList.contains('hidden')) {
    closeQuickModal();
  }
});

window.addEventListener('store:change', () => {
  state.selected = null;
  state.quickProduct = null;
  drawer.classList.remove('open');
  if (quickModal) closeQuickModal();
  fetchProducts();
});

(async function init() {
  await initNav('products');
  fetchProducts();
})();
