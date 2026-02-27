import {
  escapeHtml,
  fetchJson,
  formatCurrency,
  formatCurrencyInputValue,
  formatNumber,
  getActiveStoreId,
  initPullToRefresh,
  initNav,
  showUndoSnack,
  showToast,
  triggerSwipeFeedback,
  toNumber
} from './shared.js';

const productRows = document.getElementById('product-rows');
const productMobileList = document.getElementById('product-mobile-list');
const topStoreSelect = document.getElementById('store-select');
const mobileStoreSelect = document.getElementById('mobile-store-select');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear');
const filterToggleBtn = document.getElementById('filter-toggle-btn');
const filterAdvanced = document.getElementById('filter-advanced');
const filterCategory = document.getElementById('filter-category');
const sortChipRow = document.getElementById('sort-chip-row');
const sortDirectionBtn = document.getElementById('sort-direction-btn');
const toggleInactive = document.getElementById('toggle-inactive');
const refreshBtn = document.getElementById('refresh-btn');
const createForm = document.getElementById('create-form');
const productsGrid = document.getElementById('products-grid');
const createCard = document.getElementById('create-card');
const toggleCreateBtn = document.getElementById('toggle-create');
const createBackdrop = document.getElementById('create-backdrop');
const closeCreateBtn = document.getElementById('close-create');
const drawer = document.getElementById('drawer');
const drawerBackdrop = document.getElementById('drawer-backdrop');
const drawerTitle = document.getElementById('drawer-title');
const drawerSummary = document.getElementById('drawer-summary');
const closeDrawerBtn = document.getElementById('close-drawer');
const editForm = document.getElementById('edit-form');
const deactivateBtn = document.getElementById('deactivate-btn');
const quickModal = document.getElementById('quick-modal');
const quickModalCard = quickModal?.querySelector('.quick-modal-card') || null;
const quickForm = document.getElementById('quick-form');
const quickProductName = document.getElementById('quick-product-name');
const quickProductMeta = document.getElementById('quick-product-meta');
const quickType = document.getElementById('quick-type');
const quickPriceFields = document.getElementById('quick-price-fields');
const quickBuyField = document.getElementById('quick-buy-field');
const quickSellField = document.getElementById('quick-sell-field');
const quickPriceHint = document.getElementById('quick-price-hint');
const categorySelect = document.getElementById('category-select');
const categoryInputWrap = document.getElementById('category-input-wrap');
const categoryInput = document.getElementById('category-input');
const editCategorySelect = document.getElementById('edit-category-select');
const editCategoryInputWrap = document.getElementById('edit-category-input-wrap');
const editCategoryInput = document.getElementById('edit-category-input');
const createImageFile = document.getElementById('create-image-file');
const createImageAdjust = document.getElementById('create-image-adjust');
const createImageCanvas = document.getElementById('create-image-canvas');
const createImageZoom = document.getElementById('create-image-zoom');
const createImageX = document.getElementById('create-image-x');
const createImageY = document.getElementById('create-image-y');
const createImageReset = document.getElementById('create-image-reset');
const editImageFile = document.getElementById('edit-image-file');
const editImagePreview = document.getElementById('edit-image-preview');
const editImageAdjust = document.getElementById('edit-image-adjust');
const editImageCanvas = document.getElementById('edit-image-canvas');
const editImageZoom = document.getElementById('edit-image-zoom');
const editImageX = document.getElementById('edit-image-x');
const editImageY = document.getElementById('edit-image-y');
const editImageReset = document.getElementById('edit-image-reset');
const clearImageBtn = document.getElementById('clear-image-btn');
const pageParams = new URLSearchParams(window.location.search);

const CATEGORY_NEW = '__new__';
const CREATE_FORM_STORAGE_KEY = 'products:create-form-hidden';
const PRODUCTS_LIST_STORAGE_KEY = 'products:list-state';
const MAX_IMAGE_BYTES = 100 * 1024;
const IMAGE_MIN_DIM = 320;
const IMAGE_OUTPUT_SIZE = 640;
const IMAGE_MAX_ZOOM = 3;

const state = {
  products: [],
  categories: [],
  search: '',
  filterCategory: '',
  sortKey: 'name',
  sortDirection: 'asc',
  includeInactive: false,
  criticalOnly: false,
  isLoadingProducts: false,
  selected: null,
  quickProduct: null,
  expandedMobileIds: new Set(),
  createImage: null,
  editImage: null,
  editImageRemove: false
};

let searchTimer;
let isFilterPanelOpen = false;
const mobileFilterQuery = window.matchMedia('(max-width: 1023px)');
let storeSelectObserver;
let fetchProductsRequestId = 0;
let queryCommandApplied = false;
const quickSwipeState = {
  tracking: false,
  startY: 0,
  startX: 0,
  offsetY: 0
};
const mobileCardSwipeState = {
  tracking: false,
  card: null,
  startX: 0,
  startY: 0,
  offsetX: 0
};

function syncSearchClear() {
  if (!searchClearBtn || !searchInput) return;
  const hasValue = Boolean(String(searchInput.value || '').trim());
  searchClearBtn.classList.toggle('hidden', !hasValue);
}

