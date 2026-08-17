# Jira Reports Dashboard

A tiny local dashboard that lists every Jira issue under a given label — with
status and the latest comment shown inline — so you don't have to open each
ticket one by one.

Built for tracking issues under labels like `V3_reports_issue2026`, but works
with any label on your Jira instance.

## 1. Get API Credentials

### For Jira Cloud (e.g., `jira.cloud.intuit.com`)

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click **Create API token**
3. Give it a name like `reports-dashboard`
4. Copy the token value — you won't be able to see it again
5. You'll also need your Jira email address

### For Jira Server/Data Center

1. In Jira, click your profile picture → **Personal Access Tokens**
2. Create a new token (give it a name like `reports-dashboard`)
3. Copy the token value — you won't be able to see it again

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and fill in:

**For Jira Cloud:**
- `JIRA_BASE_URL` — use the `*.atlassian.net` URL for API calls (e.g. `https://intuit-prod.atlassian.net`), **not** the custom browser domain (e.g. `jira.cloud.intuit.com`). Scoped API tokens return 401 against custom-domain URLs.
- `JIRA_EMAIL` — your Jira account email
- `JIRA_API_TOKEN` — the API token from step 1
- `JIRA_DEFAULT_LABEL` — defaults to `V3_reports_issue2026`, change if needed

**For Jira Server/Data Center:**
- `JIRA_BASE_URL` — e.g. `https://jira.yourcompany.com`
- `JIRA_PAT` — the Personal Access Token from step 1
- `JIRA_DEFAULT_LABEL` — defaults to `V3_reports_issue2026`, change if needed

`.env` is git-ignored, so your credentials never get committed.

## 3. Install & run

```bash
npm install
npm start
```

Then open **http://localhost:4321** in your browser.

## What it does

- Queries Jira via JQL: `labels = "<label>" ORDER BY updated DESC`
- Pulls `status`, `assignee`, `updated`, and the most recent comment for every
  matching issue (handles pagination automatically for large result sets)
- Renders it as a sortable-by-eye table with clickable issue links, a status
  color badge, and a summary chip bar (counts per status)
- You can change the label from the input box at the top and hit **Load**
  without restarting the server; **Refresh** re-fetches the current label

## Troubleshooting

- **401/403 error in the dashboard** — your credentials are missing, expired, or wrong.
  - For Jira Cloud: regenerate API token at https://id.atlassian.com/manage-profile/security/api-tokens
  - For Jira Server/Data Center: regenerate PAT in Jira
  - Update `.env` and restart (`npm start`)
- **401 with valid credentials on a custom Jira domain** — set `JIRA_BASE_URL` to your site's `*.atlassian.net` URL (find it via `https://<your-domain>/_edge/tenant_info` or in Jira **Settings → System → General configuration**). Scoped API tokens do not authenticate against custom-domain URLs like `jira.cloud.intuit.com`.
- **TLS / self-signed certificate errors** — set `JIRA_ALLOW_INSECURE_TLS=true`
  in `.env` (only do this on a trusted corporate network).
- **No issues showing up** — double check the exact label spelling/casing used
  on your Jira tickets.
