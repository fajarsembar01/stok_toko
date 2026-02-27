import {
  fetchJson,
  initPullToRefresh,
  initNav,
  showToast,
  triggerSwipeFeedback
} from './shared.js';

const form = document.getElementById('wa-form');
const adminInput = document.getElementById('admin-wa-input');
const adminSource = document.getElementById('admin-wa-source');
const groupInput = document.getElementById('group-allowlist');
const saveSettingsBtn = document.getElementById('save-ai-settings');
const statusPill = document.getElementById('wa-status-pill');
const waNumber = document.getElementById('wa-number');
const waUpdated = document.getElementById('wa-updated');
const qrImage = document.getElementById('qr-image');
const qrPlaceholder = document.getElementById('qr-placeholder');
const qrUpdated = document.getElementById('qr-updated');
const refreshBtn = document.getElementById('refresh-btn');
const refreshQrBtn = document.getElementById('refresh-qr');
const resetBtn = document.getElementById('reset-wa');
const connectionCard = document.getElementById('wa-connection-card');

const statusClasses = ['status-active', 'status-inactive', 'status-credit'];

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('id-ID');
}

function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '-';
  if (digits.startsWith('62')) return `+${digits}`;
  return digits;
}

function setStatusPill(status) {
  if (!statusPill) return;
  statusClasses.forEach((cls) => statusPill.classList.remove(cls));

  let label = 'Tidak diketahui';
  let cls = 'status-inactive';

  if (status === 'connected') {
    label = 'Terhubung';
    cls = 'status-active';
  } else if (status === 'qr' || status === 'resetting') {
    label = status === 'resetting' ? 'Sedang reset' : 'Menunggu QR';
    cls = 'status-credit';
  } else if (status === 'logged_out') {
    label = 'Logout';
    cls = 'status-inactive';
  } else if (status === 'disconnected') {
    label = 'Terputus';
    cls = 'status-inactive';
  }

  statusPill.textContent = label;
  statusPill.classList.add(cls);
}

async function loadSettings() {
  try {
    const data = await fetchJson('/api/ai-settings');
    if (!data) return;
    adminInput.value = data.admin_wa_number || '';
    if (groupInput) {
      groupInput.value = data.ai_group_allowlist_text || '';
    }
    if (adminSource) {
      if (data.source === 'env') {
        adminSource.textContent = 'Sumber: ENV (.env).';
      } else if (data.source === 'db') {
        adminSource.textContent = 'Sumber: Database.';
      } else {
        adminSource.textContent = 'Sumber: belum diatur.';
      }
    }
  } catch (err) {
    showToast('Gagal memuat konfigurasi.', true);
  }
}

async function loadStatus() {
  try {
    const data = await fetchJson('/api/wa/status');
    if (!data) return;
    setStatusPill(data.status);
    if (waNumber) waNumber.textContent = formatPhone(data.wa_number);
    if (waUpdated) waUpdated.textContent = formatDate(data.updated_at);

    if (qrPlaceholder) {
      let placeholderText = 'QR belum tersedia. Pastikan bot aktif.';
      if (data.status === 'logged_out') {
        placeholderText =
          'Session logout. Jalankan bot (npm start), klik Reset koneksi, lalu scan QR.';
      } else if (data.status === 'disconnected') {
        placeholderText = 'Koneksi terputus. Jalankan bot (npm start) lalu reload QR.';
      } else if (data.status === 'unknown') {
        placeholderText = 'Status bot belum terbaca. Pastikan bot sedang berjalan.';
      }
      qrPlaceholder.textContent = placeholderText;
    }

    if (data.qr_available) {
      if (qrImage) {
        qrImage.src = `/api/wa/qr?ts=${Date.now()}`;
        qrImage.classList.remove('hidden');
      }
      if (qrPlaceholder) qrPlaceholder.classList.add('hidden');
    } else {
      if (qrImage) {
        qrImage.classList.add('hidden');
        qrImage.removeAttribute('src');
      }
      if (qrPlaceholder) qrPlaceholder.classList.remove('hidden');
    }

    if (qrUpdated) {
      qrUpdated.textContent = data.qr_updated_at
        ? `QR update: ${formatDate(data.qr_updated_at)}`
        : '';
    }
  } catch (err) {
    showToast('Gagal memuat status WA.', true);
  }
}

