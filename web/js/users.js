import {
  escapeHtml,
  fetchJson,
  initNav,
  showToast
} from './shared.js';

const userRows = document.getElementById('user-rows');
const refreshBtn = document.getElementById('refresh-btn');
const createForm = document.getElementById('create-form');
const drawer = document.getElementById('drawer');
const drawerBackdrop = document.getElementById('drawer-backdrop');
const drawerTitle = document.getElementById('drawer-title');
const drawerSummary = document.getElementById('drawer-summary');
const closeDrawerBtn = document.getElementById('close-drawer');
const editForm = document.getElementById('edit-form');
const deactivateBtn = document.getElementById('deactivate-btn');
const createDefaultStore = document.getElementById('create-default-store');
const editDefaultStore = document.getElementById('edit-default-store');

const state = {
  users: [],
  stores: [],
  selected: null
};

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

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('id-ID');
}

function formatStoreLabel(user) {
  if (!user?.default_store_name) return '-';
  const suffix = user.default_store_active === false ? ' (Nonaktif)' : '';
  return `${escapeHtml(user.default_store_name)}${suffix}`;
}

function renderStoreOptions(select) {
  if (!select) return;
  if (!state.stores.length) {
    select.innerHTML = '<option value="">Belum ada toko</option>';
    select.disabled = true;
    return;
  }

  const options = ['<option value="">Tanpa default</option>'];
  state.stores.forEach((store) => {
    const suffix = store.is_active ? '' : ' (Nonaktif)';
    const label = `${escapeHtml(store.name)}${suffix}`;
    options.push(`<option value="${store.id}">${label}</option>`);
  });
  select.innerHTML = options.join('');
  select.disabled = false;
}

function syncStoreSelects() {
  renderStoreOptions(createDefaultStore);
  renderStoreOptions(editDefaultStore);
  if (editDefaultStore) {
    const selected = state.selected?.default_store_id;
    editDefaultStore.value = selected ? String(selected) : '';
  }
}

function renderTable() {
  const rows = state.users
    .map((user) => {
      const statusClass = user.is_active ? 'status-active' : 'status-inactive';
      const statusLabel = user.is_active ? 'Aktif' : 'Nonaktif';
      const storeLabel = formatStoreLabel(user);
      return `
        <tr data-id="${user.id}">
          <td>
            <div class="cell-title">${escapeHtml(user.username)}</div>
            <div class="cell-meta">ID ${user.id}</div>
          </td>
          <td>${escapeHtml(user.role)}</td>
          <td>${storeLabel}</td>
          <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
          <td>${formatDate(user.last_login_at)}</td>
          <td>${formatDate(user.created_at)}</td>
          <td><button class="ghost" data-action="edit">Edit</button></td>
        </tr>
      `;
    })
    .join('');

  userRows.innerHTML = rows ||
    '<tr><td colspan="7">Belum ada pengguna lain.</td></tr>';
}

function renderDrawer(user) {
  if (!user) return;
  const storeLabel = formatStoreLabel(user);
  drawerTitle.textContent = user.username;
  drawerSummary.innerHTML = `
    <div>Role<br /><span>${escapeHtml(user.role)}</span></div>
    <div>Status<br /><span>${user.is_active ? 'Aktif' : 'Nonaktif'}</span></div>
    <div>Default toko<br /><span>${storeLabel}</span></div>
    <div>Login terakhir<br /><span>${formatDate(user.last_login_at)}</span></div>
    <div>Dibuat<br /><span>${formatDate(user.created_at)}</span></div>
  `;

  editForm.elements.id.value = user.id;
  editForm.elements.username.value = user.username || '';
  editForm.elements.role.value = user.role || 'staff';
  editForm.elements.password.value = '';
  editForm.elements.is_active.checked = Boolean(user.is_active);
  if (editForm.elements.default_store_id) {
    editForm.elements.default_store_id.value = user.default_store_id
      ? String(user.default_store_id)
      : '';
  }

  deactivateBtn.textContent = user.is_active ? 'Nonaktifkan' : 'Aktifkan';
  syncStoreSelects();
  openDrawer();
}

