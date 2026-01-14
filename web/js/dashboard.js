import {
  escapeHtml,
  fetchJson,
  formatCurrency,
  formatNumber,
  formatSignedCurrency,
  getActiveStoreId,
  initNav,
  showToast,
  toNumber
} from './shared.js';

const statProducts = document.getElementById('stat-products');
const statStock = document.getElementById('stat-stock');
const statRevenue = document.getElementById('stat-revenue');
const statProfit = document.getElementById('stat-profit');
const payableTotal = document.getElementById('payable-total');
const payablePaid = document.getElementById('payable-paid');
const payableBalance = document.getElementById('payable-balance');
const auditRows = document.getElementById('audit-rows');
const refreshBtn = document.getElementById('refresh-btn');
const statusPill = document.getElementById('status-pill');

function renderStats(products) {
  const activeProducts = (products || []).filter((item) => item.is_active);
  const totalStock = activeProducts.reduce(
    (sum, item) => sum + (toNumber(item.stock) || 0),
    0
  );
  const totalRevenue = activeProducts.reduce(
    (sum, item) => sum + (toNumber(item.revenue) || 0),
    0
  );
  const totalProfit = activeProducts.reduce(
    (sum, item) => sum + (toNumber(item.profit) || 0),
    0
  );

  statProducts.textContent = formatNumber(activeProducts.length);
  statStock.textContent = formatNumber(totalStock);
  statRevenue.textContent = formatCurrency(totalRevenue);
  statProfit.textContent = formatCurrency(totalProfit);
}

function renderPayablesSummary(summary) {
  const totalPayable = toNumber(summary?.totalPayable) || 0;
  const totalPaid = toNumber(summary?.totalPaid) || 0;
  const balance = toNumber(summary?.balance) || 0;

  payableTotal.textContent = formatCurrency(totalPayable);
  payablePaid.textContent = formatCurrency(totalPaid);
  payableBalance.textContent = formatSignedCurrency(balance);
}

function renderAuditLogs(items) {
  const rows = (items || [])
    .map((item) => {
      const date = new Date(item.created_at);
      const dateLabel = Number.isNaN(date.getTime())
        ? '-'
        : date.toLocaleString('id-ID');
      return `
        <tr>
          <td>${dateLabel}</td>
          <td>${escapeHtml(item.username || 'system')}</td>
          <td>${escapeHtml(item.action)}</td>
          <td>${escapeHtml(item.entity)}</td>
          <td>${escapeHtml(item.entity_id || '-')}</td>
        </tr>
      `;
    })
    .join('');

  auditRows.innerHTML = rows ||
    '<tr><td colspan="5">Belum ada aktivitas.</td></tr>';
}

async function fetchProducts() {
  const storeId = getActiveStoreId();
  const params = new URLSearchParams();
  if (storeId) params.set('storeId', storeId);
  try {
    const data = await fetchJson(`/api/products?${params.toString()}`);
    if (!data) return;
    renderStats(data.data || []);
  } catch (err) {
    showToast('Gagal memuat ringkasan produk.', true);
  }
}

async function fetchPayables() {
  const storeId = getActiveStoreId();
  const params = new URLSearchParams();
  if (storeId) params.set('storeId', storeId);
  try {
    const summary = await fetchJson(`/api/payables/summary?${params.toString()}`);
    if (!summary) return;
    renderPayablesSummary(summary);
  } catch (err) {
    showToast('Gagal memuat ringkasan modal.', true);
  }
}

async function fetchAuditLogs() {
  try {
    const data = await fetchJson('/api/audit-logs?limit=8');
    if (!data) return;
    renderAuditLogs(data.data);
  } catch (err) {
    showToast('Gagal memuat audit log.', true);
  }
}

async function checkHealth() {
  try {
    const data = await fetchJson('/api/health');
    if (!data) return;
    statusPill.textContent = data.ok ? 'DB ready' : 'DB error';
    statusPill.style.background = data.ok
      ? 'rgba(20, 184, 166, 0.14)'
      : 'rgba(239, 68, 68, 0.12)';
    statusPill.style.color = data.ok ? '#0f766e' : '#b91c1c';
  } catch (err) {
    statusPill.textContent = 'DB error';
    statusPill.style.background = 'rgba(239, 68, 68, 0.12)';
    statusPill.style.color = '#b91c1c';
  }
}

async function refreshAll() {
  await Promise.all([
    fetchProducts(),
    fetchPayables(),
    fetchAuditLogs(),
    checkHealth()
  ]);
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', refreshAll);
}

window.addEventListener('store:change', refreshAll);

(async function init() {
  await initNav('dashboard');
  refreshAll();
})();
