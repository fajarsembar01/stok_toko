import { escapeHtml, fetchJson, initNav, initPullToRefresh, showToast } from './shared.js';

const auditRows = document.getElementById('audit-rows');
const auditMobileList = document.getElementById('audit-mobile-list');
const refreshBtn = document.getElementById('refresh-btn');

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

function renderAuditSkeleton(count = 6) {
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
  const cards = Array.from({ length: Math.min(count, 5) })
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

async function fetchAuditLogs() {
  renderAuditSkeleton();
  try {
    const data = await fetchJson('/api/audit-logs?limit=50');
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

if (refreshBtn) {
  refreshBtn.addEventListener('click', fetchAuditLogs);
}

(async function init() {
  await initNav('logs');
  initPullToRefresh({
    key: 'logs',
    onRefresh: fetchAuditLogs
  });
  fetchAuditLogs();
})();
