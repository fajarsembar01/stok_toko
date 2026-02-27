import {
  escapeHtml,
  fetchJson,
  formatCurrency,
  formatCurrencyInputValue,
  formatNumber,
  getActiveStoreId,
  initPullToRefresh,
  initNav,
  showToast,
  triggerSwipeFeedback,
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
const searchClearBtn = document.getElementById('search-clear');
const filterToggleBtn = document.getElementById('filter-toggle-btn');
const filterAdvanced = document.getElementById('filter-advanced');
const filterType = document.getElementById('filter-type');
const filterDate = document.getElementById('filter-date');
const sortChipRow = document.getElementById('sort-chip-row');
const sortDirectionBtn = document.getElementById('sort-direction-btn');
const refreshBtn = document.getElementById('refresh-btn');
const transactionRows = document.getElementById('transaction-rows');
const transactionMobileList = document.getElementById('transaction-mobile-list');
const transactionsGrid = document.getElementById('transactions-grid');
const transactionCard = document.getElementById('transaction-card');
const transactionBackdrop = document.getElementById('transaction-backdrop');
const toggleTransactionBtn = document.getElementById('toggle-transaction');
const queryParams = new URLSearchParams(window.location.search);

const state = {
  products: [],
  transactions: [],
  search: '',
  filterType: '',
  filterDate: '',
  sortKey: 'time',
  sortDirection: 'desc',
  selectedProductId: null,
  prefillProductId: null,
  prefillType: null,
  isLoadingTransactions: false
};

let searchTimer;
let isFilterPanelOpen = false;
const TRANSACTION_FORM_STORAGE_KEY = 'transactions:form-hidden';
const TRANSACTION_LIST_STORAGE_KEY = 'transactions:list-state';
const mobileFilterQuery = window.matchMedia('(max-width: 1023px)');
const formSwipeState = {
  tracking: false,
  startY: 0,
  startX: 0,
  offsetY: 0
};
const cardSwipeState = {
  tracking: false,
  card: null,
  startX: 0,
  startY: 0,
  offsetX: 0
};

function syncTransactionSheetState() {
  if (!transactionCard || !transactionsGrid) return;
  const hidden = transactionCard.classList.contains('hidden');
  const sheetMode = mobileFilterQuery.matches;
  transactionCard.classList.toggle('transaction-sheet-open', sheetMode && !hidden);
  if (transactionBackdrop) {
    transactionBackdrop.classList.toggle('hidden', !(sheetMode && !hidden));
  }
  document.body.classList.toggle('transactions-sheet-open', sheetMode && !hidden);
  if (sheetMode) {
    transactionsGrid.classList.add('form-hidden');
  } else {
    transactionsGrid.classList.toggle('form-hidden', hidden);
  }
}

function setTransactionFormHidden(hidden, shouldPersist = true) {
  if (!transactionCard || !transactionsGrid || !toggleTransactionBtn) return;
  transactionCard.classList.toggle('hidden', hidden);
  if (hidden) {
    transactionCard.style.transform = '';
    transactionCard.style.transition = '';
    transactionCard.style.willChange = '';
  }
  syncTransactionSheetState();
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
  if (mobileFilterQuery.matches) {
    setTransactionFormHidden(true, false);
    return;
  }
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

function syncSearchClear() {
  if (!searchInput || !searchClearBtn) return;
  const hasValue = Boolean(String(searchInput.value || '').trim());
  searchClearBtn.classList.toggle('hidden', !hasValue);
}

function persistListState() {
  try {
    const payload = {
      search: state.search || '',
      filterType: state.filterType || '',
      filterDate: state.filterDate || '',
      sortKey: state.sortKey || 'time',
      sortDirection: state.sortDirection || 'desc',
      filterOpen: Boolean(isFilterPanelOpen)
    };
    localStorage.setItem(TRANSACTION_LIST_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    // Ignore storage errors.
  }
}

function loadListState() {
  try {
    const raw = localStorage.getItem(TRANSACTION_LIST_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.search = String(saved?.search || '').trim();
    state.filterType = String(saved?.filterType || '');
    state.filterDate = String(saved?.filterDate || '');
    state.sortKey = saved?.sortKey === 'total' ? 'total' : 'time';
    state.sortDirection = saved?.sortDirection === 'asc' ? 'asc' : 'desc';
    isFilterPanelOpen = Boolean(saved?.filterOpen);

    if (searchInput) searchInput.value = state.search;
    if (filterType) filterType.value = state.filterType;
    if (filterDate) filterDate.value = state.filterDate;
  } catch (err) {
    // Ignore malformed storage data.
  }
}

function syncSortControls() {
  if (sortChipRow) {
    const chips = sortChipRow.querySelectorAll('[data-sort-key]');
    for (const chip of chips) {
      const key = chip.dataset.sortKey;
      const active = key === state.sortKey;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  if (!sortDirectionBtn) return;
  const isDesc = state.sortDirection === 'desc';
  sortDirectionBtn.classList.toggle('desc', isDesc);
  const label = isDesc ? 'Urutan turun' : 'Urutan naik';
  sortDirectionBtn.setAttribute('aria-label', label);
  sortDirectionBtn.setAttribute('title', label);
}

function setSortKey(nextKey) {
  if (!nextKey) return;
  if (state.sortKey === nextKey) {
    state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
  } else {
    state.sortKey = nextKey;
  }
  syncSortControls();
  persistListState();
  renderTransactions();
}

function toggleSortDirection() {
  state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
  syncSortControls();
  persistListState();
  renderTransactions();
}

function setFilterPanelOpen(open) {
  if (!filterAdvanced || !filterToggleBtn) return;
  isFilterPanelOpen = Boolean(open);

  if (mobileFilterQuery.matches) {
    filterAdvanced.classList.toggle('hidden', !isFilterPanelOpen);
    if (sortChipRow) sortChipRow.classList.toggle('hidden', !isFilterPanelOpen);
  } else {
    filterAdvanced.classList.remove('hidden');
    if (sortChipRow) sortChipRow.classList.remove('hidden');
  }

  filterAdvanced.classList.toggle('open', isFilterPanelOpen);
  if (sortChipRow) sortChipRow.classList.toggle('open', isFilterPanelOpen);
  filterToggleBtn.classList.toggle('active', isFilterPanelOpen);
  filterToggleBtn.setAttribute('aria-expanded', isFilterPanelOpen ? 'true' : 'false');
  const label = isFilterPanelOpen
    ? 'Sembunyikan filter dan urutan'
    : 'Tampilkan filter dan urutan';
  filterToggleBtn.setAttribute('aria-label', label);
  filterToggleBtn.setAttribute('title', label);
  persistListState();
}

function syncFilterPanelByViewport() {
  if (!filterAdvanced || !filterToggleBtn) return;
  if (mobileFilterQuery.matches) {
    setFilterPanelOpen(isFilterPanelOpen);
    return;
  }
  isFilterPanelOpen = true;
  filterAdvanced.classList.remove('hidden');
  filterAdvanced.classList.add('open');
  if (sortChipRow) {
    sortChipRow.classList.remove('hidden');
    sortChipRow.classList.add('open');
  }
  filterToggleBtn.classList.remove('active');
  filterToggleBtn.setAttribute('aria-expanded', 'true');
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

function prefillFormFromTransactionCard(item, type, qty, price) {
  if (!form) return;
  const normalizedType = ['IN', 'OUT', 'DAMAGE'].includes(type) ? type : 'OUT';
  setTransactionFormHidden(false);
  typeSelect.value = normalizedType;
  updateTypeFields();

  const cleanItem = String(item || '').trim();
  const match = state.products.find(
    (product) => String(product?.name || '').trim().toLowerCase() === cleanItem.toLowerCase()
  );
  if (match) {
    productSelect.value = String(match.id);
  } else if (cleanItem) {
    productSelect.value = '__new__';
    if (newProductInput) newProductInput.value = cleanItem;
  }
  syncSelectedProduct();

  const qtyValue = toNumber(qty);
  if (Number.isFinite(qtyValue) && qtyValue > 0) {
    form.elements.qty.value = String(Math.max(1, Math.floor(qtyValue)));
  }

  const priceValue = toNumber(price);
  if (Number.isFinite(priceValue) && priceValue > 0) {
    if (normalizedType === 'IN') {
      form.elements.buy_price.value = String(priceValue);
      formatCurrencyInputValue(form.elements.buy_price);
    } else if (normalizedType === 'OUT') {
      form.elements.sell_price.value = String(priceValue);
      formatCurrencyInputValue(form.elements.sell_price);
    }
  }

  form.elements.qty?.focus();
}

function setupTransactionSheetSwipeToClose() {
  if (!transactionCard || transactionCard.dataset.swipeBound === 'true') return;
  transactionCard.dataset.swipeBound = 'true';

  transactionCard.addEventListener(
    'touchstart',
    (event) => {
      if (!mobileFilterQuery.matches || transactionCard.classList.contains('hidden')) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const handle = event.target.closest('.sheet-grab, .card-head');
      if (!handle || !transactionCard.contains(handle)) return;
      formSwipeState.tracking = true;
      formSwipeState.startY = touch.clientY;
      formSwipeState.startX = touch.clientX;
      formSwipeState.offsetY = 0;
      transactionCard.style.transition = 'none';
      transactionCard.style.willChange = 'transform';
    },
    { passive: true }
  );

  transactionCard.addEventListener(
    'touchmove',
    (event) => {
      if (!formSwipeState.tracking) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const deltaY = touch.clientY - formSwipeState.startY;
      const deltaX = touch.clientX - formSwipeState.startX;
      if (deltaY <= 0 || Math.abs(deltaY) < Math.abs(deltaX)) return;
      event.preventDefault();
      formSwipeState.offsetY = Math.min(deltaY, 280);
      transactionCard.style.transform = `translateY(${formSwipeState.offsetY}px)`;
    },
    { passive: false }
  );

  const endSwipe = () => {
    if (!formSwipeState.tracking) return;
    const offsetY = formSwipeState.offsetY;
    formSwipeState.tracking = false;
    formSwipeState.offsetY = 0;
    transactionCard.style.willChange = '';
    transactionCard.style.transition = 'transform 170ms ease';

    if (offsetY > 88) {
      setTransactionFormHidden(true);
      transactionCard.style.transform = '';
      transactionCard.style.transition = '';
      return;
    }

    transactionCard.style.transform = 'translateY(0px)';
    window.setTimeout(() => {
      if (transactionCard.classList.contains('hidden')) return;
      transactionCard.style.transform = '';
      transactionCard.style.transition = '';
    }, 180);
  };

  transactionCard.addEventListener('touchend', endSwipe);
  transactionCard.addEventListener('touchcancel', endSwipe);
}

function bindTransactionCardSwipeActions() {
  if (!transactionMobileList || transactionMobileList.dataset.swipeBound === 'true') return;
  transactionMobileList.dataset.swipeBound = 'true';

  transactionMobileList.addEventListener(
    'touchstart',
    (event) => {
      if (!mobileFilterQuery.matches) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const card = event.target.closest('.transaction-mobile-card');
      if (!card) return;
      cardSwipeState.tracking = true;
      cardSwipeState.card = card;
      cardSwipeState.startX = touch.clientX;
      cardSwipeState.startY = touch.clientY;
      cardSwipeState.offsetX = 0;
      card.style.willChange = 'transform';
      card.style.transition = 'none';
    },
    { passive: true }
  );

  transactionMobileList.addEventListener(
    'touchmove',
    (event) => {
      if (!cardSwipeState.tracking || !cardSwipeState.card) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const deltaX = touch.clientX - cardSwipeState.startX;
      const deltaY = touch.clientY - cardSwipeState.startY;
      if (Math.abs(deltaY) > Math.abs(deltaX)) return;
      event.preventDefault();
      cardSwipeState.offsetX = Math.max(-96, Math.min(96, deltaX));
      cardSwipeState.card.style.transform = `translateX(${cardSwipeState.offsetX}px)`;
    },
    { passive: false }
  );

  const endSwipe = () => {
    if (!cardSwipeState.tracking || !cardSwipeState.card) return;
    const card = cardSwipeState.card;
    const deltaX = cardSwipeState.offsetX;
    cardSwipeState.tracking = false;
    cardSwipeState.card = null;
    cardSwipeState.offsetX = 0;
    card.style.willChange = '';
    card.style.transition = 'transform 160ms ease';
    card.style.transform = 'translateX(0px)';

    if (deltaX <= -72) {
      const item = String(card.dataset.item || '').trim();
      if (item) {
        triggerSwipeFeedback(card, 'success');
        window.location.href = `/products?search=${encodeURIComponent(item)}`;
      }
      return;
    }

    if (deltaX >= 72) {
      triggerSwipeFeedback(card, 'success');
      prefillFormFromTransactionCard(
        card.dataset.item,
        card.dataset.type,
        card.dataset.qty,
        card.dataset.price
      );
      showToast('Form diprefill dari swipe kartu.');
    }
  };

  transactionMobileList.addEventListener('touchend', endSwipe);
  transactionMobileList.addEventListener('touchcancel', endSwipe);
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

function getSortedTransactions() {
  const direction = state.sortDirection === 'desc' ? -1 : 1;
  const list = [...state.transactions];
  list.sort((left, right) => {
    if (state.sortKey === 'total') {
      const leftTotal = toNumber(left?.total) || 0;
      const rightTotal = toNumber(right?.total) || 0;
      return (leftTotal - rightTotal) * direction;
    }
    const leftTime = new Date(left?.created_at || 0).getTime() || 0;
    const rightTime = new Date(right?.created_at || 0).getTime() || 0;
    return (leftTime - rightTime) * direction;
  });
  return list;
}

function renderTransactionSkeleton(count = 6) {
  const rows = Array.from({ length: count }, (_, index) => {
    return `
      <tr class="table-skeleton-row" aria-hidden="true" style="animation-delay:${index * 28}ms">
        <td><span class="audit-skeleton-line w-24"></span></td>
        <td><span class="audit-skeleton-line w-16"></span></td>
        <td><span class="audit-skeleton-line w-24"></span></td>
        <td><span class="audit-skeleton-line w-10"></span></td>
        <td class="optional-col"><span class="audit-skeleton-line w-16"></span></td>
        <td><span class="audit-skeleton-line w-20"></span></td>
        <td class="optional-col"><span class="audit-skeleton-line w-24"></span></td>
      </tr>
    `;
  }).join('');
  transactionRows.innerHTML = rows;

  if (!transactionMobileList) return;
  transactionMobileList.innerHTML = Array.from({ length: Math.min(count, 5) }, (_, index) => {
    return `
      <article class="transaction-mobile-card" aria-hidden="true" style="animation-delay:${index * 28}ms">
        <span class="audit-skeleton-line w-20"></span>
        <span class="audit-skeleton-line w-28"></span>
        <span class="audit-skeleton-line w-24"></span>
      </article>
    `;
  }).join('');
}

function renderTransactions() {
  if (state.isLoadingTransactions) {
    renderTransactionSkeleton();
    return;
  }

  const transactions = getSortedTransactions();
  const rows = transactions
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
          <td class="optional-col">${formatCurrency(tx.unit_price)}</td>
          <td>${formatCurrency(tx.total)}</td>
          <td class="optional-col">${note}</td>
        </tr>
      `;
    })
    .join('');

  transactionRows.innerHTML = rows ||
    '<tr><td colspan="7">Belum ada transaksi.</td></tr>';

  if (!transactionMobileList) return;
  const cards = transactions
    .map((tx) => {
      const date = new Date(tx.created_at);
      const dateLabel = Number.isNaN(date.getTime())
        ? '-'
        : date.toLocaleString('id-ID');
      const typeLabel = getTypeLabel(tx.type);
      const typeClass = getTypeClass(tx.type);
      const unitLabel = tx.unit ? escapeHtml(tx.unit) : '';
      const note = tx.note
        ? `<div class="transaction-mobile-note">${escapeHtml(tx.note)}</div>`
        : '';
      const qtyLabel = unitLabel
        ? `${formatNumber(tx.qty)} ${unitLabel}`
        : formatNumber(tx.qty);
      return `
        <article class="transaction-mobile-card" data-item="${escapeHtml(tx.item || '')}" data-type="${escapeHtml(tx.type || '')}" data-qty="${escapeHtml(tx.qty || '')}" data-price="${escapeHtml(tx.unit_price || '')}">
          <div class="transaction-mobile-head">
            <div>
              <div class="cell-title">${escapeHtml(tx.item)}</div>
              <div class="cell-meta">${dateLabel}</div>
            </div>
            <span class="status-pill ${typeClass}">${typeLabel}</span>
          </div>
          <div class="transaction-mobile-metrics">
            <div class="transaction-mobile-metric">
              <span>Qty</span>
              <strong>${qtyLabel}</strong>
            </div>
            <div class="transaction-mobile-metric">
              <span>Total</span>
              <strong>${formatCurrency(tx.total)}</strong>
            </div>
            <div class="transaction-mobile-metric">
              <span>Harga</span>
              <strong>${formatCurrency(tx.unit_price)}</strong>
            </div>
          </div>
          ${note}
        </article>
      `;
    })
    .join('');

  transactionMobileList.innerHTML = cards || '<div class="transaction-mobile-empty">Belum ada transaksi.</div>';
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
  state.isLoadingTransactions = true;
  renderTransactions();
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
  } catch (err) {
    showToast('Gagal memuat transaksi.', true);
  } finally {
    state.isLoadingTransactions = false;
    renderTransactions();
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
    syncSearchClear();
    persistListState();
    searchTimer = setTimeout(fetchTransactions, 300);
  });
}

if (searchClearBtn && searchInput) {
  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.search = '';
    syncSearchClear();
    persistListState();
    fetchTransactions();
    searchInput.focus();
  });
}

if (filterType) {
  filterType.addEventListener('change', (event) => {
    state.filterType = event.target.value;
    persistListState();
    fetchTransactions();
  });
}

if (filterDate) {
  const handleDateChange = (event) => {
    state.filterDate = event.target.value;
    persistListState();
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

if (filterToggleBtn) {
  filterToggleBtn.addEventListener('click', () => {
    setFilterPanelOpen(!isFilterPanelOpen);
  });
}

if (sortChipRow) {
  sortChipRow.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-sort-key]');
    if (!chip) return;
    setSortKey(chip.dataset.sortKey);
  });
}

if (sortDirectionBtn) {
  sortDirectionBtn.addEventListener('click', toggleSortDirection);
}

const handleViewportChange = () => {
  syncFilterPanelByViewport();
  syncTransactionSheetState();
  if (mobileFilterQuery.matches) {
    setTransactionFormHidden(true, false);
  }
};

if (mobileFilterQuery?.addEventListener) {
  mobileFilterQuery.addEventListener('change', handleViewportChange);
} else if (mobileFilterQuery?.addListener) {
  mobileFilterQuery.addListener(handleViewportChange);
}

if (toggleTransactionBtn) {
  toggleTransactionBtn.addEventListener('click', () => {
    const isHidden = transactionCard?.classList.contains('hidden');
    setTransactionFormHidden(!isHidden);
  });
}

if (transactionBackdrop) {
  transactionBackdrop.addEventListener('click', () => {
    setTransactionFormHidden(true);
  });
}

window.addEventListener('store:change', () => {
  state.selectedProductId = null;
  form.reset();
  updateTypeFields();
  fetchProducts();
  fetchTransactions();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (mobileFilterQuery.matches && transactionCard && !transactionCard.classList.contains('hidden')) {
    setTransactionFormHidden(true);
  }
});

(async function init() {
  await initNav('transactions');
  loadTransactionFormState();
  loadListState();
  const searchPreset = String(queryParams.get('search') || '').trim();
  if (searchPreset) {
    state.search = searchPreset;
    if (searchInput) searchInput.value = searchPreset;
  }

  const typeParam = String(queryParams.get('type') || '').toUpperCase();
  if (['IN', 'OUT', 'DAMAGE'].includes(typeParam)) {
    state.prefillType = typeParam;
    typeSelect.value = typeParam;
  }
  const productParam = Number(queryParams.get('productId') || queryParams.get('product_id'));
  if (Number.isFinite(productParam) && productParam > 0) {
    state.prefillProductId = productParam;
  }
  const quickParam = String(queryParams.get('quick') || '').trim().toLowerCase();
  syncSearchClear();
  syncSortControls();
  syncFilterPanelByViewport();
  syncTransactionSheetState();
  setupTransactionSheetSwipeToClose();
  bindTransactionCardSwipeActions();
  initPullToRefresh({
    key: 'transactions',
    onRefresh: async () => {
      await fetchProducts();
      await fetchTransactions();
    }
  });
  updateTypeFields();
  await fetchProducts();
  await fetchTransactions();
  if (quickParam === 'create') {
    setTransactionFormHidden(false, false);
  }
})();
