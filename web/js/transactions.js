import {
  escapeHtml,
  fetchJson,
  formatCurrency,
  formatCurrencyInputValue,
  formatNumber,
  getActiveStoreId,
  initNav,
  showToast,
  toNumber
} from './shared.js';

const form = document.getElementById('transaction-form');
const typeSelect = document.getElementById('type-select');
const productSelect = document.getElementById('product-select');
const newProductField = document.getElementById('new-product-field');
const newProductInput = document.getElementById('new-product-name');
const productInfo = document.getElementById('product-info');
const priceFields = document.getElementById('price-fields');
const buyField = document.getElementById('buy-field');
const sellField = document.getElementById('sell-field');
const priceHint = document.getElementById('price-hint');
const searchInput = document.getElementById('search-input');
const filterType = document.getElementById('filter-type');
const filterDate = document.getElementById('filter-date');
const refreshBtn = document.getElementById('refresh-btn');
const transactionRows = document.getElementById('transaction-rows');
const transactionsGrid = document.getElementById('transactions-grid');
const transactionCard = document.getElementById('transaction-card');
const toggleTransactionBtn = document.getElementById('toggle-transaction');

const state = {
  products: [],
  transactions: [],
  search: '',
  filterType: '',
  filterDate: '',
  selectedProductId: null,
  prefillProductId: null,
  prefillType: null
};

let searchTimer;
const TRANSACTION_FORM_STORAGE_KEY = 'transactions:form-hidden';

function setTransactionFormHidden(hidden, shouldPersist = true) {
  if (!transactionCard || !transactionsGrid || !toggleTransactionBtn) return;
  transactionCard.classList.toggle('hidden', hidden);
  transactionsGrid.classList.toggle('form-hidden', hidden);
  const label = hidden ? 'Tampilkan form' : 'Sembunyikan form';
  toggleTransactionBtn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  toggleTransactionBtn.setAttribute('aria-label', label);
  toggleTransactionBtn.setAttribute('title', label);
  const icon = toggleTransactionBtn.querySelector('.fab-icon');
  if (icon) icon.textContent = hidden ? '+' : '-';
  if (!shouldPersist) return;
  try {
    localStorage.setItem(TRANSACTION_FORM_STORAGE_KEY, hidden ? '1' : '0');
  } catch (err) {
    // Ignore storage errors (private mode, etc.)
  }
}

function loadTransactionFormState() {
  if (!transactionCard || !transactionsGrid || !toggleTransactionBtn) return;
  try {
    const saved = localStorage.getItem(TRANSACTION_FORM_STORAGE_KEY);
    if (saved === '0') {
      setTransactionFormHidden(false, false);
    } else {
      setTransactionFormHidden(true, false);
    }
  } catch (err) {
    // Ignore storage errors.
  }
}

function pickNumber(value) {
  const num = toNumber(value);
  return Number.isNaN(num) ? null : num;
}

function pickPrice(...values) {
  for (const value of values) {
    const num = pickNumber(value);
    if (num != null && num > 0) return num;
  }
  return null;
}

function getTypeLabel(type) {
  if (type === 'IN') return 'Masuk';
  if (type === 'OUT') return 'Terjual';
  if (type === 'DAMAGE') return 'Rusak';
  return type || '-';
}

function getTypeClass(type) {
  if (type === 'IN') return 'status-in';
  if (type === 'OUT') return 'status-out';
  if (type === 'DAMAGE') return 'status-damage';
  return '';
}

function renderProductInfo(product) {
  if (!product) {
    productInfo.innerHTML = '<div>Pilih barang untuk melihat detail.</div>';
    return;
  }

  const buyPrice = pickPrice(product.last_buy_price, product.default_buy_price);
  const sellPrice = pickPrice(product.last_sell_price, product.default_sell_price);
  const payableLabel = product.payable_mode === 'cash' ? 'Lunas' : 'Utang';

  productInfo.innerHTML = `
    <div>Stok<br /><span>${formatNumber(product.stock)}</span></div>
    <div>Harga beli<br /><span>${formatCurrency(buyPrice)}</span></div>
    <div>Harga jual<br /><span>${formatCurrency(sellPrice)}</span></div>
    <div>Modal<br /><span>${payableLabel}</span></div>
  `;
}

