const labelInput = document.getElementById('label-input');
const loadBtn = document.getElementById('load-btn');
const refreshBtn = document.getElementById('refresh-btn');
const statusBar = document.getElementById('status-bar');
const summaryEl = document.getElementById('summary');
const emptyState = document.getElementById('empty-state');
const table = document.getElementById('issues-table');
const tbody = document.getElementById('issues-body');

let currentLabel = null;

function setStatus(message, isError = false) {
  statusBar.textContent = message;
  statusBar.classList.toggle('error', isError);
}

function statusBadgeClass(category) {
  switch (category) {
    case 'done':
      return 'badge-done';
    case 'indeterminate':
      return 'badge-indeterminate';
    case 'new':
      return 'badge-new';
    default:
      return 'badge-default';
  }
}

function relativeTime(isoString) {
  if (!isoString) return '-';
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function truncate(text, max = 220) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

let allIssues = [];
let currentFilter = null;

function renderIssues(data) {
  const { issues } = data;
  allIssues = issues;

  const counts = issues.reduce((acc, issue) => {
    acc[issue.status] = (acc[issue.status] || 0) + 1;
    return acc;
  }, {});

  summaryEl.innerHTML = '';
  const totalChip = document.createElement('span');
  totalChip.className = 'chip clickable';
  totalChip.innerHTML = `<strong>${issues.length}</strong> issue${issues.length === 1 ? '' : 's'}`;
  totalChip.addEventListener('click', () => {
    currentFilter = null;
    renderTable(allIssues);
  });
  summaryEl.appendChild(totalChip);

  Object.entries(counts).forEach(([status, count]) => {
    const chip = document.createElement('span');
    chip.className = 'chip clickable';
    chip.innerHTML = `<strong>${count}</strong> ${status}`;
    chip.addEventListener('click', () => {
      currentFilter = status;
      const filtered = allIssues.filter(issue => issue.status === status);
      renderTable(filtered);
    });
    summaryEl.appendChild(chip);
  });

  renderTable(issues);
}

function renderTable(issues) {
  tbody.innerHTML = '';

  if (issues.length === 0) {
    emptyState.classList.remove('hidden');
    emptyState.innerHTML = `<p>No issues found.</p>`;
    table.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  table.classList.remove('hidden');

  issues.forEach((issue) => {
    const tr = document.createElement('tr');

    const commentCell = issue.latestComment
      ? `<div class="comment-author">${issue.latestComment.author} - ${relativeTime(issue.latestComment.created)}</div>
         <div class="comment-body">${truncate(issue.latestComment.body)}</div>`
      : `<span class="no-comment">No comments yet</span>`;

    tr.innerHTML = `
      <td><a class="key-link" href="${issue.url}" target="_blank" rel="noopener">${issue.key}</a></td>
      <td class="summary-text">${issue.summary}</td>
      <td><span class="badge ${statusBadgeClass(issue.statusCategory)}">${issue.status}</span></td>
      <td>${issue.assignee}</td>
      <td>${issue.reporter}</td>
      <td title="${issue.updated || ''}">${relativeTime(issue.updated)}</td>
      <td>${commentCell}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadIssues(label) {
  if (!label) {
    setStatus('Enter a label first.', true);
    return;
  }

  currentLabel = label;
  setStatus(`Loading issues for "${label}"...`);

  try {
    const res = await fetch(`/api/issues?label=${encodeURIComponent(label)}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }

    renderIssues(data);
    setStatus(`Last updated ${new Date(data.generatedAt).toLocaleTimeString()} - ${data.total} issue(s) for "${data.label}"`);
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function init() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    labelInput.value = config.defaultLabel || '';

    if (!config.configured) {
      setStatus('Server is missing JIRA_BASE_URL / JIRA_PAT. Fill in .env and restart the server.', true);
      return;
    }

    if (config.defaultLabel) {
      loadIssues(config.defaultLabel);
    }
  } catch (err) {
    setStatus('Could not reach the local server.', true);
  }
}

loadBtn.addEventListener('click', () => loadIssues(labelInput.value.trim()));
refreshBtn.addEventListener('click', () => loadIssues(currentLabel || labelInput.value.trim()));
labelInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadIssues(labelInput.value.trim());
});

init();