async function fetchStores() {
  try {
    const data = await fetchJson('/api/stores?includeInactive=true');
    if (!data) return;
    state.stores = (data.data || []).map((store) => ({
      ...store,
      id: Number(store.id),
      is_active: Boolean(store.is_active)
    }));
    syncStoreSelects();
  } catch (err) {
    showToast('Gagal memuat daftar toko.', true);
  }
}

async function fetchUsers() {
  try {
    const data = await fetchJson('/api/users');
    if (!data) return;
    state.users = (data.data || []).map((user) => ({
      ...user,
      id: Number(user.id),
      default_store_id: Number.isFinite(Number(user.default_store_id))
        ? Number(user.default_store_id)
        : null,
      default_store_active:
        user.default_store_active === true
          ? true
          : user.default_store_active === false
            ? false
            : null
    }));
    renderTable();
  } catch (err) {
    showToast('Gagal memuat data pengguna.', true);
  }
}

userRows.addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-id]');
  if (!row) return;
  const id = Number(row.dataset.id);
  const user = state.users.find((item) => item.id === id);
  if (!user) return;
  state.selected = user;
  renderDrawer(user);
});

closeDrawerBtn.addEventListener('click', () => {
  closeDrawer();
});

if (drawerBackdrop) {
  drawerBackdrop.addEventListener('click', closeDrawer);
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    fetchStores();
    fetchUsers();
  });
}

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(createForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const res = await fetchJson('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res) return;

    createForm.reset();
    showToast('User tersimpan.');
    fetchUsers();
  } catch (err) {
    if (err.message === 'duplicate_username') {
      showToast('Username sudah dipakai.', true);
    } else if (err.message === 'password_too_short') {
      showToast('Password minimal 6 karakter.', true);
    } else if (
      err.message === 'invalid_store' ||
      err.message === 'store_not_found'
    ) {
      showToast('Default toko tidak valid.', true);
    } else if (err.message === 'store_inactive') {
      showToast('Default toko sedang nonaktif.', true);
    } else {
      showToast('Gagal simpan user.', true);
    }
  }
});

editForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(editForm);
  const payload = Object.fromEntries(formData.entries());
  payload.is_active = editForm.elements.is_active.checked;

  try {
    const res = await fetchJson(`/api/users/${payload.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res) return;

    showToast('User diperbarui.');
    closeDrawer();
    fetchUsers();
  } catch (err) {
    if (err.message === 'duplicate_username') {
      showToast('Username sudah dipakai.', true);
    } else if (err.message === 'password_too_short') {
      showToast('Password minimal 6 karakter.', true);
    } else if (err.message === 'cannot_disable_self') {
      showToast('Tidak bisa nonaktifkan akun sendiri.', true);
    } else if (err.message === 'cannot_downgrade_self') {
      showToast('Role akun sendiri harus tetap admin.', true);
    } else if (
      err.message === 'invalid_store' ||
      err.message === 'store_not_found'
    ) {
      showToast('Default toko tidak valid.', true);
    } else if (err.message === 'store_inactive') {
      showToast('Default toko sedang nonaktif.', true);
    } else {
      showToast('Gagal update user.', true);
    }
  }
});

deactivateBtn.addEventListener('click', async () => {
  const user = state.selected;
  if (!user) return;

  try {
    const res = await fetchJson(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !user.is_active })
    });

    if (!res) return;

    showToast(user.is_active ? 'User dinonaktifkan.' : 'User diaktifkan.');
    closeDrawer();
    fetchUsers();
  } catch (err) {
    if (err.message === 'cannot_disable_self') {
      showToast('Tidak bisa nonaktifkan akun sendiri.', true);
    } else {
      showToast('Gagal ubah status user.', true);
    }
  }
});

((async function init() {
  await initNav('users');
  await fetchStores();
  fetchUsers();
})());
