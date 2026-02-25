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

const productRows = document.getElementById('product-rows');
const searchInput = document.getElementById('search-input');
const filterCategory = document.getElementById('filter-category');
const toggleInactive = document.getElementById('toggle-inactive');
const refreshBtn = document.getElementById('refresh-btn');
const createForm = document.getElementById('create-form');
const productsGrid = document.getElementById('products-grid');
const createCard = document.getElementById('create-card');
const toggleCreateBtn = document.getElementById('toggle-create');
const drawer = document.getElementById('drawer');
const drawerBackdrop = document.getElementById('drawer-backdrop');
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

const CATEGORY_NEW = '__new__';
const CREATE_FORM_STORAGE_KEY = 'products:create-form-hidden';
const MAX_IMAGE_BYTES = 100 * 1024;
const IMAGE_MIN_DIM = 320;
const IMAGE_OUTPUT_SIZE = 640;
const IMAGE_MAX_ZOOM = 3;

const state = {
  products: [],
  categories: [],
  search: '',
  filterCategory: '',
  includeInactive: false,
  selected: null,
  quickProduct: null,
  createImage: null,
  editImage: null,
  editImageRemove: false
};

let searchTimer;

function setCreateFormHidden(hidden, shouldPersist = true) {
  if (!createCard || !productsGrid || !toggleCreateBtn) return;
  createCard.classList.toggle('hidden', hidden);
  productsGrid.classList.toggle('form-hidden', hidden);
  const label = hidden ? 'Tampilkan form' : 'Sembunyikan form';
  toggleCreateBtn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  toggleCreateBtn.setAttribute('aria-label', label);
  toggleCreateBtn.setAttribute('title', label);
  const icon = toggleCreateBtn.querySelector('.fab-icon');
  if (icon) icon.textContent = hidden ? '+' : '-';
  if (!shouldPersist) return;
  try {
    localStorage.setItem(CREATE_FORM_STORAGE_KEY, hidden ? '1' : '0');
  } catch (err) {
    // Ignore storage errors (private mode, etc.)
  }
}

function loadCreateFormState() {
  if (!toggleCreateBtn || !createCard || !productsGrid) return;
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
}

function closeDrawer() {
  if (!drawer) return;
  drawer.classList.remove('open');
  if (drawerBackdrop) drawerBackdrop.classList.add('hidden');
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
  if (!state.filterCategory) return state.products;
  const filterValue = normalizeCategory(state.filterCategory).toLowerCase();
  return state.products.filter((product) => {
    return normalizeCategory(product.category).toLowerCase() === filterValue;
  });
}

function renderTable() {
  const rows = getFilteredProducts()
    .map((product, index) => {
      const statusClass = product.is_active ? 'status-active' : 'status-inactive';
      const statusLabel = product.is_active ? 'Aktif' : 'Nonaktif';
      const buyPrice = pickPrice(product, 'buy');
      const sellPrice = pickPrice(product, 'sell');
      const payableMode = product.payable_mode === 'cash' ? 'Lunas' : 'Utang';
      const payableClass =
        product.payable_mode === 'cash' ? 'status-cash' : 'status-credit';

        const imageUrl = product.image_url ? escapeHtml(product.image_url) : '';
        const imageMarkup = imageUrl
          ? `<img class="thumb-img" src="${imageUrl}" alt="${escapeHtml(product.name)}" loading="lazy" />`
          : '<span>IMG</span>';

        return `
          <tr data-id="${product.id}" style="animation-delay:${index * 20}ms">
            <td class="img-col">
              <div class="thumb mx-auto">${imageMarkup}</div>
            </td>
            <td>
              <div class="cell-title">${escapeHtml(product.name)}</div>
              <div class="cell-meta">${escapeHtml(product.unit || '-')}</div>
            </td>
            <td class="optional-col">${escapeHtml(product.category || '-')}</td>
            <td>${formatNumber(product.stock)}</td>
            <td class="optional-col">${formatCurrency(buyPrice)}</td>
            <td>${formatCurrency(sellPrice)}</td>
            <td class="optional-col">${formatCurrency(product.revenue)}</td>
          <td class="optional-col">${formatCurrency(product.profit)}</td>
          <td class="optional-col"><span class="status-pill ${payableClass}">${payableMode}</span></td>
          <td class="optional-col"><span class="status-pill ${statusClass}">${statusLabel}</span></td>
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
    '<tr><td colspan="11">Belum ada data barang.</td></tr>';
}

function renderDrawer(product) {
  if (!product) return;
  const buyPrice = pickPrice(product, 'buy');
  const sellPrice = pickPrice(product, 'sell');
  const payableMode = product.payable_mode === 'cash' ? 'Lunas' : 'Utang';

  drawerTitle.textContent = product.name;
    drawerSummary.innerHTML = `
      <div>Stok<br /><span>${formatNumber(product.stock)}</span></div>
      <div>Kategori<br /><span>${escapeHtml(product.category || '-')}</span></div>
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

async function fetchProducts() {
  const params = new URLSearchParams();
  if (state.includeInactive) params.set('includeInactive', 'true');
  if (state.search) params.set('search', state.search);
  if (state.filterCategory) params.set('category', state.filterCategory);
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
    setCreateFormHidden(!isHidden);
  });
}

if (filterCategory) {
  filterCategory.addEventListener('change', (event) => {
    state.filterCategory = normalizeCategory(event.target.value);
    fetchProducts();
  });
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

searchInput.addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  state.search = event.target.value.trim();
  searchTimer = setTimeout(fetchProducts, 300);
});

toggleInactive.addEventListener('change', (event) => {
  state.includeInactive = event.target.checked;
  fetchProducts();
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
    showToast('Barang tersimpan.');
    await fetchCategories();
    await fetchProducts();
  } catch (err) {
    if (err.message === 'image_too_large') {
      showToast('Gambar harus di bawah 100KB.', true);
    } else if (err.message === 'invalid_image') {
      showToast('Format gambar tidak valid.', true);
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
  if (event.key === 'Escape' && quickModal && !quickModal.classList.contains('hidden')) {
    closeQuickModal();
  }
});

window.addEventListener('store:change', () => {
  state.selected = null;
  state.quickProduct = null;
  state.filterCategory = '';
  if (filterCategory) filterCategory.value = '';
  resetCreateImageState();
  resetEditImageState('');
  closeDrawer();
  if (quickModal) closeQuickModal();
  fetchCategories();
  fetchProducts();
});

(async function init() {
  await initNav('products');
  loadCreateFormState();
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
