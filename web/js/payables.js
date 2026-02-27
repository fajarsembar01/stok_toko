import {
  escapeHtml,
  fetchJson,
  formatCurrency,
  formatSignedCurrency,
  getActiveStoreId,
  initPullToRefresh,
  initNav,
  showToast,
  triggerSwipeFeedback,
  toNumber
} from './shared.js';

const payableTotal = document.getElementById('payable-total');
const payablePaid = document.getElementById('payable-paid');
const payableBalance = document.getElementById('payable-balance');
const paymentForm = document.getElementById('payment-form');
const payableRows = document.getElementById('payable-rows');
const payablesMobileList = document.getElementById('payables-mobile-list');
const paymentHistory = document.getElementById('payment-history');
const refreshBtn = document.getElementById('refresh-btn');
const paymentAmountInput = paymentForm?.elements?.amount || null;
const paymentNoteInput = paymentForm?.elements?.note || null;
const queryParams = new URLSearchParams(window.location.search);

const state = {
  products: []
};

function renderPayablesSummary(summary) {
  const totalPayable = toNumber(summary?.totalPayable) || 0;
  const totalPaid = toNumber(summary?.totalPaid) || 0;
  const balance = toNumber(summary?.balance) || 0;

  payableTotal.textContent = formatCurrency(totalPayable);
  payablePaid.textContent = formatCurrency(totalPaid);
  payableBalance.textContent = formatSignedCurrency(balance);
}

function renderPayableProducts(items) {
  state.products = (items || []).map((item, index) => ({
    ...item,
    _index: index,
    balance: toNumber(item.balance) || 0,
    payable_total: toNumber(item.payable_total) || 0,
    paid_total: toNumber(item.paid_total) || 0
  }));

  const rows = state.products
    .map((item) => {
      return `
        <tr data-index="${item._index}">
          <td>
            <div class="cell-title">${escapeHtml(item.item)}</div>
            <div class="cell-meta">${escapeHtml(item.unit || '-')}</div>
          </td>
          <td>${formatCurrency(item.payable_total)}</td>
          <td>${formatCurrency(item.paid_total)}</td>
          <td>${formatCurrency(item.balance)}</td>
        </tr>
      `;
    })
    .join('');

  payableRows.innerHTML = rows ||
    '<tr><td colspan="4">Belum ada utang modal.</td></tr>';
  renderPayablesMobileList();
}

