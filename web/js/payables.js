import {
  escapeHtml,
  fetchJson,
  formatCurrency,
  formatSignedCurrency,
  getActiveStoreId,
  initNav,
  showToast,
  toNumber
} from './shared.js';

const payableTotal = document.getElementById('payable-total');
const payablePaid = document.getElementById('payable-paid');
const payableBalance = document.getElementById('payable-balance');
const paymentForm = document.getElementById('payment-form');
const payableRows = document.getElementById('payable-rows');
const paymentHistory = document.getElementById('payment-history');
const refreshBtn = document.getElementById('refresh-btn');

function renderPayablesSummary(summary) {
  const totalPayable = toNumber(summary?.totalPayable) || 0;
  const totalPaid = toNumber(summary?.totalPaid) || 0;
  const balance = toNumber(summary?.balance) || 0;

  payableTotal.textContent = formatCurrency(totalPayable);
  payablePaid.textContent = formatCurrency(totalPaid);
  payableBalance.textContent = formatSignedCurrency(balance);
}

function renderPayableProducts(items) {
  const rows = (items || [])
    .map((item) => {
      const balance = toNumber(item.balance) || 0;
      return `
        <tr>
          <td>
            <div class="cell-title">${escapeHtml(item.item)}</div>
            <div class="cell-meta">${escapeHtml(item.unit || '-')}</div>
          </td>
          <td>${formatCurrency(item.payable_total)}</td>
          <td>${formatCurrency(item.paid_total)}</td>
          <td>${formatCurrency(balance)}</td>
        </tr>
      `;
    })
    .join('');

  payableRows.innerHTML = rows ||
    '<tr><td colspan="4">Belum ada utang modal.</td></tr>';
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

async function fetchPayables() {
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
  fetchPayables();
})();
