import {
  escapeHtml,
  fetchJson,
  formatCurrency,
  formatCurrencyInputValue,
  formatNumber,
  getActiveStoreId,
  initCurrencyInputs,
  initNav,
  showToast,
  toNumber
} from './shared.js';

const HELPER_STORAGE_PREFIX = 'receipt:helpers:';

const itemForm = document.getElementById('item-form');
const productInput = document.getElementById('item-product');
const productList = document.getElementById('item-product-list');
const itemQtyInput = document.getElementById('item-qty');
const itemPriceInput = document.getElementById('item-price');
const itemRows = document.getElementById('item-rows');
const paymentMethod = document.getElementById('payment-method');
const helperTitle = document.getElementById('helper-title');
const helperText = document.getElementById('helper-text');
const cashHelper = document.getElementById('cash-helper');
const cashReceivedInput = document.getElementById('cash-received');
const cashChange = document.getElementById('cash-change');
const helperBankName = document.getElementById('helper-bank-name');
const helperBankAccount = document.getElementById('helper-bank-account');
const helperBankHolder = document.getElementById('helper-bank-holder');
const helperQrisLabel = document.getElementById('helper-qris-label');
const summaryTotal = document.getElementById('summary-total');
const receiptStore = document.getElementById('receipt-store');
const receiptDate = document.getElementById('receipt-date');
const receiptId = document.getElementById('receipt-id');
const receiptItems = document.getElementById('receipt-items');
const receiptTotal = document.getElementById('receipt-total');
const receiptPayment = document.getElementById('receipt-payment');
const receiptHelper = document.getElementById('receipt-helper');
const printBtn = document.getElementById('print-btn');
const resetBtn = document.getElementById('reset-btn');

const state = {
  products: [],
  items: [],
  store: null,
  method: 'cash',
  cashReceived: 0,
  helpers: {
    bankName: '',
    bankAccount: '',
    bankHolder: '',
    qrisLabel: ''
  },
  receiptId: ''
};

function generateReceiptId() {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timePart = now
    .toTimeString()
    .slice(0, 8)
    .replace(/:/g, '');
  return `STR-${datePart}-${timePart}`;
}

function pickSellPrice(product) {
  const defaultPrice = toNumber(product?.default_sell_price);
  if (defaultPrice != null && defaultPrice > 0) return defaultPrice;
  const lastPrice = toNumber(product?.last_sell_price);
  if (lastPrice != null && lastPrice > 0) return lastPrice;
  return 0;
}

function getHelperKey() {
  const storeId = getActiveStoreId();
  return `${HELPER_STORAGE_PREFIX}${storeId || 'default'}`;
}

function loadHelpers() {
  const key = getHelperKey();
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const saved = JSON.parse(raw);
      state.helpers = {
        bankName: String(saved?.bankName || ''),
        bankAccount: String(saved?.bankAccount || ''),
        bankHolder: String(saved?.bankHolder || ''),
        qrisLabel: String(saved?.qrisLabel || '')
      };
    }
  } catch (err) {
    // ignore storage errors
  }
  syncHelperInputs();
}

function saveHelpers() {
  const key = getHelperKey();
  try {
    window.localStorage.setItem(key, JSON.stringify(state.helpers));
  } catch (err) {
    // ignore storage errors
  }
}

function syncHelperInputs() {
  if (helperBankName) helperBankName.value = state.helpers.bankName;
  if (helperBankAccount) helperBankAccount.value = state.helpers.bankAccount;
  if (helperBankHolder) helperBankHolder.value = state.helpers.bankHolder;
  if (helperQrisLabel) helperQrisLabel.value = state.helpers.qrisLabel;
}

function updateHelperState() {
  state.helpers.bankName = helperBankName?.value.trim() || '';
  state.helpers.bankAccount = helperBankAccount?.value.trim() || '';
  state.helpers.bankHolder = helperBankHolder?.value.trim() || '';
  state.helpers.qrisLabel = helperQrisLabel?.value.trim() || '';
  saveHelpers();
  updatePaymentHelper();
  renderReceipt();
}

function renderProductOptions() {
  if (!productList) return;
  const options = [];
  state.products.forEach((product) => {
    if (!product?.name) return;
    options.push(`<option value="${escapeHtml(product.name)}"></option>`);
  });
  productList.innerHTML = options.join('');
}

function findProductByName(value) {
  const clean = String(value || '').trim().toLowerCase();
  if (!clean) return null;
  return (
    state.products.find(
      (product) => String(product?.name || '').trim().toLowerCase() === clean
    ) || null
  );
}

function handleProductChange() {
  if (!productInput) return;
  const value = productInput.value.trim();
  if (!value) {
    itemPriceInput.value = '';
    return;
  }

  const product = findProductByName(value);
  if (!product) return;
  const price = pickSellPrice(product);
  if (price > 0) {
    itemPriceInput.value = String(price);
    formatCurrencyInputValue(itemPriceInput);
  }
}