function renderPayablesMobileList() {
  if (!payablesMobileList) return;
  const cards = state.products
    .map((item) => {
      const balanceClass = item.balance > 0 ? 'status-inactive' : 'status-active';
      return `
        <article
          class="payable-mobile-card"
          data-index="${item._index}"
          tabindex="0"
          role="button"
          aria-label="Utang produk ${escapeHtml(item.item)}"
        >
          <div class="payable-mobile-head">
            <div>
              <strong>${escapeHtml(item.item)}</strong>
              <p>${escapeHtml(item.unit || '-')}</p>
            </div>
            <span class="status-pill ${balanceClass}">${formatCurrency(item.balance)}</span>
          </div>
          <div class="payable-mobile-metrics">
            <div>
              <span>Modal</span>
              <strong>${formatCurrency(item.payable_total)}</strong>
            </div>
            <div>
              <span>Terbayar</span>
              <strong>${formatCurrency(item.paid_total)}</strong>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  payablesMobileList.innerHTML = cards || '<div class="audit-mobile-empty">Belum ada utang modal.</div>';
}

function getPayableByIndex(indexValue) {
  const index = Number(indexValue);
  if (!Number.isFinite(index) || index < 0) return null;
  return state.products.find((item) => item._index === index) || null;
}

function focusPaymentForm({ amount = null, note = '' } = {}) {
  if (!(paymentAmountInput instanceof HTMLInputElement)) return;
  if (amount != null && Number.isFinite(Number(amount))) {
    paymentAmountInput.value = formatCurrency(Number(amount));
  }
  if (paymentNoteInput instanceof HTMLInputElement && note) {
    paymentNoteInput.value = note;
  }
  paymentAmountInput.focus();
  paymentAmountInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function applyPayableSuggestion(item, fallbackCard = null) {
  if (!item) return;
  if ((toNumber(item.balance) || 0) <= 0) {
    showToast('Produk ini sudah lunas.', true);
    return;
  }
  focusPaymentForm({
    amount: item.balance,
    note: `Bayar modal: ${item.item}`
  });
  const card =
    payablesMobileList?.querySelector(`.payable-mobile-card[data-index="${item._index}"]`) ||
    fallbackCard;
  triggerSwipeFeedback(card, 'success');
}

function bindPayablesMobileSwipeActions() {
  if (!payablesMobileList || payablesMobileList.dataset.swipeBound === 'true') return;
  payablesMobileList.dataset.swipeBound = 'true';

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
    return target.closest('.payable-mobile-card[data-index]');
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

  payablesMobileList.addEventListener(
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

  payablesMobileList.addEventListener(
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
    const shouldFillPayment = delta >= 56;
    const shouldOpenProducts = delta <= -56;
    const item = getPayableByIndex(card.dataset.index);

    releaseCard();
    swipe.card = null;
    swipe.offsetX = 0;
    swipe.dragging = false;

    if (!item) return;
    if (!shouldFillPayment && !shouldOpenProducts) return;

    swipe.suppressClickUntil = Date.now() + 300;
    if (shouldOpenProducts) {
      const query = encodeURIComponent(String(item.item || '').trim());
      window.location.href = `/products?search=${query}`;
      return;
    }

    applyPayableSuggestion(item, card);
  };

  payablesMobileList.addEventListener('touchend', endSwipe);
  payablesMobileList.addEventListener('touchcancel', endSwipe);

  payablesMobileList.addEventListener('click', (event) => {
    if (Date.now() < swipe.suppressClickUntil) return;
    const card = resolveCard(event.target);
    if (!card) return;
    const item = getPayableByIndex(card.dataset.index);
    applyPayableSuggestion(item, card);
  });

  payablesMobileList.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = resolveCard(event.target);
    if (!card) return;
    event.preventDefault();
    const item = getPayableByIndex(card.dataset.index);
    applyPayableSuggestion(item, card);
  });
}

function renderPaymentHistory(items) {
  const history = (items || [])
    .map((item) => {
      const date = new Date(item.created_at);
      const dateLabel = Number.isNaN(date.getTime())
        ? '-'
        : date.toLocaleString('id-ID');
      const remaining = toNumber(item.remaining_amount) || 0;
      const note = item.note ? escapeHtml(item.note) : 'Tanpa catatan';

      return `
        <div class="history-item">
          <strong>${formatCurrency(item.amount)}</strong>
          <div>${note}</div>
          <div>Sisa kredit: ${formatCurrency(remaining)}</div>
          <div>${dateLabel}</div>
        </div>
      `;
    })
    .join('');

  paymentHistory.innerHTML = history || '<div>Belum ada pembayaran.</div>';
}

function renderPayablesSkeleton() {
  payableRows.innerHTML = Array.from({ length: 4 })
    .map(() => {
      return `
        <tr class="audit-skeleton-row">
          <td><span class="audit-skeleton-line w-24"></span></td>
          <td><span class="audit-skeleton-line w-16"></span></td>
          <td><span class="audit-skeleton-line w-16"></span></td>
          <td><span class="audit-skeleton-line w-16"></span></td>
        </tr>
      `;
    })
    .join('');
  if (payablesMobileList) {
    payablesMobileList.innerHTML = Array.from({ length: 3 })
      .map(
        () => `
          <article class="payable-mobile-card audit-skeleton-row">
            <span class="audit-skeleton-line w-28"></span>
            <span class="audit-skeleton-line w-20"></span>
            <span class="audit-skeleton-line w-24"></span>
          </article>
        `
      )
      .join('');
  }
  paymentHistory.innerHTML = Array.from({ length: 3 })
    .map(() => '<div class="history-item"><span class="audit-skeleton-line w-24"></span></div>')
    .join('');
}

async function fetchPayables() {
  renderPayablesSkeleton();
  try {
    const storeId = getActiveStoreId();
    const params = new URLSearchParams();
    if (storeId) params.set('storeId', storeId);
    const [summary, products, payments] = await Promise.all([
      fetchJson(`/api/payables/summary?${params.toString()}`),
      fetchJson(`/api/payables/products?${params.toString()}`),
      fetchJson(`/api/payables/payments?${params.toString()}`)
    ]);

    if (!summary || !products || !payments) return;

    renderPayablesSummary(summary);
    renderPayableProducts(products.data);
    renderPaymentHistory(payments.data);
  } catch (err) {
    showToast('Gagal memuat data modal.', true);
  }
}

paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(paymentForm);
  const payload = Object.fromEntries(formData.entries());
  const storeId = getActiveStoreId();
  if (storeId) payload.store_id = storeId;

  try {
    const res = await fetchJson('/api/payables/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res) return;

    paymentForm.reset();
    showToast('Pembayaran modal tersimpan.');
    fetchPayables();
  } catch (err) {
    showToast('Gagal bayar modal.', true);
  }
});

if (refreshBtn) {
  refreshBtn.addEventListener('click', fetchPayables);
}

window.addEventListener('store:change', fetchPayables);

(async function init() {
  await initNav('payables');
  bindPayablesMobileSwipeActions();
  initPullToRefresh({
    key: 'payables',
    onRefresh: fetchPayables
  });
  fetchPayables();
  const quickParam = String(queryParams.get('quick') || '').trim().toLowerCase();
  if (quickParam === 'payment' && paymentAmountInput instanceof HTMLInputElement) {
    window.setTimeout(() => {
      paymentAmountInput.focus();
      paymentAmountInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 180);
  }
})();