function renderProductOptions() {
  const options = [
    '<option value="">Pilih barang</option>',
    ...state.products.map((product) => {
      const inactiveLabel = product.is_active ? '' : ' (nonaktif)';
      return `<option value="${product.id}">${escapeHtml(product.name)}${inactiveLabel}</option>`;
    }),
    '<option value="__new__">+ Produk baru</option>'
  ];

  productSelect.innerHTML = options.join('');
  if (state.selectedProductId) {
    productSelect.value = String(state.selectedProductId);
  }
}

function syncSelectedProduct() {
  const value = productSelect.value;
  if (value === '__new__') {
    newProductField.classList.remove('hidden');
    newProductInput.required = true;
    state.selectedProductId = null;
    renderProductInfo(null);
    return;
  }

  newProductField.classList.add('hidden');
  newProductInput.required = false;

  const id = Number(value);
  const product = state.products.find((item) => item.id === id);
  state.selectedProductId = product ? product.id : null;
  renderProductInfo(product || null);
  suggestPrices(product);
}

function suggestPrices(product) {
  if (!product) return;
  const type = typeSelect.value;
  const buyInput = form.elements.buy_price;
  const sellInput = form.elements.sell_price;

  if (type === 'IN' && buyInput && !buyInput.value) {
    const buyPrice = pickPrice(product.last_buy_price, product.default_buy_price);
    if (buyPrice != null) {
      buyInput.value = buyPrice;
      formatCurrencyInputValue(buyInput);
    }
  }

  if (type === 'OUT' && sellInput && !sellInput.value) {
    const sellPrice = pickPrice(product.last_sell_price, product.default_sell_price);
    if (sellPrice != null) {
      sellInput.value = sellPrice;
      formatCurrencyInputValue(sellInput);
    }
  }
}

function updateTypeFields() {
  const type = typeSelect.value;
  const buyInput = form.elements.buy_price;
  const sellInput = form.elements.sell_price;

  if (type === 'IN') {
    priceFields.classList.remove('hidden');
    buyField.classList.remove('hidden');
    sellField.classList.remove('hidden');
    buyInput.required = true;
    priceHint.textContent = 'Harga beli wajib. Harga jual opsional untuk update harga jual terakhir.';
  } else if (type === 'OUT') {
    priceFields.classList.remove('hidden');
    buyField.classList.add('hidden');
    sellField.classList.remove('hidden');
    buyInput.required = false;
    buyInput.value = '';
    priceHint.textContent = 'Harga jual opsional. Jika kosong, gunakan harga jual terakhir.';
  } else {
    priceFields.classList.add('hidden');
    buyInput.required = false;
    buyInput.value = '';
    sellInput.value = '';
    priceHint.textContent = 'Barang rusak tidak memerlukan harga.';
  }

  suggestPrices(state.products.find((item) => item.id === state.selectedProductId));
  formatCurrencyInputValue(buyInput);
  formatCurrencyInputValue(sellInput);
}