async function refreshQrStatus() {
  await loadStatus();
}

async function resetWaConnection({ withConfirm = true } = {}) {
  if (withConfirm) {
    const ok = window.confirm(
      'Reset koneksi WhatsApp? Bot akan meminta QR baru.'
    );
    if (!ok) return false;
  }

  try {
    const res = await fetchJson('/api/wa/reset', { method: 'POST' });
    if (!res) return false;
    showToast('Reset diminta. Tunggu QR baru.');
    await loadStatus();
    return true;
  } catch (err) {
    showToast('Gagal reset koneksi.', true);
    return false;
  }
}

async function refreshAll() {
  await Promise.all([loadSettings(), loadStatus()]);
}

function bindWaCardSwipeActions() {
  if (!connectionCard || connectionCard.dataset.swipeBound === 'true') return;
  connectionCard.dataset.swipeBound = 'true';

  const swipe = {
    startX: 0,
    startY: 0,
    offsetX: 0,
    dragging: false
  };

  connectionCard.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) return;
      swipe.startX = event.touches[0].clientX;
      swipe.startY = event.touches[0].clientY;
      swipe.offsetX = 0;
      swipe.dragging = false;
    },
    { passive: true }
  );

  connectionCard.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - swipe.startX;
      const deltaY = touch.clientY - swipe.startY;

      if (!swipe.dragging) {
        if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
        if (Math.abs(deltaX) <= Math.abs(deltaY) + 6) return;
        swipe.dragging = true;
        connectionCard.classList.add('is-swiping');
        connectionCard.style.transition = 'none';
      }

      swipe.offsetX = Math.max(-82, Math.min(82, deltaX));
      connectionCard.style.transform = `translateX(${swipe.offsetX}px)`;
      event.preventDefault();
    },
    { passive: false }
  );

  const finishSwipe = () => {
    const delta = swipe.offsetX;
    const shouldRefresh = delta >= 58;
    const shouldReset = delta <= -58;

    connectionCard.classList.remove('is-swiping');
    connectionCard.style.transition = 'transform 160ms ease';
    connectionCard.style.transform = 'translateX(0px)';
    window.setTimeout(() => {
      connectionCard.style.transition = '';
      connectionCard.style.transform = '';
    }, 170);

    swipe.offsetX = 0;
    swipe.dragging = false;

    if (shouldRefresh) {
      triggerSwipeFeedback(connectionCard, 'success');
      void refreshQrStatus();
    } else if (shouldReset) {
      triggerSwipeFeedback(connectionCard, 'danger');
      void resetWaConnection({ withConfirm: true });
    }
  };

  connectionCard.addEventListener('touchend', finishSwipe);
  connectionCard.addEventListener('touchcancel', finishSwipe);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    admin_wa_number: adminInput.value.trim(),
    ai_group_allowlist: groupInput ? groupInput.value.trim() : ''
  };

  try {
    const res = await fetchJson('/api/ai-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res) return;
    showToast('Konfigurasi tersimpan.');
    loadSettings();
  } catch (err) {
    showToast('Gagal menyimpan konfigurasi.', true);
  }
});

if (refreshBtn) {
  refreshBtn.addEventListener('click', refreshAll);
}

if (refreshQrBtn) {
  refreshQrBtn.addEventListener('click', refreshQrStatus);
}

if (resetBtn) {
  resetBtn.addEventListener('click', async () => {
    await resetWaConnection({ withConfirm: true });
  });
}

if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener('click', () => {
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return;
    }
    const event = new Event('submit', { cancelable: true });
    form.dispatchEvent(event);
  });
}

((async function init() {
  await initNav('ai-settings');
  bindWaCardSwipeActions();
  initPullToRefresh({
    key: 'ai-settings',
    onRefresh: refreshAll
  });
  refreshAll();
})());
