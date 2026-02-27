import {
  escapeHtml,
  fetchJson,
  formatCurrency,
  formatCurrencyInputValue,
  formatNumber,
  getActiveStoreId,
  initCurrencyInputs,
  initPullToRefresh,
  initNav,
  showUndoSnack,
  showToast,
  triggerSwipeFeedback,
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
const queryParams = new URLSearchParams(window.location.search);
const receiptRowSwipe = {
  tracking: false,
  row: null,
  startX: 0,
  startY: 0,
  offsetX: 0
};

const state = {
  products: [],
  items: [],
  store: null,
  method: 'cash',
  cashReceived: 0,
  dirty: true,
  saved: false,
  saving: false,
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

function markDirty() {
  state.dirty = true;
  state.saved = false;
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
        <tr data-row-index="${index}">
          <td data-label="Barang">
            <div class="cell-title">${escapeHtml(item.name)}</div>
            <div class="cell-meta">${unitLabel}</div>
          </td>
          <td data-label="Qty">
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
          <td data-label="Harga">
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
          <td data-label="Total">${formatCurrency(lineTotal)}</td>
          <td data-label="Aksi">
            <button
              class="ghost table-icon-btn"
              type="button"
              data-action="remove"
              data-index="${index}"
              aria-label="Hapus item"
              title="Hapus item"
            >
              <svg class="action-icon-symbol" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path
                  d="M4 7h16M9 7V5h6v2M8 7v12m8-12v12M6 7l1 13h10l1-13"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                ></path>
              </svg>
              <span class="sr-only">Hapus</span>
            </button>
          </td>
        </tr>
      `;
    })
    .join('');

  itemRows.innerHTML = rows || '<tr class="receipt-row-empty"><td colspan="5">Belum ada item.</td></tr>';
  initCurrencyInputs(itemRows);
}

function bindReceiptRowSwipeToRemove() {
  if (!itemRows || itemRows.dataset.swipeBound === 'true') return;
  itemRows.dataset.swipeBound = 'true';
  const mobileQuery = window.matchMedia('(max-width: 1023px)');

  itemRows.addEventListener(
    'touchstart',
    (event) => {
      if (!mobileQuery.matches) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const row = event.target.closest('tr[data-row-index]');
      if (!row) return;
      receiptRowSwipe.tracking = true;
      receiptRowSwipe.row = row;
      receiptRowSwipe.startX = touch.clientX;
      receiptRowSwipe.startY = touch.clientY;
      receiptRowSwipe.offsetX = 0;
      row.style.transition = 'none';
      row.style.willChange = 'transform';
    },
    { passive: true }
  );

  itemRows.addEventListener(
    'touchmove',
    (event) => {
      if (!receiptRowSwipe.tracking || !receiptRowSwipe.row) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const deltaX = touch.clientX - receiptRowSwipe.startX;
      const deltaY = touch.clientY - receiptRowSwipe.startY;
      if (Math.abs(deltaY) > Math.abs(deltaX)) return;
      event.preventDefault();
      receiptRowSwipe.offsetX = Math.max(-108, Math.min(0, deltaX));
      receiptRowSwipe.row.style.transform = `translateX(${receiptRowSwipe.offsetX}px)`;
    },
    { passive: false }
  );

  const endSwipe = () => {
    if (!receiptRowSwipe.tracking || !receiptRowSwipe.row) return;
    const row = receiptRowSwipe.row;
    const shouldDelete = receiptRowSwipe.offsetX <= -72;
    const index = Number(row.dataset.rowIndex);

    receiptRowSwipe.tracking = false;
    receiptRowSwipe.row = null;
    receiptRowSwipe.offsetX = 0;
    row.style.willChange = '';
    row.style.transition = 'transform 160ms ease';
    row.style.transform = shouldDelete ? 'translateX(-112%)' : 'translateX(0px)';

    if (shouldDelete && Number.isFinite(index) && state.items[index]) {
      const removedItem = { ...state.items[index] };
      triggerSwipeFeedback(row, 'danger');
      window.setTimeout(() => {
        state.items.splice(index, 1);
        markDirty();
        renderItemsTable();
        renderReceipt();
        showUndoSnack({
          message: `${removedItem.name} dihapus dari struk.`,
          actionLabel: 'Batal',
          onUndo: () => {
            state.items.splice(index, 0, removedItem);
            markDirty();
            renderItemsTable();
            renderReceipt();
            showToast('Item dikembalikan.');
          }
        });
      }, 140);
      return;
    }

    window.setTimeout(() => {
      row.style.transition = '';
      row.style.transform = '';
    }, 170);
  };

  itemRows.addEventListener('touchend', endSwipe);
  itemRows.addEventListener('touchcancel', endSwipe);
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
  state.dirty = true;
  state.saved = false;
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
      productId: product?.id || null,
      qty,
      price
    });

    markDirty();
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
    markDirty();
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
    markDirty();
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

function setPrintLoading(loading) {
  if (!printBtn) return;
  printBtn.disabled = loading;
  printBtn.classList.toggle('is-loading', loading);
  const textNode = printBtn.querySelector('.action-icon-text');
  if (textNode) {
    textNode.textContent = loading ? 'Menyimpan...' : 'Print';
  } else {
    printBtn.textContent = loading ? 'Menyimpan...' : 'Print';
  }
}

async function saveReceiptTransactions() {
  if (!state.items.length) {
    throw new Error('empty_items');
  }

  const note = state.receiptId ? `receipt ${state.receiptId}` : 'receipt';

  for (let idx = 0; idx < state.items.length; idx += 1) {
    const item = state.items[idx];
    const payload = {
      type: 'OUT',
      qty: item.qty,
      sell_price: item.price,
      note
    };
    if (item.productId) {
      payload.product_id = item.productId;
    } else {
      payload.item = item.name;
    }
    await fetchJson('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }
}

if (printBtn) {
  printBtn.addEventListener('click', async () => {
    if (!state.items.length) {
      showToast('Tambah item dulu sebelum print.', true);
      return;
    }
    if (state.saving) return;

    if (!state.saved || state.dirty) {
      try {
        state.saving = true;
        setPrintLoading(true);
        await saveReceiptTransactions();
        state.saved = true;
        state.dirty = false;
        showToast('Transaksi tersimpan. Siap cetak struk.');
      } catch (err) {
        const message =
          err?.message === 'missing_cost'
            ? 'Harga modal belum diisi untuk salah satu produk.'
            : 'Gagal menyimpan transaksi. Coba lagi.';
        showToast(message, true);
        return;
      } finally {
        state.saving = false;
        setPrintLoading(false);
      }
    }

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
  initPullToRefresh({
    key: 'receipts',
    onRefresh: async () => {
      await fetchStore();
      await fetchProducts();
      renderReceipt();
    }
  });
  await fetchStore();
  await fetchProducts();
  state.receiptId = generateReceiptId();
  loadHelpers();
  renderItemsTable();
  bindReceiptRowSwipeToRemove();
  updatePaymentHelper();
  renderReceipt();
  const quickParam = String(queryParams.get('quick') || '').trim().toLowerCase();
  if (quickParam === 'focus' && productInput instanceof HTMLInputElement) {
    window.setTimeout(() => {
      productInput.focus();
      productInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 180);
  }
})();