function getTotal() {
  return state.items.reduce((sum, item) => sum + item.qty * item.price, 0);
}

function renderSummary() {
  const total = getTotal();
  if (summaryTotal) summaryTotal.textContent = formatCurrency(total);
}

function renderItemsTable() {
  if (!itemRows) return;
  const rows = state.items
    .map((item, index) => {
      const lineTotal = item.qty * item.price;
      const unitLabel = item.unit ? escapeHtml(item.unit) : '-';
      return `
        <tr>
          <td>
            <div class="cell-title">${escapeHtml(item.name)}</div>
            <div class="cell-meta">${unitLabel}</div>
          </td>
          <td>
            <input
              class="input input-compact w-16"
              data-index="${index}"
              data-field="qty"
              type="number"
              min="1"
              step="1"
              value="${item.qty}"
            />
          </td>
          <td>
            <input
              class="input input-compact w-24"
              data-index="${index}"
              data-field="price"
              type="text"
              min="0"
              step="100"
              inputmode="numeric"
              data-currency
              value="${item.price}"
            />
          </td>
          <td>${formatCurrency(lineTotal)}</td>
          <td>
            <button class="ghost" type="button" data-action="remove" data-index="${index}">
              Hapus
            </button>
          </td>
        </tr>
      `;
    })
    .join('');

  itemRows.innerHTML = rows || '<tr><td colspan="5">Belum ada item.</td></tr>';
  initCurrencyInputs(itemRows);
}

function renderReceiptItems() {
  if (!receiptItems) return;
  if (!state.items.length) {
    receiptItems.innerHTML = '<div class="receipt-empty">Belum ada item.</div>';
    return;
  }

  const rows = state.items
    .map((item) => {
      const lineTotal = item.qty * item.price;
      return `
        <div class="receipt-item">
          <div>
            <div class="receipt-item-name">${escapeHtml(item.name)}</div>
            <div class="receipt-item-meta">
              ${formatNumber(item.qty)} x ${formatCurrency(item.price)}
            </div>
          </div>
          <div class="receipt-item-total">${formatCurrency(lineTotal)}</div>
        </div>
      `;
    })
    .join('');

  receiptItems.innerHTML = rows;
}

function updatePaymentHelper() {
  state.method = paymentMethod?.value || 'cash';
  const total = getTotal();
  const method = state.method;

  if (helperTitle) {
    helperTitle.textContent =
      method === 'cash'
        ? 'Cash'
        : method === 'transfer'
          ? 'Transfer bank'
          : 'QRIS';
  }

  if (cashHelper) {
    cashHelper.classList.toggle('hidden', method !== 'cash');
  }

  if (method === 'cash') {
    if (helperText) helperText.textContent = 'Hitung kembalian untuk pelanggan.';
    const received = toNumber(cashReceivedInput?.value) || 0;
    state.cashReceived = received;
    const change = received - total;
    if (cashChange) cashChange.textContent = formatCurrency(change);
  } else if (method === 'transfer') {
    const bank = state.helpers.bankName || '-';
    const account = state.helpers.bankAccount || '-';
    const holder = state.helpers.bankHolder || '-';
    if (helperText) {
      const hasDetails =
        state.helpers.bankName || state.helpers.bankAccount || state.helpers.bankHolder;
      helperText.textContent = hasDetails
        ? `Rek ${bank} ${account} a.n. ${holder}.`
        : 'Isi info pembayaran transfer.';
    }
  } else if (method === 'qris') {
    const label = state.helpers.qrisLabel || 'QRIS toko';
    if (helperText) {
      helperText.textContent = state.helpers.qrisLabel
        ? `Scan ${label}.`
        : 'Isi info QRIS.';
    }
  }
}

function renderReceipt() {
  if (receiptStore) {
    receiptStore.textContent = state.store?.name || 'Toko';
  }
  if (receiptDate) {
    receiptDate.textContent = new Date().toLocaleString('id-ID');
  }
  if (receiptId) {
    receiptId.textContent = state.receiptId || '-';
  }

  renderReceiptItems();

  const total = getTotal();
  if (receiptTotal) receiptTotal.textContent = formatCurrency(total);

  const method =
    state.method === 'cash'
      ? 'Cash'
      : state.method === 'transfer'
        ? 'Transfer bank'
        : 'QRIS';
  if (receiptPayment) receiptPayment.textContent = `Metode: ${method}`;

  if (receiptHelper) {
    if (state.method === 'cash') {
      const received = toNumber(cashReceivedInput?.value) || 0;
      const change = received - total;
      receiptHelper.textContent = `Tunai: ${formatCurrency(received)} | Kembalian: ${formatCurrency(change)}`;
    } else if (state.method === 'transfer') {
      const bank = state.helpers.bankName || '-';
      const account = state.helpers.bankAccount || '-';
      const holder = state.helpers.bankHolder || '-';
      const hasDetails =
        state.helpers.bankName || state.helpers.bankAccount || state.helpers.bankHolder;
      receiptHelper.textContent = hasDetails
        ? `Rek ${bank} ${account} a.n. ${holder}`
        : 'Info transfer belum diisi';
    } else {
      const label = state.helpers.qrisLabel || 'QRIS toko';
      receiptHelper.textContent = state.helpers.qrisLabel
        ? `QRIS: ${label}`
        : 'Info QRIS belum diisi';
    }
  }

  renderSummary();
}