function persistListState() {
  try {
    const payload = {
      search: state.search || '',
      filterCategory: normalizeCategory(state.filterCategory),
      includeInactive: Boolean(state.includeInactive),
      sortKey: state.sortKey || 'name',
      sortDirection: state.sortDirection || 'asc',
      filterOpen: Boolean(isFilterPanelOpen)
    };
    localStorage.setItem(PRODUCTS_LIST_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    // Ignore storage errors.
  }
}

function loadListState() {
  try {
    const raw = localStorage.getItem(PRODUCTS_LIST_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.search = String(saved?.search || '').trim();
    state.filterCategory = normalizeCategory(saved?.filterCategory);
    state.includeInactive = Boolean(saved?.includeInactive);
    state.sortKey = ['name', 'stock', 'buy'].includes(saved?.sortKey)
      ? saved.sortKey
      : 'name';
    state.sortDirection = saved?.sortDirection === 'desc' ? 'desc' : 'asc';
    isFilterPanelOpen = Boolean(saved?.filterOpen);

    if (searchInput) searchInput.value = state.search;
  } catch (err) {
    // Ignore malformed storage data.
  }
}

function applyUrlListPreset() {
  const targetProductId = Number(pageParams.get('productId') || pageParams.get('product_id'));
  if (Number.isFinite(targetProductId) && targetProductId > 0) {
    state.search = '';
    state.filterCategory = '';
  }

  const searchPreset = String(pageParams.get('search') || '').trim();
  if (searchPreset) {
    state.search = searchPreset;
    if (searchInput) searchInput.value = searchPreset;
  }

  const stockPreset = String(pageParams.get('stock') || '').trim().toLowerCase();
  if (stockPreset === 'critical') {
    state.criticalOnly = true;
    state.sortKey = 'stock';
    state.sortDirection = 'asc';
  }
}

function applyUrlActionAfterData() {
  if (queryCommandApplied) return;
  const quick = String(pageParams.get('quick') || '').trim().toLowerCase();
  const productIdParam = Number(pageParams.get('productId') || pageParams.get('product_id'));

  if (quick === 'create') {
    queryCommandApplied = true;
    setCreateFormHidden(false);
    createForm?.elements?.name?.focus();
    return;
  }

  if (!Number.isFinite(productIdParam) || productIdParam <= 0) return;
  const product = state.products.find((item) => Number(item.id) === productIdParam);
  if (!product) return;

  queryCommandApplied = true;
  if (quick === 'restock') {
    openQuickModal(product, 'IN');
    return;
  }

  state.selected = product;
  renderDrawer(product);
}

function syncMobileStoreSelect() {
  if (!topStoreSelect || !mobileStoreSelect) return;
  mobileStoreSelect.innerHTML = topStoreSelect.innerHTML;
  mobileStoreSelect.disabled = Boolean(topStoreSelect.disabled);
  mobileStoreSelect.value = topStoreSelect.value;
}

function bindMobileStoreSelect() {
  if (!topStoreSelect || !mobileStoreSelect) return;
  syncMobileStoreSelect();

  mobileStoreSelect.addEventListener('change', () => {
    const next = String(mobileStoreSelect.value || '');
    if (!next || topStoreSelect.value === next) return;
    topStoreSelect.value = next;
    topStoreSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });

  topStoreSelect.addEventListener('change', syncMobileStoreSelect);
  window.addEventListener('store:change', syncMobileStoreSelect);

  if (typeof MutationObserver !== 'undefined' && !storeSelectObserver) {
    storeSelectObserver = new MutationObserver(syncMobileStoreSelect);
    storeSelectObserver.observe(topStoreSelect, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled']
    });
  }
}

function syncInactiveToggle() {
  if (!toggleInactive || toggleInactive instanceof HTMLInputElement) return;
  const active = Boolean(state.includeInactive);
  toggleInactive.classList.toggle('active', active);
  toggleInactive.setAttribute('aria-pressed', active ? 'true' : 'false');
  const label = active
    ? 'Sembunyikan produk nonaktif'
    : 'Tampilkan produk nonaktif';
  toggleInactive.setAttribute('aria-label', label);
  toggleInactive.setAttribute('title', label);
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
  const isAsc = state.sortDirection === 'asc';
  sortDirectionBtn.classList.toggle('desc', !isAsc);
  const label = isAsc ? 'Urutan naik' : 'Urutan turun';
  sortDirectionBtn.setAttribute('aria-label', label);
  sortDirectionBtn.setAttribute('title', label);
}

function setSortKey(nextKey) {
  if (!nextKey) return;
  if (state.sortKey === nextKey) {
    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortKey = nextKey;
    state.sortDirection = 'asc';
  }
  syncSortControls();
  persistListState();
  renderTable();
}

function toggleSortDirection() {
  state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
  syncSortControls();
  persistListState();
  renderTable();
}

function isCreateSheetMode() {
  return mobileFilterQuery.matches;
}

function isCreateFormVisible() {
  return Boolean(createCard && !createCard.classList.contains('hidden'));
}

function syncPageScrollLock() {
  const hasOpenDrawer = Boolean(drawer?.classList.contains('open'));
  const hasOpenQuickModal = Boolean(quickModal && !quickModal.classList.contains('hidden'));
  const hasOpenCreateSheet = isCreateSheetMode() && isCreateFormVisible();
  document.body.classList.toggle(
    'products-scroll-lock',
    hasOpenDrawer || hasOpenQuickModal || hasOpenCreateSheet
  );
  document.body.classList.toggle('products-create-open', hasOpenCreateSheet);
}

function bindViewportSafeArea() {
  if (!window.visualViewport) return;

  const syncKeyboardOffset = () => {
    const viewportHeight = window.visualViewport.height;
    const offsetTop = window.visualViewport.offsetTop;
    const keyboardOffset = Math.max(0, Math.round(window.innerHeight - viewportHeight - offsetTop));
    document.documentElement.style.setProperty('--products-keyboard-offset', `${keyboardOffset}px`);
    document.body.classList.toggle('products-keyboard-open', keyboardOffset > 120);
  };

  window.visualViewport.addEventListener('resize', syncKeyboardOffset);
  window.visualViewport.addEventListener('scroll', syncKeyboardOffset);
  window.addEventListener('orientationchange', syncKeyboardOffset);
  syncKeyboardOffset();
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
  const label = isFilterPanelOpen ? 'Sembunyikan filter dan urutan' : 'Tampilkan filter dan urutan';
  filterToggleBtn.setAttribute('aria-label', label);
  filterToggleBtn.setAttribute('title', label);
  persistListState();
}

function syncFilterPanelByViewport() {
  if (!filterAdvanced || !filterToggleBtn) return;
  if (mobileFilterQuery.matches) {
    setFilterPanelOpen(isFilterPanelOpen);
  } else {
    filterAdvanced.classList.remove('hidden');
    filterAdvanced.classList.add('open');
    if (sortChipRow) {
      sortChipRow.classList.remove('hidden');
      sortChipRow.classList.add('open');
    }
    filterToggleBtn.setAttribute('aria-expanded', 'true');
    filterToggleBtn.classList.remove('active');
  }
}

function setCreateFormHidden(hidden, shouldPersist = true) {
  if (!createCard || !productsGrid || !toggleCreateBtn) return;
  const useSheetMode = isCreateSheetMode();
  createCard.classList.toggle('hidden', hidden);
  createCard.classList.toggle('create-sheet-open', useSheetMode && !hidden);
  if (createBackdrop) {
    createBackdrop.classList.toggle('hidden', !(useSheetMode && !hidden));
  }
  if (useSheetMode) {
    productsGrid.classList.add('form-hidden');
  } else {
    productsGrid.classList.toggle('form-hidden', hidden);
  }
  const label = hidden ? 'Tambah barang' : 'Tutup form tambah barang';
  toggleCreateBtn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  toggleCreateBtn.setAttribute('aria-label', label);
  toggleCreateBtn.setAttribute('title', label);
  const icon = toggleCreateBtn.querySelector('.fab-icon');
  if (icon) icon.textContent = hidden ? '+' : 'x';
  syncPageScrollLock();
  if (!shouldPersist || useSheetMode) return;
  try {
    localStorage.setItem(CREATE_FORM_STORAGE_KEY, hidden ? '1' : '0');
  } catch (err) {
    // Ignore storage errors (private mode, etc.)
  }
}

function syncCreateFormByViewport() {
  if (!createCard || !productsGrid) return;
  const hidden = createCard.classList.contains('hidden');
  const useSheetMode = isCreateSheetMode();
  createCard.classList.toggle('create-sheet-open', useSheetMode && !hidden);
  if (createBackdrop) {
    createBackdrop.classList.toggle('hidden', !(useSheetMode && !hidden));
  }
  if (useSheetMode) {
    productsGrid.classList.add('form-hidden');
  } else {
    productsGrid.classList.toggle('form-hidden', hidden);
  }
  syncPageScrollLock();
}

function loadCreateFormState() {
  if (!toggleCreateBtn || !createCard || !productsGrid) return;
  if (isCreateSheetMode()) {
    setCreateFormHidden(true, false);
    return;
  }
  try {
    const saved = localStorage.getItem(CREATE_FORM_STORAGE_KEY);
    if (saved === '0') {
      setCreateFormHidden(false, false);
    } else {
      setCreateFormHidden(true, false);
    }
  } catch (err) {
    // Ignore storage errors.
  }
}

function openDrawer() {
  if (!drawer) return;
  drawer.classList.add('open');
  if (drawerBackdrop) drawerBackdrop.classList.remove('hidden');
  syncPageScrollLock();
}

function closeDrawer() {
  if (!drawer) return;
  drawer.classList.remove('open');
  if (drawerBackdrop) drawerBackdrop.classList.add('hidden');
  syncPageScrollLock();
}

function pickPrice(product, key) {
  const defaultValue = toNumber(product[`default_${key}_price`]);
  if (defaultValue !== null) return defaultValue;
  return toNumber(product[`last_${key}_price`]);
}

function normalizeCategory(value) {
  return String(value || '').trim();
}

function uniqueCategories(items) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const clean = normalizeCategory(item);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function renderCategoryFilter() {
  if (!filterCategory) return;
  const options = ['<option value="">Kategori</option>'];
  for (const category of state.categories) {
    const safe = escapeHtml(category);
    options.push(`<option value="${safe}">${safe}</option>`);
  }
  filterCategory.innerHTML = options.join('');

  const normalized = normalizeCategory(state.filterCategory);
  const match = state.categories.find(
    (category) => category.toLowerCase() === normalized.toLowerCase()
  );
  if (normalized && match) {
    filterCategory.value = match;
    state.filterCategory = match;
  } else {
    filterCategory.value = '';
    state.filterCategory = '';
  }
}

function renderCategorySelect(select, selectedValue) {
  if (!select) return;
  const hasCategories = state.categories.length > 0;
  const options = ['<option value=\"\">Tanpa kategori</option>'];
  for (const category of state.categories) {
    const safe = escapeHtml(category);
    options.push(`<option value=\"${safe}\">${safe}</option>`);
  }
  options.push(`<option value=\"${CATEGORY_NEW}\">+ Kategori baru</option>`);
  select.innerHTML = options.join('');

  const normalized = normalizeCategory(selectedValue);
  const match = state.categories.find(
    (category) => category.toLowerCase() === normalized.toLowerCase()
  );
  if (normalized && match) {
    select.value = match;
  } else if (normalized) {
    select.value = CATEGORY_NEW;
  } else if (!hasCategories) {
    select.value = CATEGORY_NEW;
  } else {
    select.value = '';
  }
}

function syncCategoryInput(select, inputWrap, input, presetValue = '') {
  if (!select || !inputWrap || !input) return;
  const isNew = select.value === CATEGORY_NEW;
  inputWrap.classList.toggle('hidden', !isNew);
  input.required = isNew;
  if (isNew) {
    if (presetValue !== undefined) {
      input.value = presetValue;
    }
  } else {
    input.value = '';
  }
}

function applyCategorySelection(select, inputWrap, input, value) {
  renderCategorySelect(select, value);
  const normalized = normalizeCategory(value);
  if (select && select.value === CATEGORY_NEW) {
    syncCategoryInput(select, inputWrap, input, normalized);
  } else {
    syncCategoryInput(select, inputWrap, input);
  }
}

function getCategoryValue(select, input) {
  if (!select) return '';
  if (select.value === CATEGORY_NEW) return normalizeCategory(input?.value);
  return normalizeCategory(select.value);
}

function setImagePreview(img, value) {
  if (!img) return;
  const url = String(value || '').trim();
  if (!url) {
    img.classList.add('hidden');
    img.removeAttribute('src');
    return;
  }
  img.src = url;
  img.classList.remove('hidden');
}

function dataUrlBytes(dataUrl) {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

async function loadImageFromFile(file) {
  const img = new Image();
  const objectUrl = URL.createObjectURL(file);
  img.src = objectUrl;
  await img.decode();
  URL.revokeObjectURL(objectUrl);
  return img;
}

function drawImageToCanvas(img, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getAdjustBounds(img, zoom, canvas) {
  const baseScale = Math.max(canvas.width / img.width, canvas.height / img.height);
  const scale = baseScale * zoom;
  const drawWidth = img.width * scale;
  const drawHeight = img.height * scale;
  const maxOffsetX = Math.max(0, (drawWidth - canvas.width) / 2);
  const maxOffsetY = Math.max(0, (drawHeight - canvas.height) / 2);
  return { scale, drawWidth, drawHeight, maxOffsetX, maxOffsetY };
}

function drawAdjustedImage(adjustState, canvas) {
  if (!adjustState?.image || !canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const bounds = getAdjustBounds(adjustState.image, adjustState.zoom, canvas);
  const offsetX = clampNumber(adjustState.offsetX, -bounds.maxOffsetX, bounds.maxOffsetX);
  const offsetY = clampNumber(adjustState.offsetY, -bounds.maxOffsetY, bounds.maxOffsetY);
  adjustState.offsetX = offsetX;
  adjustState.offsetY = offsetY;

  const x = (canvas.width - bounds.drawWidth) / 2 + offsetX;
  const y = (canvas.height - bounds.drawHeight) / 2 + offsetY;
  ctx.drawImage(adjustState.image, x, y, bounds.drawWidth, bounds.drawHeight);
}

function syncAdjustInputs(adjustState, canvas, zoomInput, xInput, yInput) {
  if (!adjustState?.image || !canvas) return;
  const bounds = getAdjustBounds(adjustState.image, adjustState.zoom, canvas);
  if (zoomInput) {
    zoomInput.min = '1';
    zoomInput.max = String(IMAGE_MAX_ZOOM);
    zoomInput.step = '0.01';
    zoomInput.value = String(adjustState.zoom);
  }
  if (xInput) {
    xInput.min = String(Math.floor(-bounds.maxOffsetX));
    xInput.max = String(Math.ceil(bounds.maxOffsetX));
    xInput.step = '1';
    xInput.value = String(Math.round(adjustState.offsetX));
  }
  if (yInput) {
    yInput.min = String(Math.floor(-bounds.maxOffsetY));
    yInput.max = String(Math.ceil(bounds.maxOffsetY));
    yInput.step = '1';
    yInput.value = String(Math.round(adjustState.offsetY));
  }
}

function updateAdjustPreview(adjustState, canvas, zoomInput, xInput, yInput) {
  if (!adjustState?.image || !canvas) return;
  syncAdjustInputs(adjustState, canvas, zoomInput, xInput, yInput);
  drawAdjustedImage(adjustState, canvas);
}

function clearAdjustCanvas(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function compressCanvasToDataUrl(sourceCanvas) {
  let canvas = sourceCanvas;
  let quality = 0.85;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  let size = dataUrlBytes(dataUrl);

  while (size > MAX_IMAGE_BYTES && quality > 0.45) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
    size = dataUrlBytes(dataUrl);
  }

  let attempts = 0;
  while (size > MAX_IMAGE_BYTES && Math.max(canvas.width, canvas.height) > IMAGE_MIN_DIM && attempts < 6) {
    const nextCanvas = drawImageToCanvas(canvas, canvas.width * 0.85, canvas.height * 0.85);
    canvas = nextCanvas;
    dataUrl = canvas.toDataURL('image/jpeg', Math.min(quality, 0.8));
    size = dataUrlBytes(dataUrl);
    attempts += 1;
  }

  if (size > MAX_IMAGE_BYTES) {
    throw new Error('image_too_large');
  }

  return dataUrl;
}

async function buildAdjustedDataUrl(adjustState) {
  if (!adjustState?.image) return null;
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = IMAGE_OUTPUT_SIZE;
  outputCanvas.height = IMAGE_OUTPUT_SIZE;
  drawAdjustedImage(adjustState, outputCanvas);
  return compressCanvasToDataUrl(outputCanvas);
}

function resetCreateImageState() {
  state.createImage = null;
  if (createImageFile) createImageFile.value = '';
  if (createImageAdjust) createImageAdjust.classList.add('hidden');
  clearAdjustCanvas(createImageCanvas);
}

function resetEditImageState(imageUrl = '') {
  state.editImage = null;
  state.editImageRemove = false;
  if (editImageFile) editImageFile.value = '';
  if (editImageAdjust) editImageAdjust.classList.add('hidden');
  clearAdjustCanvas(editImageCanvas);
  setImagePreview(editImagePreview, imageUrl);
}

async function loadAdjustFromFile(file, adjustWrap, previewImg, canvas, zoomInput, xInput, yInput) {
  const image = await loadImageFromFile(file);
  const adjustState = { image, zoom: 1, offsetX: 0, offsetY: 0 };
  if (adjustWrap) adjustWrap.classList.remove('hidden');
  if (previewImg) previewImg.classList.add('hidden');
  updateAdjustPreview(adjustState, canvas, zoomInput, xInput, yInput);
  return adjustState;
}

function updateAdjustFromInputs(adjustState, canvas, zoomInput, xInput, yInput) {
  if (!adjustState) return;
  if (zoomInput) adjustState.zoom = Number(zoomInput.value) || 1;
  if (xInput) adjustState.offsetX = Number(xInput.value) || 0;
  if (yInput) adjustState.offsetY = Number(yInput.value) || 0;
  updateAdjustPreview(adjustState, canvas, zoomInput, xInput, yInput);
}

function getFilteredProducts() {
  let list = state.products;
  if (state.filterCategory) {
    const filterValue = normalizeCategory(state.filterCategory).toLowerCase();
    list = list.filter((product) => {
      return normalizeCategory(product.category).toLowerCase() === filterValue;
    });
  }
  if (state.criticalOnly) {
    list = list.filter((product) => {
      const stock = toNumber(product.stock) || 0;
      return stock <= 5;
    });
  }
  return list;
}

function compareOptionalNumbers(leftValue, rightValue) {
  const left = toNumber(leftValue);
  const right = toNumber(rightValue);
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

function getSortedProducts(items) {
  const products = [...(items || [])];
  const direction = state.sortDirection === 'desc' ? -1 : 1;
  products.sort((left, right) => {
    if (state.sortKey === 'stock') {
      const byStock = compareOptionalNumbers(left.stock, right.stock);
      if (byStock !== 0) return byStock * direction;
    } else if (state.sortKey === 'buy') {
      const byBuy = compareOptionalNumbers(pickPrice(left, 'buy'), pickPrice(right, 'buy'));
      if (byBuy !== 0) return byBuy * direction;
    } else {
      const byName = String(left.name || '').localeCompare(String(right.name || ''), 'id', {
        sensitivity: 'base',
        numeric: true
      });
      if (byName !== 0) return byName * direction;
    }

    return ((Number(left.id) || 0) - (Number(right.id) || 0)) * direction;
  });
  return products;
}

function renderTableSkeletonRows(count = 6) {
  return Array.from({ length: count }, (_, index) => {
    return `
      <tr class="table-skeleton-row" aria-hidden="true" style="animation-delay:${index * 30}ms">
        <td class="img-col"><span class="table-skeleton-cell table-skeleton-thumb"></span></td>
        <td><span class="table-skeleton-cell table-skeleton-text"></span></td>
        <td class="optional-col"><span class="table-skeleton-cell table-skeleton-text"></span></td>
        <td class="col-stock"><span class="table-skeleton-cell table-skeleton-number"></span></td>
        <td class="optional-col"><span class="table-skeleton-cell table-skeleton-number"></span></td>
        <td class="sell-col"><span class="table-skeleton-cell table-skeleton-number"></span></td>
        <td class="optional-col"><span class="table-skeleton-cell table-skeleton-number"></span></td>
        <td class="optional-col"><span class="table-skeleton-cell table-skeleton-number"></span></td>
        <td class="col-actions"><span class="table-skeleton-cell table-skeleton-actions"></span></td>
      </tr>
    `;
  }).join('');
}

function renderMobileSkeletonCards(count = 6) {
  return Array.from({ length: count }, (_, index) => {
    return `
      <article class="product-mobile-card product-mobile-skeleton" aria-hidden="true" style="animation-delay:${index * 30}ms">
        <div class="product-mobile-head">
          <span class="thumb table-skeleton-thumb"></span>
          <div class="product-mobile-title">
            <span class="mobile-skeleton-line mobile-skeleton-title"></span>
            <span class="mobile-skeleton-line mobile-skeleton-subtitle"></span>
          </div>
          <span class="table-skeleton-actions"></span>
        </div>
        <div class="product-mobile-metrics">
          <span class="mobile-skeleton-line"></span>
          <span class="mobile-skeleton-line"></span>
        </div>
      </article>
    `;
  }).join('');
}

function renderMobileEmptyState(hasFilters) {
  const resetDisabled = hasFilters ? '' : 'disabled aria-disabled="true"';
  const title = hasFilters ? 'Produk tidak ditemukan' : 'Belum ada barang';
  const description = hasFilters
    ? 'Coba ubah pencarian atau reset filter.'
    : 'Mulai tambah produk baru.';
  return `
    <div class="product-mobile-empty product-mobile-empty-actions">
      <strong class="empty-title">${title}</strong>
      <p>${description}</p>
      <div class="empty-actions">
        <button
          class="icon-btn empty-action-btn"
          type="button"
          data-empty-action="reset-filters"
          ${resetDisabled}
          aria-label="Reset filter"
          title="Reset filter"
        >
          <span class="icon-symbol" aria-hidden="true">&#x21bb;</span>
          <span class="sr-only">Reset filter</span>
        </button>
        <button
          class="icon-btn icon-btn-add empty-action-btn"
          type="button"
          data-empty-action="show-create"
          aria-label="Tambah barang"
          title="Tambah barang"
        >
          <span class="icon-symbol" aria-hidden="true">+</span>
          <span class="sr-only">Tambah barang</span>
        </button>
      </div>
    </div>
  `;
}

function renderActionButtons(product) {
  const isInactive = !product?.is_active;
  const restockAttrs = isInactive
    ? 'disabled aria-disabled="true"'
    : '';
  const restockTitle = isInactive ? 'Aktifkan barang dulu' : 'Tambah stok';
  const restockLabel = isInactive ? 'Tambah stok (nonaktif)' : 'Tambah stok';

  return `
    <div class="table-action-buttons">
      <button
        class="icon-btn icon-btn-edit"
        type="button"
        data-action="detail"
        aria-label="Lihat detail barang"
        title="Lihat detail barang"
      >
        <svg class="icon-symbol" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          ></path>
          <path
            d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          ></path>
        </svg>
        <span class="sr-only">Detail</span>
      </button>
      <button
        class="icon-btn icon-btn-add"
        type="button"
        data-action="restock"
        ${restockAttrs}
        aria-label="${restockLabel}"
        title="${restockTitle}"
      >
        <span class="icon-symbol" aria-hidden="true">+</span>
        <span class="sr-only">Tambah stok</span>
      </button>
    </div>
  `;
}

function renderMobileSwipeActions(product) {
  const isInactive = !product?.is_active;
  const restockAttrs = isInactive ? 'disabled aria-disabled="true"' : '';
  const restockTitle = isInactive ? 'Aktifkan barang dulu' : 'Tambah stok';
  return `
    <div class="product-mobile-swipe-actions">
      <button
        class="icon-btn icon-btn-edit"
        type="button"
        data-action="detail"
        aria-label="Detail barang"
        title="Detail barang"
      >
        <svg class="icon-symbol" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M4 20h4l10-10-4-4L4 16v4Zm11-13 2 2M14 6l2-2 4 4-2 2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          ></path>
        </svg>
      </button>
      <button
        class="icon-btn icon-btn-add"
        type="button"
        data-action="restock"
        ${restockAttrs}
        aria-label="${restockTitle}"
        title="${restockTitle}"
      >
        <span class="icon-symbol" aria-hidden="true">+</span>
      </button>
    </div>
  `;
}

function renderTable() {
  if (state.isLoadingProducts) {
    if (productRows) {
      productRows.innerHTML = renderTableSkeletonRows();
    }
    if (productMobileList) {
      productMobileList.innerHTML = renderMobileSkeletonCards();
    }
    return;
  }

  const products = getSortedProducts(getFilteredProducts());
  const hasFilters = Boolean(
    state.search || state.filterCategory || state.includeInactive || state.criticalOnly
  );
  const rows = products
    .map((product, index) => {
      const buyPrice = pickPrice(product, 'buy');
      const sellPrice = pickPrice(product, 'sell');
      const rowInactiveClass = product.is_active ? '' : ' is-inactive';

        const imageUrl = product.image_url ? escapeHtml(product.image_url) : '';
        const imageMarkup = imageUrl
          ? `<img class="thumb-img" src="${imageUrl}" alt="${escapeHtml(product.name)}" loading="lazy" />`
          : '<span>IMG</span>';
        const actionButtons = renderActionButtons(product);

        return `
          <tr data-id="${product.id}" class="${rowInactiveClass.trim()}" style="animation-delay:${index * 20}ms">
            <td class="img-col">
              <div class="thumb mx-auto">${imageMarkup}</div>
            </td>
            <td>
              <div class="cell-title">${escapeHtml(product.name)}</div>
              <div class="cell-meta">${escapeHtml(product.unit || '-')}</div>
            </td>
            <td class="optional-col">${escapeHtml(product.category || '-')}</td>
            <td class="col-stock">${formatNumber(product.stock)}</td>
            <td class="optional-col">${formatCurrency(buyPrice)}</td>
            <td class="sell-col">${formatCurrency(sellPrice)}</td>
            <td class="optional-col">${formatCurrency(product.revenue)}</td>
          <td class="optional-col">${formatCurrency(product.profit)}</td>
          <td class="col-actions">
            ${actionButtons}
          </td>
        </tr>
      `;
    })
    .join('');

  const mobileCards = products
    .map((product, index) => {
      const buyPrice = pickPrice(product, 'buy');
      const inactiveClass = product.is_active ? '' : ' is-inactive';
      const isExpanded = state.expandedMobileIds.has(product.id);
      const imageUrl = product.image_url ? escapeHtml(product.image_url) : '';
      const imageMarkup = imageUrl
        ? `<img class="thumb-img" src="${imageUrl}" alt="${escapeHtml(product.name)}" loading="lazy" />`
        : '<span>IMG</span>';

      return `
        <article class="product-mobile-card${inactiveClass}${isExpanded ? ' is-expanded' : ''}" data-id="${product.id}" style="animation-delay:${index * 20}ms">
          ${renderMobileSwipeActions(product)}
          <div class="product-mobile-surface">
            <div class="product-mobile-head">
              <div class="thumb">${imageMarkup}</div>
              <div class="product-mobile-title">
                <div class="cell-title">${escapeHtml(product.name)}</div>
                <div class="cell-meta product-mobile-unit">${escapeHtml(product.unit || '-')}</div>
                <div class="cell-meta">${escapeHtml(product.category || 'Tanpa kategori')}</div>
              </div>
            </div>
            <div class="product-mobile-metrics">
              <div class="mobile-metric">
                <span class="metric-label" aria-hidden="true">
                  <svg class="metric-icon" viewBox="0 0 24 24" focusable="false">
                    <path
                      d="M4 7.5 12 4l8 3.5-8 3.5L4 7.5Zm0 4.5 8 3.5 8-3.5M4 16.5 12 20l8-3.5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    ></path>
                  </svg>
                </span>
                <span class="sr-only">Stok</span>
                <strong>${formatNumber(product.stock)}</strong>
              </div>
              <div class="mobile-metric">
                <span class="metric-label" aria-hidden="true">
                  <svg class="metric-icon" viewBox="0 0 24 24" focusable="false">
                    <path
                      d="M4.5 8h15M6.5 8l1 10h9l1-10M9 8V6.8A2.2 2.2 0 0 1 11.2 4.6h1.6A2.2 2.2 0 0 1 15 6.8V8"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    ></path>
                  </svg>
                </span>
                <span class="sr-only">Beli</span>
                <strong>${formatCurrency(buyPrice)}</strong>
              </div>
            </div>
            <div class="product-mobile-extra${isExpanded ? ' open' : ''}">
              <div class="mobile-extra-item">
                <span>Revenue</span>
                <strong>${formatCurrency(product.revenue)}</strong>
              </div>
              <div class="mobile-extra-item">
                <span>Profit</span>
                <strong>${formatCurrency(product.profit)}</strong>
              </div>
              <div class="mobile-extra-item">
                <span>Keluar</span>
                <strong>${formatNumber(product.stock_out)}</strong>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  productRows.innerHTML = rows ||
    `<tr><td colspan="9">${hasFilters ? 'Tidak ada data sesuai filter.' : 'Belum ada data barang.'}</td></tr>`;
  if (productMobileList) {
    productMobileList.innerHTML = mobileCards || renderMobileEmptyState(hasFilters);
  }
}

function renderDrawer(product) {
  if (!product) return;
  const buyPrice = pickPrice(product, 'buy');
  const sellPrice = pickPrice(product, 'sell');

  drawerTitle.textContent = product.name;
    drawerSummary.innerHTML = `
      <div>Stok<br /><span>${formatNumber(product.stock)}</span></div>
      <div>Kategori<br /><span>${escapeHtml(product.category || '-')}</span></div>
      <div>Revenue<br /><span>${formatCurrency(product.revenue)}</span></div>
      <div>Profit<br /><span>${formatCurrency(product.profit)}</span></div>
      <div>Harga jual<br /><span>${formatCurrency(sellPrice)}</span></div>
      <div>Harga beli<br /><span>${formatCurrency(buyPrice)}</span></div>
    <div>Transaksi keluar<br /><span>${formatNumber(product.stock_out)}</span></div>
  `;

  editForm.elements.id.value = product.id;
  editForm.elements.name.value = product.name || '';
  editForm.elements.unit.value = product.unit || '';
  resetEditImageState(product.image_url);
  applyCategorySelection(
    editCategorySelect,
    editCategoryInputWrap,
    editCategoryInput,
    product.category
  );
  editForm.elements.default_buy_price.value =
    product.default_buy_price ?? '';
  editForm.elements.default_sell_price.value =
    product.default_sell_price ?? '';
  formatCurrencyInputValue(editForm.elements.default_buy_price);
  formatCurrencyInputValue(editForm.elements.default_sell_price);
  if (editForm.elements.payable_mode) {
    editForm.elements.payable_mode.value = product.payable_mode || 'credit';
  }
  editForm.elements.note.value = product.note || '';
  editForm.elements.is_active.checked = Boolean(product.is_active);

  deactivateBtn.textContent = product.is_active ? 'Nonaktifkan' : 'Aktifkan';
  openDrawer();
}

function renderQuickMeta(product) {
  if (!quickProductMeta) return;
  if (!product) {
    quickProductMeta.innerHTML = '<div>Pilih barang untuk melihat detail.</div>';
    return;
  }

  const buyPrice = pickPrice(product, 'buy');
  const sellPrice = pickPrice(product, 'sell');

  quickProductMeta.innerHTML = `
    <div>Stok<br /><span>${formatNumber(product.stock)}</span></div>
    <div>Harga beli<br /><span>${formatCurrency(buyPrice)}</span></div>
    <div>Harga jual<br /><span>${formatCurrency(sellPrice)}</span></div>
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
      if (buyPrice != null && !buyInput.value) {
        buyInput.value = buyPrice;
        formatCurrencyInputValue(buyInput);
      }
      if (sellPrice != null && !sellInput.value) {
        sellInput.value = sellPrice;
        formatCurrencyInputValue(sellInput);
      }
    }
    if (type === 'OUT' && sellPrice != null && !sellInput.value) {
      sellInput.value = sellPrice;
      formatCurrencyInputValue(sellInput);
    }
  }
}

function resetQuickSheetSwipe() {
  if (!quickModalCard) return;
  quickModalCard.style.transform = '';
  quickModalCard.style.transition = '';
  quickModalCard.style.willChange = '';
  quickSwipeState.tracking = false;
  quickSwipeState.offsetY = 0;
}

function setupQuickSheetSwipeToClose() {
  if (!quickModalCard) return;

  quickModalCard.addEventListener('touchstart', (event) => {
    if (!quickModal || quickModal.classList.contains('hidden')) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    const swipeHandle = event.target.closest('.quick-grab, .quick-head');
    if (!swipeHandle) return;
    quickSwipeState.tracking = true;
    quickSwipeState.startY = touch.clientY;
    quickSwipeState.startX = touch.clientX;
    quickSwipeState.offsetY = 0;
    quickModalCard.style.transition = 'none';
    quickModalCard.style.willChange = 'transform';
  }, { passive: true });

  quickModalCard.addEventListener('touchmove', (event) => {
    if (!quickSwipeState.tracking) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    const deltaY = touch.clientY - quickSwipeState.startY;
    const deltaX = touch.clientX - quickSwipeState.startX;
    if (deltaY <= 0 || Math.abs(deltaY) < Math.abs(deltaX)) return;

    event.preventDefault();
    const nextOffset = Math.min(deltaY, 260);
    quickSwipeState.offsetY = nextOffset;
    quickModalCard.style.transform = `translateY(${nextOffset}px)`;
  }, { passive: false });

  const endSwipe = () => {
    if (!quickSwipeState.tracking) return;
    const offsetY = quickSwipeState.offsetY;
    quickSwipeState.tracking = false;
    quickModalCard.style.willChange = '';
    quickModalCard.style.transition = 'transform 160ms ease';
    if (offsetY > 88) {
      closeQuickModal();
      resetQuickSheetSwipe();
      return;
    }
    quickModalCard.style.transform = 'translateY(0px)';
    window.setTimeout(() => {
      if (!quickModal || quickModal.classList.contains('hidden')) return;
      quickModalCard.style.transform = '';
      quickModalCard.style.transition = '';
    }, 170);
  };

  quickModalCard.addEventListener('touchend', endSwipe);
  quickModalCard.addEventListener('touchcancel', endSwipe);
}

function openQuickModal(product, type = 'IN') {
  if (!quickModal || !quickForm) return;
  resetQuickSheetSwipe();
  state.quickProduct = product;
  quickProductName.textContent = product.name;
  quickForm.reset();
  quickForm.elements.product_id.value = product.id;
  quickType.value = type;
  renderQuickMeta(product);
  updateQuickTypeFields();
  quickModal.classList.remove('hidden');
  quickModal.setAttribute('aria-hidden', 'false');
  syncPageScrollLock();
}

function closeQuickModal() {
  if (!quickModal || !quickForm) return;
  resetQuickSheetSwipe();
  quickModal.classList.add('hidden');
  quickModal.setAttribute('aria-hidden', 'true');
  quickForm.reset();
  state.quickProduct = null;
  renderQuickMeta(null);
  syncPageScrollLock();
}

async function fetchCategories() {
  const params = new URLSearchParams();
  const storeId = getActiveStoreId();
  if (storeId) params.set('storeId', storeId);

  try {
    const data = await fetchJson(`/api/product-categories?${params.toString()}`);
    if (!data) return;
    state.categories = uniqueCategories(data.data || []);

    const createValue = getCategoryValue(categorySelect, categoryInput);
    const editValue = state.selected?.category || getCategoryValue(editCategorySelect, editCategoryInput);
    applyCategorySelection(
      categorySelect,
      categoryInputWrap,
      categoryInput,
      createValue
    );
    applyCategorySelection(
      editCategorySelect,
      editCategoryInputWrap,
      editCategoryInput,
      editValue
    );
    renderCategoryFilter();
  } catch (err) {
    state.categories = [];
    applyCategorySelection(
      categorySelect,
      categoryInputWrap,
      categoryInput,
      ''
    );
    applyCategorySelection(
      editCategorySelect,
      editCategoryInputWrap,
      editCategoryInput,
      state.selected?.category || ''
    );
    renderCategoryFilter();
    showToast('Gagal memuat kategori.', true);
  }
}

function pruneExpandedMobileIds() {
  const visibleIds = new Set(state.products.map((item) => Number(item.id)));
  state.expandedMobileIds = new Set(
    [...state.expandedMobileIds].filter((id) => visibleIds.has(Number(id)))
  );
}

async function fetchProducts() {
  const requestId = ++fetchProductsRequestId;
  state.isLoadingProducts = true;
  renderTable();

  const params = new URLSearchParams();
  if (state.includeInactive) params.set('includeInactive', 'true');
  if (state.search) params.set('search', state.search);
  if (state.filterCategory) params.set('category', state.filterCategory);
  const storeId = getActiveStoreId();
  if (storeId) params.set('storeId', storeId);

  try {
    const data = await fetchJson(`/api/products?${params.toString()}`);
    if (!data || requestId !== fetchProductsRequestId) return;
    state.products = (data.data || []).map((item) => ({
      ...item,
      id: Number(item.id)
    }));
    pruneExpandedMobileIds();

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
    if (requestId !== fetchProductsRequestId) return;
    showToast('Gagal memuat data.', true);
  } finally {
    if (requestId !== fetchProductsRequestId) return;
    state.isLoadingProducts = false;
    renderTable();
    applyUrlActionAfterData();
  }
}

function resetListFilters() {
  clearTimeout(searchTimer);
  state.search = '';
  state.filterCategory = '';
  state.includeInactive = false;
  state.criticalOnly = false;
  state.sortKey = 'name';
  state.sortDirection = 'asc';

  if (searchInput) searchInput.value = '';
  if (filterCategory) filterCategory.value = '';
  syncSearchClear();
  syncInactiveToggle();
  syncSortControls();
  setFilterPanelOpen(false);
  persistListState();
}

function handleEmptyActionClick(event) {
  const emptyActionBtn = event.target.closest('[data-empty-action]');
  if (!emptyActionBtn) return false;
  const action = emptyActionBtn.dataset.emptyAction;

  if (action === 'reset-filters') {
    if (emptyActionBtn.hasAttribute('disabled')) return true;
    resetListFilters();
    fetchProducts();
    return true;
  }

  if (action === 'show-create') {
    setCreateFormHidden(false);
    if (!isCreateSheetMode()) {
      createCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    createForm?.elements?.name?.focus();
    return true;
  }

  return false;
}

function getMobileCardSurface(card) {
  if (!(card instanceof HTMLElement)) return null;
  return card.querySelector('.product-mobile-surface');
}

function setMobileCardSwipe(card, open) {
  if (!(card instanceof HTMLElement)) return;
  const surface = getMobileCardSurface(card);
  if (!surface) return;
  card.classList.toggle('swiped-left', Boolean(open));
  surface.style.transform = open ? 'translateX(-5rem)' : '';
  surface.style.transition = 'transform 150ms ease';
  window.setTimeout(() => {
    if (!card.classList.contains('swiped-left')) {
      surface.style.transform = '';
    }
    surface.style.transition = '';
  }, 170);
}

function closeMobileCardSwipes(exceptCard = null) {
  if (!productMobileList) return;
  const opened = productMobileList.querySelectorAll('.product-mobile-card.swiped-left');
  opened.forEach((card) => {
    if (exceptCard && card === exceptCard) return;
    setMobileCardSwipe(card, false);
  });
}

function syncSelectedProductStateById(productId) {
  const id = Number(productId);
  if (!Number.isFinite(id)) return;
  const updated = state.products.find((item) => item.id === id);
  if (!updated) return;

  if (state.selected?.id === id) {
    state.selected = updated;
    if (drawer?.classList.contains('open')) {
      renderDrawer(updated);
    }
  }
  if (state.quickProduct?.id === id && quickModal && !quickModal.classList.contains('hidden')) {
    state.quickProduct = updated;
    renderQuickMeta(updated);
  }
}

function setProductActiveLocal(productId, isActive) {
  const id = Number(productId);
  if (!Number.isFinite(id)) return;
  state.products = state.products.map((item) =>
    item.id === id ? { ...item, is_active: Boolean(isActive) } : item
  );
  syncSelectedProductStateById(id);
}

function queueProductActiveToggle(product, card) {
  if (!product || !Number.isFinite(Number(product.id))) return;
  const nextActive = !Boolean(product.is_active);
  const label = nextActive ? 'Barang diaktifkan.' : 'Barang dinonaktifkan.';

  setProductActiveLocal(product.id, nextActive);
  renderTable();
  if (card instanceof HTMLElement) {
    triggerSwipeFeedback(card, nextActive ? 'success' : 'danger');
  }

  showUndoSnack({
    message: `${product.name} ${nextActive ? 'diaktifkan' : 'dinonaktifkan'}.`,
    actionLabel: 'Batal',
    onUndo: () => {
      setProductActiveLocal(product.id, !nextActive);
      renderTable();
      showToast('Perubahan status dibatalkan.');
    },
    onCommit: () => {
      (async () => {
        try {
          const res = await fetchJson(`/api/products/${product.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: nextActive })
          });
          if (res === null) return;
          showToast(label);
        } catch (err) {
          setProductActiveLocal(product.id, !nextActive);
          renderTable();
          showToast('Gagal ubah status barang.', true);
        }
      })();
    }
  });
}

function bindMobileCardSwipeActions() {
  if (!productMobileList || productMobileList.dataset.swipeBound === 'true') return;
  productMobileList.dataset.swipeBound = 'true';

  productMobileList.addEventListener(
    'touchstart',
    (event) => {
      if (!mobileFilterQuery.matches) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const card = event.target.closest('.product-mobile-card[data-id]');
      if (!card) return;
      if (event.target.closest('.product-mobile-swipe-actions')) return;

      mobileCardSwipeState.tracking = true;
      mobileCardSwipeState.card = card;
      mobileCardSwipeState.startX = touch.clientX;
      mobileCardSwipeState.startY = touch.clientY;
      mobileCardSwipeState.offsetX = 0;
    },
    { passive: true }
  );

  productMobileList.addEventListener(
    'touchmove',
    (event) => {
      if (!mobileCardSwipeState.tracking || !mobileCardSwipeState.card) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const deltaX = touch.clientX - mobileCardSwipeState.startX;
      const deltaY = touch.clientY - mobileCardSwipeState.startY;
      if (Math.abs(deltaY) > Math.abs(deltaX)) return;

      const surface = getMobileCardSurface(mobileCardSwipeState.card);
      if (!surface) return;

      event.preventDefault();
      const limited = Math.max(-92, Math.min(96, deltaX));
      mobileCardSwipeState.offsetX = limited;
      surface.style.transition = 'none';
      surface.style.transform = `translateX(${limited}px)`;
    },
    { passive: false }
  );

  const endSwipe = () => {
    if (!mobileCardSwipeState.tracking || !mobileCardSwipeState.card) return;
    const card = mobileCardSwipeState.card;
    const productId = Number(card.dataset.id);
    const product = state.products.find((item) => item.id === productId);
    const shouldOpen = mobileCardSwipeState.offsetX <= -48;
    const shouldToggleActive = mobileCardSwipeState.offsetX >= 72;

    if (shouldToggleActive && product) {
      closeMobileCardSwipes(card);
      setMobileCardSwipe(card, false);
      queueProductActiveToggle(product, card);
      mobileCardSwipeState.tracking = false;
      mobileCardSwipeState.card = null;
      mobileCardSwipeState.offsetX = 0;
      return;
    }

    if (shouldOpen) closeMobileCardSwipes(card);
    setMobileCardSwipe(card, shouldOpen);
    if (shouldOpen) triggerSwipeFeedback(card, 'success');
    mobileCardSwipeState.tracking = false;
    mobileCardSwipeState.card = null;
    mobileCardSwipeState.offsetX = 0;
  };

  productMobileList.addEventListener('touchend', endSwipe);
  productMobileList.addEventListener('touchcancel', endSwipe);

  productMobileList.addEventListener('click', (event) => {
    const actionBtn = event.target.closest('[data-action]');
    const card = event.target.closest('.product-mobile-card[data-id]');
    if (actionBtn && card?.classList.contains('swiped-left')) {
      window.setTimeout(() => setMobileCardSwipe(card, false), 80);
      return;
    }
    if (card?.classList.contains('swiped-left')) return;
    closeMobileCardSwipes(card);
  });
}

function handleProductListClick(event, itemSelector, options = {}) {
  const { allowRowOpen = false } = options;
  const actionBtn = event.target.closest('[data-action]');
  const item = event.target.closest(itemSelector);
  if (!item) return;
  const id = Number(item.dataset.id);
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  const action = actionBtn?.dataset.action;

  if (action === 'expand') {
    if (state.expandedMobileIds.has(id)) {
      state.expandedMobileIds.delete(id);
    } else {
      state.expandedMobileIds.add(id);
    }
    renderTable();
    return;
  }

  if (action === 'restock' && actionBtn.hasAttribute('disabled')) {
    return;
  }

  if (action === 'restock') {
    closeMobileCardSwipes();
    openQuickModal(product, 'IN');
    return;
  }

  if (action === 'detail') {
    closeMobileCardSwipes();
    state.selected = product;
    renderDrawer(product);
    return;
  }

  if (item.matches?.('.product-mobile-card[data-id]')) {
    if (state.expandedMobileIds.has(id)) {
      state.expandedMobileIds.delete(id);
    } else {
      state.expandedMobileIds.add(id);
    }
    renderTable();
    return;
  }

  if (!allowRowOpen) return;
  state.selected = product;
  renderDrawer(product);
}

if (productRows) {
  productRows.addEventListener('click', (event) => {
    if (handleEmptyActionClick(event)) return;
    handleProductListClick(event, 'tr[data-id]');
  });
}

if (productMobileList) {
  productMobileList.addEventListener('click', (event) => {
    if (handleEmptyActionClick(event)) return;
    handleProductListClick(event, '.product-mobile-card[data-id]');
  });
}

closeDrawerBtn.addEventListener('click', () => {
  closeDrawer();
});

if (drawerBackdrop) {
  drawerBackdrop.addEventListener('click', closeDrawer);
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    fetchCategories();
    fetchProducts();
  });
}

if (toggleCreateBtn) {
  toggleCreateBtn.addEventListener('click', () => {
    const isHidden = createCard?.classList.contains('hidden');
    const nextHidden = !isHidden;
    setCreateFormHidden(nextHidden);
    if (!nextHidden) {
      if (!isCreateSheetMode()) {
        createCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      createForm?.elements?.name?.focus();
    }
  });
}

if (closeCreateBtn) {
  closeCreateBtn.addEventListener('click', () => {
    setCreateFormHidden(true);
  });
}

if (createCard) {
  createCard.addEventListener('click', (event) => {
    const closeBtn = event.target.closest('[data-action="close-create"]');
    if (!closeBtn) return;
    event.preventDefault();
    setCreateFormHidden(true);
  });
}

if (createBackdrop) {
  createBackdrop.addEventListener('click', () => {
    setCreateFormHidden(true);
  });
}

if (filterCategory) {
  filterCategory.addEventListener('change', (event) => {
    state.filterCategory = normalizeCategory(event.target.value);
    persistListState();
    fetchProducts();
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

if (createImageFile) {
  createImageFile.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      resetCreateImageState();
      return;
    }
    try {
      state.createImage = await loadAdjustFromFile(
        file,
        createImageAdjust,
        null,
        createImageCanvas,
        createImageZoom,
        createImageX,
        createImageY
      );
    } catch (err) {
      resetCreateImageState();
      showToast('Gagal memuat gambar.', true);
    }
  });
}

if (editImageFile) {
  editImageFile.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      resetEditImageState(state.selected?.image_url || '');
      return;
    }
    state.editImageRemove = false;
    try {
      state.editImage = await loadAdjustFromFile(
        file,
        editImageAdjust,
        editImagePreview,
        editImageCanvas,
        editImageZoom,
        editImageX,
        editImageY
      );
    } catch (err) {
      resetEditImageState(state.selected?.image_url || '');
      showToast('Gagal memuat gambar.', true);
    }
  });
}

if (clearImageBtn) {
  clearImageBtn.addEventListener('click', () => {
    state.editImageRemove = true;
    state.editImage = null;
    if (editImageFile) editImageFile.value = '';
    if (editImageAdjust) editImageAdjust.classList.add('hidden');
    clearAdjustCanvas(editImageCanvas);
    setImagePreview(editImagePreview, '');
  });
}

if (createImageZoom) {
  createImageZoom.addEventListener('input', () => {
    updateAdjustFromInputs(
      state.createImage,
      createImageCanvas,
      createImageZoom,
      createImageX,
      createImageY
    );
  });
}

if (createImageX) {
  createImageX.addEventListener('input', () => {
    updateAdjustFromInputs(
      state.createImage,
      createImageCanvas,
      createImageZoom,
      createImageX,
      createImageY
    );
  });
}

if (createImageY) {
  createImageY.addEventListener('input', () => {
    updateAdjustFromInputs(
      state.createImage,
      createImageCanvas,
      createImageZoom,
      createImageX,
      createImageY
    );
  });
}

if (createImageReset) {
  createImageReset.addEventListener('click', () => {
    if (!state.createImage) return;
    state.createImage.zoom = 1;
    state.createImage.offsetX = 0;
    state.createImage.offsetY = 0;
    updateAdjustPreview(
      state.createImage,
      createImageCanvas,
      createImageZoom,
      createImageX,
      createImageY
    );
  });
}

if (editImageZoom) {
  editImageZoom.addEventListener('input', () => {
    updateAdjustFromInputs(
      state.editImage,
      editImageCanvas,
      editImageZoom,
      editImageX,
      editImageY
    );
  });
}

if (editImageX) {
  editImageX.addEventListener('input', () => {
    updateAdjustFromInputs(
      state.editImage,
      editImageCanvas,
      editImageZoom,
      editImageX,
      editImageY
    );
  });
}

if (editImageY) {
  editImageY.addEventListener('input', () => {
    updateAdjustFromInputs(
      state.editImage,
      editImageCanvas,
      editImageZoom,
      editImageX,
      editImageY
    );
  });
}

if (editImageReset) {
  editImageReset.addEventListener('click', () => {
    if (!state.editImage) return;
    state.editImage.zoom = 1;
    state.editImage.offsetX = 0;
    state.editImage.offsetY = 0;
    updateAdjustPreview(
      state.editImage,
      editImageCanvas,
      editImageZoom,
      editImageX,
      editImageY
    );
  });
}

if (searchInput) {
  searchInput.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    state.search = event.target.value.trim();
    syncSearchClear();
    persistListState();
    searchTimer = setTimeout(fetchProducts, 300);
  });
}

if (searchClearBtn) {
  searchClearBtn.addEventListener('click', () => {
    if (!searchInput) return;
    searchInput.value = '';
    state.search = '';
    syncSearchClear();
    persistListState();
    fetchProducts();
    searchInput.focus();
  });
}

if (toggleInactive) {
  if (toggleInactive instanceof HTMLInputElement) {
    toggleInactive.addEventListener('change', (event) => {
      state.includeInactive = event.target.checked;
      persistListState();
      fetchProducts();
    });
  } else {
    toggleInactive.addEventListener('click', () => {
      state.includeInactive = !state.includeInactive;
      syncInactiveToggle();
      persistListState();
      fetchProducts();
    });
  }
}

if (filterToggleBtn) {
  filterToggleBtn.addEventListener('click', () => {
    if (!mobileFilterQuery.matches) return;
    setFilterPanelOpen(!isFilterPanelOpen);
  });
}

mobileFilterQuery.addEventListener('change', () => {
  syncFilterPanelByViewport();
  if (mobileFilterQuery.matches) {
    setCreateFormHidden(true, false);
  } else {
    syncCreateFormByViewport();
  }
});

if (categorySelect) {
  categorySelect.addEventListener('change', () => {
    syncCategoryInput(categorySelect, categoryInputWrap, categoryInput);
  });
}

if (editCategorySelect) {
  editCategorySelect.addEventListener('change', () => {
    syncCategoryInput(editCategorySelect, editCategoryInputWrap, editCategoryInput);
  });
}

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {};
  const formData = new FormData(createForm);
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) continue;
    payload[key] = value;
  }
  const initialStockRaw = String(payload.initial_stock || '').trim();
  if (initialStockRaw) {
    const initialStock = toNumber(initialStockRaw);
    if (!Number.isFinite(initialStock) || initialStock < 0) {
      showToast('Stok awal harus angka 0 atau lebih.', true);
      return;
    }
    payload.initial_stock = initialStock;
    if (initialStock > 0) {
      const buyPrice = toNumber(payload.default_buy_price);
      if (!Number.isFinite(buyPrice) || buyPrice <= 0) {
        showToast('Isi harga beli default jika stok awal lebih dari 0.', true);
        return;
      }
    }
  } else {
    delete payload.initial_stock;
  }
  const storeId = getActiveStoreId();
  if (storeId) payload.store_id = storeId;
  const categoryValue = getCategoryValue(categorySelect, categoryInput);
  if (categorySelect?.value === CATEGORY_NEW && !categoryValue) {
    showToast('Kategori baru belum diisi.', true);
    return;
  }
  payload.category = categoryValue;
  if (state.createImage?.image) {
    try {
      payload.image_data = await buildAdjustedDataUrl(state.createImage);
    } catch (err) {
      showToast('Gambar harus di bawah 100KB.', true);
      return;
    }
  }

  try {
    const res = await fetchJson('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res) return;

    createForm.reset();
    resetCreateImageState();
    syncCategoryInput(categorySelect, categoryInputWrap, categoryInput);
    if (isCreateSheetMode()) {
      setCreateFormHidden(true);
    }
    showToast(res.initial_stock_recorded ? 'Barang dan stok awal tersimpan.' : 'Barang tersimpan.');
    await fetchCategories();
    await fetchProducts();
  } catch (err) {
    if (err.message === 'image_too_large') {
      showToast('Gambar harus di bawah 100KB.', true);
    } else if (err.message === 'invalid_image') {
      showToast('Format gambar tidak valid.', true);
    } else if (err.message === 'missing_buy_for_initial_stock') {
      showToast('Stok awal butuh harga beli. Isi harga beli default dulu.', true);
    } else if (err.message === 'invalid_initial_stock') {
      showToast('Nilai stok awal tidak valid.', true);
    } else {
      showToast('Gagal simpan barang.', true);
    }
  }
});

editForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {};
  const formData = new FormData(editForm);
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) continue;
    payload[key] = value;
  }
  payload.is_active = editForm.elements.is_active.checked;
  const categoryValue = getCategoryValue(editCategorySelect, editCategoryInput);
  if (editCategorySelect?.value === CATEGORY_NEW && !categoryValue) {
    showToast('Kategori baru belum diisi.', true);
    return;
  }
  payload.category = categoryValue;
  if (state.editImage?.image) {
    try {
      payload.image_data = await buildAdjustedDataUrl(state.editImage);
    } catch (err) {
      showToast('Gambar harus di bawah 100KB.', true);
      return;
    }
  } else if (state.editImageRemove) {
    payload.image_remove = true;
  }

  try {
    const res = await fetchJson(`/api/products/${payload.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res) return;

    showToast('Barang diperbarui.');
    resetEditImageState('');
    closeDrawer();
    await fetchCategories();
    await fetchProducts();
  } catch (err) {
    if (err.message === 'duplicate_name') {
      showToast('Nama barang sudah ada.', true);
    } else if (err.message === 'image_too_large') {
      showToast('Gambar harus di bawah 100KB.', true);
    } else if (err.message === 'invalid_image') {
      showToast('Format gambar tidak valid.', true);
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
    closeDrawer();
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
  if (event.key !== 'Escape') return;
  if (quickModal && !quickModal.classList.contains('hidden')) {
    closeQuickModal();
    return;
  }
  if (isCreateSheetMode() && isCreateFormVisible()) {
    setCreateFormHidden(true);
  }
});

window.addEventListener('store:change', () => {
  state.selected = null;
  state.quickProduct = null;
  state.expandedMobileIds.clear();
  state.search = '';
  state.filterCategory = '';
  state.includeInactive = false;
  state.criticalOnly = false;
  state.sortKey = 'name';
  state.sortDirection = 'asc';
  isFilterPanelOpen = false;
  if (searchInput) searchInput.value = '';
  if (filterCategory) filterCategory.value = '';
  syncSearchClear();
  syncInactiveToggle();
  syncSortControls();
  persistListState();
  resetCreateImageState();
  resetEditImageState('');
  closeDrawer();
  if (quickModal) closeQuickModal();
  fetchCategories();
  fetchProducts();
});

(async function init() {
  document.documentElement.classList.add('products-no-x');
  await initNav('products');
  loadListState();
  applyUrlListPreset();
  bindMobileStoreSelect();
  bindViewportSafeArea();
  bindMobileCardSwipeActions();
  initPullToRefresh({
    key: 'products',
    onRefresh: async () => {
      await fetchCategories();
      await fetchProducts();
    }
  });
  syncSearchClear();
  syncInactiveToggle();
  syncSortControls();
  syncPageScrollLock();
  syncFilterPanelByViewport();
  loadCreateFormState();
  syncCreateFormByViewport();
  setupQuickSheetSwipeToClose();
  applyCategorySelection(
    categorySelect,
    categoryInputWrap,
    categoryInput,
    ''
  );
  applyCategorySelection(
    editCategorySelect,
    editCategoryInputWrap,
    editCategoryInput,
    ''
  );
  await fetchCategories();
  fetchProducts();
})();
