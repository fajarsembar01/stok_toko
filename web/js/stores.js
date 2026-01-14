import {
  escapeHtml,
  fetchJson,
  initNav,
  refreshStoreSelector,
  showToast
} from './shared.js';

const storeRows = document.getElementById('store-rows');
const refreshBtn = document.getElementById('refresh-btn');
const createForm = document.getElementById('create-form');
const drawer = document.getElementById('drawer');
const drawerTitle = document.getElementById('drawer-title');
const drawerSummary = document.getElementById('drawer-summary');
const closeDrawerBtn = document.getElementById('close-drawer');
const editForm = document.getElementById('edit-form');
const deactivateBtn = document.getElementById('deactivate-btn');

const state = {
  stores: [],
  selected: null
};

function renderTable() {
  const rows = state.stores
    .map((store) => {
      const statusClass = store.is_active ? 'status-active' : 'status-inactive';
      const statusLabel = store.is_active ? 'Aktif' : 'Nonaktif';
      return `
        <tr data-id="${store.id}">
          <td>
            <div class="cell-title">${escapeHtml(store.name)}</div>
            <div class="cell-meta">ID ${store.id}</div>
          </td>
          <td>${escapeHtml(store.slug)}</td>
          <td>${escapeHtml(store.wa_trigger || '-')}</td>
          <td>${escapeHtml(store.category || '-')}</td>
          <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
          <td><button class="ghost" data-action="edit">Edit</button></td>
        </tr>
      `;
    })
    .join('');

  storeRows.innerHTML = rows ||
    '<tr><td colspan="6">Belum ada toko.</td></tr>';
}

function renderDrawer(store) {
  if (!store) return;
  drawerTitle.textContent = store.name;
  drawerSummary.innerHTML = `
    <div>Slug<br /><span>${escapeHtml(store.slug)}</span></div>
    <div>Trigger<br /><span>${escapeHtml(store.wa_trigger || '-')}</span></div>
    <div>Kategori<br /><span>${escapeHtml(store.category || '-')}</span></div>
    <div>Status<br /><span>${store.is_active ? 'Aktif' : 'Nonaktif'}</span></div>
  `;

  editForm.elements.id.value = store.id;
  editForm.elements.name.value = store.name || '';
  editForm.elements.slug.value = store.slug || '';
  editForm.elements.wa_trigger.value = store.wa_trigger || '';
  editForm.elements.category.value = store.category || '';
  editForm.elements.description.value = store.description || '';
  editForm.elements.is_active.checked = Boolean(store.is_active);

  deactivateBtn.textContent = store.is_active ? 'Nonaktifkan' : 'Aktifkan';
  drawer.classList.add('open');
}

async function fetchStores() {
  try {
    const data = await fetchJson('/api/stores?includeInactive=true');
    if (!data) return;
    state.stores = (data.data || []).map((store) => ({
      ...store,
      id: Number(store.id)
    }));
    renderTable();
  } catch (err) {
    showToast('Gagal memuat data toko.', true);
  }
}

storeRows.addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-id]');
  if (!row) return;
  const id = Number(row.dataset.id);
  const store = state.stores.find((item) => item.id === id);
  if (!store) return;
  state.selected = store;
  renderDrawer(store);
});

closeDrawerBtn.addEventListener('click', () => {
  drawer.classList.remove('open');
});

if (refreshBtn) {
  refreshBtn.addEventListener('click', fetchStores);
}

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(createForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const res = await fetchJson('/api/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res) return;

    createForm.reset();
    showToast('Toko tersimpan.');
    fetchStores();
    refreshStoreSelector();
  } catch (err) {
    if (err.message === 'duplicate_store') {
      showToast('Nama/slug/trigger sudah digunakan.', true);
    } else {
      showToast('Gagal simpan toko.', true);
    }
  }
});

editForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(editForm);
  const payload = Object.fromEntries(formData.entries());
  payload.is_active = editForm.elements.is_active.checked;

  try {
    const res = await fetchJson(`/api/stores/${payload.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res) return;

    showToast('Toko diperbarui.');
    drawer.classList.remove('open');
    fetchStores();
    refreshStoreSelector();
  } catch (err) {
    if (err.message === 'duplicate_store') {
      showToast('Nama/slug/trigger sudah digunakan.', true);
    } else {
      showToast('Gagal update toko.', true);
    }
  }
});

deactivateBtn.addEventListener('click', async () => {
  const store = state.selected;
  if (!store) return;

  try {
    const res = await fetchJson(`/api/stores/${store.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !store.is_active })
    });

    if (!res) return;

    showToast(store.is_active ? 'Toko dinonaktifkan.' : 'Toko diaktifkan.');
    drawer.classList.remove('open');
    fetchStores();
    refreshStoreSelector();
  } catch (err) {
    showToast('Gagal ubah status toko.', true);
  }
});

(async function init() {
  await initNav('stores');
  fetchStores();
})();
