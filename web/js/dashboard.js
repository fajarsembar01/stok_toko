import {
  escapeHtml,
  fetchJson,
  formatCurrency,
  formatNumber,
  formatSignedCurrency,
  getActiveStoreId,
  initPullToRefresh,
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
const auditMobileList = document.getElementById('audit-mobile-list');
const refreshBtn = document.getElementById('refresh-btn');
const superRefreshBtn = document.getElementById('super-refresh-btn');
const statusPill = document.getElementById('status-pill');
const superOmzet = document.getElementById('super-omzet');
const superTodayCount = document.getElementById('super-today-count');
const superCriticalCount = document.getElementById('super-critical-count');
const superPayableDue = document.getElementById('super-payable-due');
const superCriticalList = document.getElementById('super-critical-list');
let latestProducts = [];

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

function renderSuperCriticalProducts(products) {
  if (!superCriticalList) return;
  const critical = (products || [])
    .filter((item) => item?.is_active && Number(toNumber(item.stock) || 0) <= 5)
    .sort((left, right) => (toNumber(left.stock) || 0) - (toNumber(right.stock) || 0));

  superCriticalCount.textContent = formatNumber(critical.length);
  if (!critical.length) {
    superCriticalList.innerHTML = '<div class="audit-mobile-empty">Tidak ada stok kritis.</div>';
    return;
  }

  superCriticalList.innerHTML = critical.slice(0, 6).map((item) => {
    const stock = toNumber(item.stock) || 0;
    return `
      <a class="super-critical-item" href="/products?productId=${item.id}">
        <strong>${escapeHtml(item.name || '-')}</strong>
        <span class="stock-pill">${formatNumber(stock)}</span>
      </a>
    `;
  }).join('');
}

function getTodayRange() {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  );
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    from: start.toISOString(),
    to: end.toISOString()
  };
}

async function fetchTodaySnapshot() {
  const storeId = getActiveStoreId();
  const params = new URLSearchParams();
  const today = getTodayRange();
  params.set('type', 'OUT');
  params.set('from', today.from);
  params.set('to', today.to);
  params.set('limit', '200');
  if (storeId) params.set('storeId', storeId);

  try {
    const data = await fetchJson(`/api/transactions?${params.toString()}`);
    if (!data) return;
    const list = data.data || [];
    const omzet = list.reduce((sum, row) => sum + (toNumber(row.total) || 0), 0);
    if (superOmzet) superOmzet.textContent = formatCurrency(omzet);
    if (superTodayCount) superTodayCount.textContent = formatNumber(list.length);
  } catch (err) {
    if (superOmzet) superOmzet.textContent = 'Rp -';
    if (superTodayCount) superTodayCount.textContent = '-';
  }
}

function renderPayablesSummary(summary) {
  const totalPayable = toNumber(summary?.totalPayable) || 0;
  const totalPaid = toNumber(summary?.totalPaid) || 0;
  const balance = toNumber(summary?.balance) || 0;

  payableTotal.textContent = formatCurrency(totalPayable);
  payablePaid.textContent = formatCurrency(totalPaid);
  payableBalance.textContent = formatSignedCurrency(balance);
  if (superPayableDue) superPayableDue.textContent = formatCurrency(Math.max(balance, 0));
}

function renderAuditLogs(items) {
  const list = items || [];
  const rows = list
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

  if (!auditMobileList) return;
  const cards = list
    .map((item) => {
      const date = new Date(item.created_at);
      const dateLabel = Number.isNaN(date.getTime())
        ? '-'
        : date.toLocaleString('id-ID');
      return `
        <article class="audit-mobile-card">
          <div class="audit-mobile-head">
            <span class="status-pill">${escapeHtml(item.action || '-')}</span>
            <span class="cell-meta">${dateLabel}</span>
          </div>
          <div class="audit-mobile-title">${escapeHtml(item.entity || '-')}</div>
          <div class="audit-mobile-meta">User: ${escapeHtml(item.username || 'system')}</div>
          <div class="audit-mobile-meta">ID: ${escapeHtml(item.entity_id || '-')}</div>
        </article>
      `;
    })
    .join('');

  auditMobileList.innerHTML = cards || '<div class="audit-mobile-empty">Belum ada aktivitas.</div>';
}

function renderAuditSkeleton(count = 5) {
  const rows = Array.from({ length: count })
    .map(() => {
      return `
        <tr class="audit-skeleton-row">
          <td><span class="audit-skeleton-line w-24"></span></td>
          <td><span class="audit-skeleton-line w-16"></span></td>
          <td><span class="audit-skeleton-line w-20"></span></td>
          <td><span class="audit-skeleton-line w-24"></span></td>
          <td><span class="audit-skeleton-line w-10"></span></td>
        </tr>
      `;
    })
    .join('');
  auditRows.innerHTML = rows;

  if (!auditMobileList) return;
  const cards = Array.from({ length: Math.min(count, 4) })
    .map(() => {
      return `
        <div class="audit-mobile-card audit-mobile-skeleton">
          <span class="audit-skeleton-line w-20"></span>
          <span class="audit-skeleton-line w-28"></span>
          <span class="audit-skeleton-line w-24"></span>
        </div>
      `;
    })
    .join('');
  auditMobileList.innerHTML = cards;
}

async function fetchProducts() {
  const storeId = getActiveStoreId();
  const params = new URLSearchParams();
  if (storeId) params.set('storeId', storeId);
  try {
    const data = await fetchJson(`/api/products?${params.toString()}`);
    if (!data) return;
    latestProducts = data.data || [];
    renderStats(latestProducts);
    renderSuperCriticalProducts(latestProducts);
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
  renderAuditSkeleton();
  try {
    const data = await fetchJson('/api/audit-logs?limit=8');
    if (!data) return;
    renderAuditLogs(data.data);
  } catch (err) {
    showToast('Gagal memuat audit log.', true);
    auditRows.innerHTML = '<tr><td colspan="5">Gagal memuat aktivitas.</td></tr>';
    if (auditMobileList) {
      auditMobileList.innerHTML = '<div class="audit-mobile-empty">Gagal memuat aktivitas.</div>';
    }
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
    fetchTodaySnapshot(),
    checkHealth()
  ]);
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', refreshAll);
}

if (superRefreshBtn) {
  superRefreshBtn.addEventListener('click', refreshAll);
}

window.addEventListener('store:change', refreshAll);

(async function init() {
  await initNav('dashboard');
  initPullToRefresh({
    key: 'dashboard',
    onRefresh: refreshAll
  });
  refreshAll();
})();
