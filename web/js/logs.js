import { escapeHtml, fetchJson, initNav, showToast } from './shared.js';

const auditRows = document.getElementById('audit-rows');
const refreshBtn = document.getElementById('refresh-btn');

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

async function fetchAuditLogs() {
  try {
    const data = await fetchJson('/api/audit-logs?limit=50');
    if (!data) return;
    renderAuditLogs(data.data);
  } catch (err) {
    showToast('Gagal memuat audit log.', true);
  }
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', fetchAuditLogs);
}

(async function init() {
  await initNav('logs');
  fetchAuditLogs();
})();
