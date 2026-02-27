import {
  escapeHtml,
  fetchJson,
  initPullToRefresh,
  initNav,
  showUndoSnack,
  showToast,
  triggerSwipeFeedback
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
const userMobileList = document.getElementById('user-mobile-list');

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
          <td>
            <button
              class="ghost table-icon-btn"
              data-action="edit"
              aria-label="Edit pengguna"
              title="Edit pengguna"
            >
              <svg class="action-icon-symbol" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path
                  d="M4 20h4l10-10-4-4L4 16v4Zm11-13 2 2M14 6l2-2 4 4-2 2"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                ></path>
              </svg>
              <span class="sr-only">Edit</span>
            </button>
          </td>
        </tr>
      `;
    })
    .join('');

  userRows.innerHTML = rows ||
    '<tr><td colspan="7">Belum ada pengguna lain.</td></tr>';
  renderUserMobileList();
}

function renderUserMobileList() {
  if (!userMobileList) return;
  const cards = state.users
    .map((user) => {
      const statusClass = user.is_active ? 'status-active' : 'status-inactive';
      const statusLabel = user.is_active ? 'Aktif' : 'Nonaktif';
      const storeLabel = formatStoreLabel(user);
      return `
        <article
          class="entity-mobile-card"
          data-id="${user.id}"
          tabindex="0"
          role="button"
          aria-label="Detail pengguna ${escapeHtml(user.username)}"
        >
          <div class="entity-mobile-head">
            <div>
              <strong>${escapeHtml(user.username)}</strong>
              <p>ID ${user.id} | ${escapeHtml(user.role)}</p>
            </div>
            <span class="status-pill ${statusClass}">${statusLabel}</span>
          </div>
          <div class="entity-mobile-grid">
            <div>
              <span>Toko</span>
              <strong>${storeLabel}</strong>
            </div>
            <div>
              <span>Login</span>
              <strong>${formatDate(user.last_login_at)}</strong>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  userMobileList.innerHTML = cards || '<div class="audit-mobile-empty">Belum ada pengguna lain.</div>';
}

function openUserDetailById(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return;
  const user = state.users.find((item) => item.id === id);
  if (!user) return;
  state.selected = user;
  renderDrawer(user);
}

function getUserMobileCard(userId) {
  if (!userMobileList) return null;
  return userMobileList.querySelector(`.entity-mobile-card[data-id="${userId}"]`);
}

function setUserActiveLocal(userId, isActive) {
  const id = Number(userId);
  const user = state.users.find((item) => item.id === id);
  if (!user) return false;
  user.is_active = Boolean(isActive);
  if (state.selected?.id === id) {
    state.selected = user;
    if (drawer?.classList.contains('open')) {
      renderDrawer(user);
    }
  }
  renderTable();
  return true;
}