async function fetchStore() {
  try {
    const data = await fetchJson('/api/store/active');
    state.store = data?.store || null;
  } catch (err) {
    state.store = null;
  }
}

async function fetchProducts() {
  try {
    const params = new URLSearchParams();
    const storeId = getActiveStoreId();
    if (storeId) params.set('storeId', storeId);
    const data = await fetchJson(`/api/products?${params.toString()}`);
    if (!data) return;
    state.products = (data.data || [])
      .map((item) => ({ ...item, id: Number(item.id) }))
      .filter((item) => item.is_active !== false);
    renderProductOptions();
  } catch (err) {
    state.products = [];
    renderProductOptions();
    showToast('Gagal memuat produk.', true);
  }
}

function resetForm() {
  state.items = [];
  state.receiptId = generateReceiptId();
  state.cashReceived = 0;
  if (itemForm) itemForm.reset();
  if (productInput) productInput.value = '';
  if (itemQtyInput) itemQtyInput.value = '1';
  if (paymentMethod) paymentMethod.value = 'cash';
  if (cashReceivedInput) cashReceivedInput.value = '';
  renderItemsTable();
  updatePaymentHelper();
  renderReceipt();
}

if (itemForm) {
  itemForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const selection = productInput?.value || '';
    const qtyRaw = toNumber(itemQtyInput?.value);
    const priceRaw = toNumber(itemPriceInput?.value);
    const qty = Number.isFinite(qtyRaw) ? Math.max(1, Math.floor(qtyRaw)) : 0;
    const price = Number.isFinite(priceRaw) ? Math.max(0, priceRaw) : 0;

    let name = '';
    let unit = '';
    const product = findProductByName(selection);
    if (product) {
      name = product.name || '';
      unit = product.unit || '';
    } else {
      name = String(selection || '').trim();
    }

    if (!name) {
      showToast('Nama barang wajib diisi.', true);
      return;
    }
    if (!qty || qty <= 0) {
      showToast('Qty harus lebih dari 0.', true);
      return;
    }
    if (!price || price <= 0) {
      showToast('Harga harus lebih dari 0.', true);
      return;
    }

    state.items.push({
      name,
      unit,
      qty,
      price
    });

    if (productInput) productInput.value = '';
    if (itemPriceInput) itemPriceInput.value = '';
    if (itemQtyInput) itemQtyInput.value = '1';

    renderItemsTable();
    renderReceipt();
  });
}

if (productInput) {
  productInput.addEventListener('input', handleProductChange);
}

if (itemRows) {
  itemRows.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest('button[data-action="remove"]');
    if (!button) return;
    const index = Number(button.dataset.index);
    if (!Number.isFinite(index)) return;
    state.items.splice(index, 1);
    renderItemsTable();
    renderReceipt();
  });

  itemRows.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const index = Number(target.dataset.index);
    const field = target.dataset.field;
    if (!Number.isFinite(index) || !state.items[index]) return;
    if (field === 'qty') {
      const qty = toNumber(target.value);
      state.items[index].qty = Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;
    }
    if (field === 'price') {
      const price = toNumber(target.value);
      state.items[index].price = Number.isFinite(price) && price > 0 ? price : 0;
    }
    renderItemsTable();
    renderReceipt();
  });
}

if (paymentMethod) {
  paymentMethod.addEventListener('change', () => {
    updatePaymentHelper();
    renderReceipt();
  });
}

if (cashReceivedInput) {
  cashReceivedInput.addEventListener('input', () => {
    updatePaymentHelper();
    renderReceipt();
  });
}

[helperBankName, helperBankAccount, helperBankHolder, helperQrisLabel].forEach((input) => {
  if (!input) return;
  input.addEventListener('input', updateHelperState);
});

if (printBtn) {
  printBtn.addEventListener('click', () => {
    window.print();
  });
}

if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    resetForm();
  });
}

window.addEventListener('store:change', async () => {
  await fetchStore();
  await fetchProducts();
  loadHelpers();
  resetForm();
});

(async function init() {
  await initNav('receipts');
  await fetchStore();
  await fetchProducts();
  state.receiptId = generateReceiptId();
  loadHelpers();
  renderItemsTable();
  updatePaymentHelper();
  renderReceipt();
})();