function getLocalDateRange(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const start = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

function renderTransactions() {
  const rows = state.transactions
    .map((tx) => {
      const date = new Date(tx.created_at);
      const dateLabel = Number.isNaN(date.getTime())
        ? '-'
        : date.toLocaleString('id-ID');
      const typeLabel = getTypeLabel(tx.type);
      const typeClass = getTypeClass(tx.type);
      const note = tx.note ? escapeHtml(tx.note) : '-';

      return `
        <tr>
          <td>${dateLabel}</td>
          <td><span class="status-pill ${typeClass}">${typeLabel}</span></td>
          <td>
            <div class="cell-title">${escapeHtml(tx.item)}</div>
            <div class="cell-meta">${escapeHtml(tx.unit || '-') }</div>
          </td>
          <td>${formatNumber(tx.qty)}</td>
          <td>${formatCurrency(tx.unit_price)}</td>
          <td>${formatCurrency(tx.total)}</td>
          <td>${note}</td>
        </tr>
      `;
    })
    .join('');

  transactionRows.innerHTML = rows ||
    '<tr><td colspan="7">Belum ada transaksi.</td></tr>';
}

async function fetchProducts() {
  try {
    const params = new URLSearchParams();
    const storeId = getActiveStoreId();
    if (storeId) params.set('storeId', storeId);
    params.set('includeInactive', 'true');

    const data = await fetchJson(`/api/products?${params.toString()}`);
    if (!data) return;
    state.products = (data.data || []).map((item) => ({
      ...item,
      id: Number(item.id)
    }));

    renderProductOptions();
    if (state.prefillProductId) {
      const match = state.products.find((item) => item.id === state.prefillProductId);
      if (match) {
        state.selectedProductId = match.id;
        productSelect.value = String(match.id);
      }
      state.prefillProductId = null;
    }
    syncSelectedProduct();
  } catch (err) {
    showToast('Gagal memuat produk.', true);
  }
}

async function fetchTransactions() {
  try {
    const params = new URLSearchParams();
    const storeId = getActiveStoreId();
    if (storeId) params.set('storeId', storeId);
    if (state.search) params.set('search', state.search);
    if (state.filterType) params.set('type', state.filterType);
    const dateRange = getLocalDateRange(state.filterDate);
    if (dateRange) {
      params.set('from', dateRange.from);
      params.set('to', dateRange.to);
    }
    params.set('limit', '100');

    const data = await fetchJson(`/api/transactions?${params.toString()}`);
    if (!data) return;
    state.transactions = data.data || [];
    renderTransactions();
  } catch (err) {
    showToast('Gagal memuat transaksi.', true);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  const type = payload.type;
  const qty = toNumber(payload.qty);
  if (!type || !Number.isFinite(qty) || qty <= 0) {
    showToast('Qty harus lebih dari 0.', true);
    return;
  }

  if (payload.product_id === '__new__') {
    delete payload.product_id;
  }

  if (!payload.product_id && !payload.item) {
    showToast('Pilih barang terlebih dahulu.', true);
    return;
  }

  if (type === 'IN' && (!payload.buy_price || String(payload.buy_price).trim() === '')) {
    showToast('Harga beli wajib untuk barang masuk.', true);
    return;
  }

  const storeId = getActiveStoreId();
  if (!storeId) {
    showToast('Pilih toko aktif dulu.', true);
    return;
  }
  payload.store_id = storeId;

  try {
    const res = await fetchJson('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res) return;

    form.reset();
    productSelect.value = '';
    newProductField.classList.add('hidden');
    newProductInput.required = false;
    state.selectedProductId = null;
    renderProductInfo(null);
    updateTypeFields();

    showToast('Transaksi tersimpan.');
    await fetchProducts();
    await fetchTransactions();
  } catch (err) {
    if (err.message === 'missing_buy') {
      showToast('Harga beli wajib untuk stok masuk.', true);
    } else if (err.message === 'missing_sell') {
      showToast('Harga jual belum ada. Isi harga jual terlebih dahulu.', true);
    } else if (err.message === 'missing_cost') {
      showToast('Harga beli belum ada. Catat barang masuk dulu.', true);
    } else if (err.message === 'store_mismatch') {
      showToast('Barang bukan milik toko aktif.', true);
    } else if (err.message === 'product_not_found') {
      showToast('Produk tidak ditemukan.', true);
    } else {
      showToast('Gagal menyimpan transaksi.', true);
    }
  }
});

productSelect.addEventListener('change', syncSelectedProduct);

typeSelect.addEventListener('change', updateTypeFields);

if (searchInput) {
  searchInput.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    state.search = event.target.value.trim();
    searchTimer = setTimeout(fetchTransactions, 300);
  });
}

if (filterType) {
  filterType.addEventListener('change', (event) => {
    state.filterType = event.target.value;
    fetchTransactions();
  });
}

if (filterDate) {
  const handleDateChange = (event) => {
    state.filterDate = event.target.value;
    fetchTransactions();
  };
  filterDate.addEventListener('input', handleDateChange);
  filterDate.addEventListener('change', handleDateChange);
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    fetchProducts();
    fetchTransactions();
  });
}

if (toggleTransactionBtn) {
  toggleTransactionBtn.addEventListener('click', () => {
    const isHidden = transactionCard?.classList.contains('hidden');
    setTransactionFormHidden(!isHidden);
  });
}

window.addEventListener('store:change', () => {
  state.selectedProductId = null;
  form.reset();
  updateTypeFields();
  fetchProducts();
  fetchTransactions();
});

(async function init() {
  await initNav('transactions');
  loadTransactionFormState();
  const params = new URLSearchParams(window.location.search);
  const typeParam = String(params.get('type') || '').toUpperCase();
  if (['IN', 'OUT', 'DAMAGE'].includes(typeParam)) {
    state.prefillType = typeParam;
    typeSelect.value = typeParam;
  }
  const productParam = Number(params.get('productId') || params.get('product_id'));
  if (Number.isFinite(productParam) && productParam > 0) {
    state.prefillProductId = productParam;
  }
  if (filterDate && filterDate.value) {
    state.filterDate = filterDate.value;
  }

  updateTypeFields();
  await fetchProducts();
  await fetchTransactions();
})();