function queueUserActiveToggle(userId, nextActive, fallbackTarget = null) {
  const id = Number(userId);
  const user = state.users.find((item) => item.id === id);
  if (!user) return;
  const previousActive = Boolean(user.is_active);
  const targetActive = Boolean(nextActive);
  if (previousActive === targetActive) return;

  setUserActiveLocal(id, targetActive);
  const visual = getUserMobileCard(id) || fallbackTarget;
  triggerSwipeFeedback(visual, targetActive ? 'success' : 'danger');

  showUndoSnack({
    message: targetActive ? 'User diaktifkan.' : 'User dinonaktifkan.',
    actionLabel: 'Urungkan',
    duration: 4300,
    onUndo: () => {
      setUserActiveLocal(id, previousActive);
      const undoVisual = getUserMobileCard(id) || fallbackTarget;
      triggerSwipeFeedback(undoVisual, 'success');
    },
    onCommit: () => {
      void (async () => {
        try {
          const res = await fetchJson(`/api/users/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: targetActive })
          });

          if (!res) return;
        } catch (err) {
          setUserActiveLocal(id, previousActive);
          if (err.message === 'cannot_disable_self') {
            showToast('Tidak bisa nonaktifkan akun sendiri.', true);
          } else {
            showToast('Gagal ubah status user.', true);
          }
        }
      })();
    }
  });
}

function renderUsersSkeleton(count = 6) {
  userRows.innerHTML = Array.from({ length: count })
    .map(() => {
      return `
        <tr class="audit-skeleton-row">
          <td><span class="audit-skeleton-line w-24"></span></td>
          <td><span class="audit-skeleton-line w-16"></span></td>
          <td><span class="audit-skeleton-line w-20"></span></td>
          <td><span class="audit-skeleton-line w-16"></span></td>
          <td><span class="audit-skeleton-line w-20"></span></td>
          <td><span class="audit-skeleton-line w-20"></span></td>
          <td><span class="audit-skeleton-line w-10"></span></td>
        </tr>
      `;
    })
    .join('');
  if (userMobileList) {
    userMobileList.innerHTML = Array.from({ length: Math.max(2, Math.ceil(count / 2)) })
      .map(
        () => `
          <article class="entity-mobile-card audit-skeleton-row">
            <span class="audit-skeleton-line w-28"></span>
            <span class="audit-skeleton-line w-20"></span>
            <span class="audit-skeleton-line w-24"></span>
          </article>
        `
      )
      .join('');
  }
}

function bindUserMobileSwipeActions() {
  if (!userMobileList || userMobileList.dataset.swipeBound === 'true') return;
  userMobileList.dataset.swipeBound = 'true';

  const swipe = {
    card: null,
    startX: 0,
    startY: 0,
    offsetX: 0,
    dragging: false,
    suppressClickUntil: 0
  };

  const resolveCard = (target) => {
    if (!(target instanceof Element)) return null;
    return target.closest('.entity-mobile-card[data-id]');
  };

  const releaseCard = () => {
    if (!swipe.card) return;
    const card = swipe.card;
    card.classList.remove('is-swiping');
    card.style.transition = 'transform 150ms ease';
    card.style.transform = 'translateX(0px)';
    window.setTimeout(() => {
      card.style.transition = '';
      card.style.transform = '';
    }, 170);
  };

  userMobileList.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) return;
      const card = resolveCard(event.target);
      if (!card) return;
      swipe.card = card;
      swipe.startX = event.touches[0].clientX;
      swipe.startY = event.touches[0].clientY;
      swipe.offsetX = 0;
      swipe.dragging = false;
    },
    { passive: true }
  );

  userMobileList.addEventListener(
    'touchmove',
    (event) => {
      if (!swipe.card || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - swipe.startX;
      const deltaY = touch.clientY - swipe.startY;

      if (!swipe.dragging) {
        if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
        if (Math.abs(deltaX) <= Math.abs(deltaY) + 6) {
          swipe.card = null;
          return;
        }
        swipe.dragging = true;
        swipe.card.classList.add('is-swiping');
        swipe.card.style.transition = 'none';
      }

      swipe.offsetX = Math.max(-74, Math.min(74, deltaX));
      swipe.card.style.transform = `translateX(${swipe.offsetX}px)`;
      event.preventDefault();
    },
    { passive: false }
  );

  const endSwipe = () => {
    if (!swipe.card) return;
    const card = swipe.card;
    const delta = swipe.offsetX;
    const shouldActivate = delta >= 56;
    const shouldDetail = delta <= -56;
    const id = Number(card.dataset.id);

    releaseCard();
    swipe.card = null;
    swipe.offsetX = 0;
    swipe.dragging = false;

    if (!Number.isFinite(id) || id <= 0) return;
    if (!shouldActivate && !shouldDetail) return;

    swipe.suppressClickUntil = Date.now() + 300;
    if (shouldDetail) {
      openUserDetailById(id);
      triggerSwipeFeedback(getUserMobileCard(id), 'success');
      return;
    }
    const user = state.users.find((item) => item.id === id);
    if (!user) return;
    queueUserActiveToggle(id, !Boolean(user.is_active), card);
  };

  userMobileList.addEventListener('touchend', endSwipe);
  userMobileList.addEventListener('touchcancel', endSwipe);

  userMobileList.addEventListener('click', (event) => {
    if (Date.now() < swipe.suppressClickUntil) return;
    const card = resolveCard(event.target);
    if (!card) return;
    openUserDetailById(card.dataset.id);
  });

  userMobileList.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = resolveCard(event.target);
    if (!card) return;
    event.preventDefault();
    openUserDetailById(card.dataset.id);
  });
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
  renderUsersSkeleton();
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
  openUserDetailById(row.dataset.id);
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
  bindUserMobileSwipeActions();
  initPullToRefresh({
    key: 'users',
    onRefresh: async () => {
      await fetchStores();
      await fetchUsers();
    }
  });
  await fetchStores();
  fetchUsers();
})());
