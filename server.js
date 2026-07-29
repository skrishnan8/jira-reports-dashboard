require('dotenv').config();

const path = require('path');
const express = require('express');
const { Agent, setGlobalDispatcher } = require('undici');

const {
  JIRA_BASE_URL,
  JIRA_EMAIL,
  JIRA_API_TOKEN,
  JIRA_PAT,
  JIRA_DEFAULT_LABEL = 'V3_reports_issue2026',
  JIRA_ALLOW_INSECURE_TLS,
  PORT = 4321,
} = process.env;

if (JIRA_ALLOW_INSECURE_TLS === 'true') {
  // Only for corporate networks with a self-signed/internal CA that Node
  // doesn't trust. Leave disabled unless you hit TLS handshake errors.
  setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

function escapeJql(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function jiraFetch(apiPath, options = {}) {
  if (!JIRA_BASE_URL) {
    const err = new Error('Missing JIRA_BASE_URL in .env');
    err.status = 500;
    throw err;
  }

  // Determine auth method: prefer Basic Auth (email + API token) for Jira Cloud
  let authHeader;
  if (JIRA_EMAIL && JIRA_API_TOKEN) {
    const credentials = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
    authHeader = `Basic ${credentials}`;
  } else if (JIRA_PAT) {
    authHeader = `Bearer ${JIRA_PAT}`;
  } else {
    const err = new Error(
      'Missing authentication. Set JIRA_EMAIL + JIRA_API_TOKEN (for Cloud) or JIRA_PAT (for Server/Data Center) in .env'
    );
    err.status = 500;
    throw err;
  }

  const url = `${JIRA_BASE_URL.replace(/\/$/, '')}${apiPath}`;
  const fetchOptions = {
    method: options.method || 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      ...options.headers,
    },
  };

  if (options.body) {
    fetchOptions.body = JSON.stringify(options.body);
    fetchOptions.headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, fetchOptions);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(
      `Jira request failed (${res.status} ${res.statusText}): ${body.slice(0, 300)}`
    );
    err.status = res.status === 401 || res.status === 403 ? res.status : 502;
    throw err;
  }

  return res.json();
}

// Convert ADF (Atlassian Document Format) to plain text
function adfToPlainText(adf) {
  if (!adf || typeof adf === 'string') return adf || '';
  if (adf.type === 'doc') {
    return (adf.content || []).map(adfToPlainText).join('\n');
  }
  if (adf.type === 'paragraph') {
    return (adf.content || []).map(adfToPlainText).join('');
  }
  if (adf.type === 'text') {
    return adf.text || '';
  }
  if (adf.type === 'hardBreak') {
    return '\n';
  }
  // For other types (mentions, links, etc.), try to extract text
  if (adf.content) {
    return (adf.content || []).map(adfToPlainText).join('');
  }
  return '';
}

function extractLatestComment(issue) {
  const comments = issue.fields?.comment?.comments || [];
  if (comments.length === 0) return null;
  const last = comments[comments.length - 1];
  return {
    author: last.author?.displayName || last.author?.name || 'Unknown',
    body: adfToPlainText(last.body),
    created: last.created,
  };
}

function simplifyIssue(issue) {
  const fields = issue.fields || {};
  return {
    key: issue.key,
    url: `${JIRA_BASE_URL.replace(/\/$/, '')}/browse/${issue.key}`,
    summary: fields.summary || '(no summary)',
    status: fields.status?.name || 'Unknown',
    statusCategory: fields.status?.statusCategory?.key || 'new',
    priority: fields.priority?.name || null,
    issueType: fields.issuetype?.name || null,
    assignee: fields.assignee?.displayName || 'Unassigned',
    reporter: fields.reporter?.displayName || 'Unknown',
    updated: fields.updated,
    latestComment: extractLatestComment(issue),
  };
}

app.get('/api/config', (req, res) => {
  const isConfigured = Boolean(
    JIRA_BASE_URL && ((JIRA_EMAIL && JIRA_API_TOKEN) || JIRA_PAT)
  );
  res.json({
    baseUrl: JIRA_BASE_URL || null,
    defaultLabel: JIRA_DEFAULT_LABEL,
    configured: isConfigured,
  });
});

// Debug endpoint to test auth and get current user
app.get('/api/test-auth', async (req, res) => {
  try {
    const result = await jiraFetch('/rest/api/3/myself');
    res.json({
      authenticated: true,
      user: {
        email: result.emailAddress,
        displayName: result.displayName,
        accountId: result.accountId,
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({
      authenticated: false,
      error: err.message
    });
  }
});

// Debug endpoint to list projects
app.get('/api/test-projects', async (req, res) => {
  try {
    const result = await jiraFetch('/rest/api/3/project/search?maxResults=50');
    res.json({
      total: result.total,
      projects: result.values?.map(p => ({
        key: p.key,
        name: p.name,
        id: p.id,
      })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Debug endpoint to test JQL query using POST
app.get('/api/test-jql', async (req, res) => {
  // Use a bounded query - required by new API
  const testJql = req.query.jql || 'project is not empty order by updated DESC';
  try {
    const result = await jiraFetch('/rest/api/3/search/jql', {
      method: 'POST',
      body: {
        jql: testJql,
        maxResults: 10,
        fields: ['summary', 'labels', 'status', 'project'],
      },
    });
    res.json({
      jql: testJql,
      total: result.total,
      returned: result.issues?.length || 0,
      issues: result.issues?.map(i => ({
        key: i.key,
        summary: i.fields?.summary,
        labels: i.fields?.labels,
        status: i.fields?.status?.name,
        project: i.fields?.project?.key,
      })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/issues', async (req, res) => {
  const label = (req.query.label || JIRA_DEFAULT_LABEL || '').trim();
  if (!label) {
    return res.status(400).json({ error: 'A label is required.' });
  }

  const jql = `labels = ${escapeJql(label)} ORDER BY updated DESC`;
  const fields = ['summary', 'status', 'priority', 'issuetype', 'assignee', 'reporter', 'updated', 'comment'];
  const pageSize = 50;

  try {
    let nextPageToken = null;
    const issues = [];

    // Use token-based pagination for the new /rest/api/3/search/jql API
    do {
      const body = {
        jql,
        fields,
        maxResults: pageSize,
      };

      if (nextPageToken) {
        body.nextPageToken = nextPageToken;
      }

      const page = await jiraFetch('/rest/api/3/search/jql', {
        method: 'POST',
        body,
      });

      issues.push(...(page.issues || []).map(simplifyIssue));
      nextPageToken = page.isLast ? null : page.nextPageToken;

      if (!page.issues || page.issues.length === 0) break;
    } while (nextPageToken);

    res.json({
      label,
      total: issues.length,
      generatedAt: new Date().toISOString(),
      issues,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Jira reports dashboard running at http://localhost:${PORT}`);
  const isConfigured = Boolean(
    JIRA_BASE_URL && ((JIRA_EMAIL && JIRA_API_TOKEN) || JIRA_PAT)
  );
  if (!isConfigured) {
    console.warn(
      'Warning: Jira credentials not set. Copy .env.example to .env and fill in either:\n' +
      '  - JIRA_EMAIL + JIRA_API_TOKEN (for Jira Cloud), or\n' +
      '  - JIRA_PAT (for Jira Server/Data Center)'
    );
  }
});
