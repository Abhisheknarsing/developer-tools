# DeveloperTool

Chrome extension for developers who work across **Jira** and **GitHub**. One popup shows tickets, open pull requests, recent comments, and items that need action (no update for more than 24 hours).

## Features

- **Quick Actions** (default tab) — My Items focus with Action Needed, In Progress, Open PR Comments, and Tester Comments
- Jira board sync through your browser login (no Jira token)
- **My Items** on Jira via assignee filter — exact email, display name, or logged-in `currentUser()`
- GitHub PR tracking for public and private repos
- GitHub Enterprise support via host setting or full repo URLs
- Private GitHub access using your browser session on that host (optional PAT fallback)
- Stale / action-required alerts, comment snippets, kanban & list views, CSV export
- Jira keys detected from PR title, body, or branch
- Platform switcher: Quick Actions · Jira · GitHub

## Install

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Pin **DeveloperTool** from the toolbar

After code changes, click **Reload** on the extension card.

## Configuration

Open **Settings** from the popup gear icon.

### Jira

| Setting | Description |
|---------|-------------|
| Default Jira Board URL | Your sprint/board link |
| Email or exact display name | Used for identity; leave blank to use the Jira session user |
| My tickets only | Fetch only tickets assigned to you by default |

Stay logged into Jira in Chrome.

### GitHub

| Setting | Description |
|---------|-------------|
| GitHub Host | `github.com` or your Enterprise host (e.g. `github.example.com`). Blank = auto-detect from repo URLs |
| Repositories | One per line — prefer full URLs for Enterprise |
| Personal Access Token | Optional fallback if you are not logged in |

**Repo URL formats:**

```text
https://github.example.com/org/repo-name
https://github.com/owner/repo-name
owner/repo-name
```

Short `owner/repo` uses the configured host. Org-only links are not enough — include the repository name.

Stay logged into the **same** GitHub host in Chrome that you configured. A session on `github.com` does not unlock a separate Enterprise host.

## Usage

1. Open the popup — lands on **Quick Actions** by default
2. Switch **Quick Actions** / **Jira** / **GitHub** as needed
3. On Jira/GitHub: filter with My Items, stale (>24h), comments, status, or search
4. Toggle board / list view, open items in a new tab, or export CSV
5. Refresh to re-fetch

### Quick Actions (My Items only)

| Row | Meaning |
|-----|---------|
| Stats | Action Needed (>24h stale), In Progress, Open Comments (unanswered PR reviews on In Progress tickets), Tester Comments (Ready For Testing awaiting your reply) |
| Action Needed | Your stale My Items tickets |
| Open PR Comments | Linked GitHub PRs with unanswered review comments for In Progress tickets |
| Tester Comments | Ready For Testing tickets whose latest comment is not from you |

Toggling **My Items** on Jira re-fetches with an assignee JQL filter so results stay exact.

## Authentication

| Source | How it works |
|--------|----------------|
| **Jira** | Opens/reuses your Jira tab and reads via session cookies (REST first, DOM fallback) |
| **GitHub** | Uses your session on the configured host (github.com or Enterprise). Optional token uses REST (`api.github.com` or `{host}/api/v3`) |

If GitHub shows a login prompt, sign in on the correct host, then refresh the popup.

## Project layout

```text
├── manifest.json
├── background.js                 # Tab + scrape orchestration
├── README.md
├── popup/                        # Dashboard UI
├── options/                      # Settings (auto-save)
├── scripts/
│   ├── content.js                # Jira session scrape
│   ├── github_session.js         # GitHub / Enterprise session PRs
│   ├── github_api.js             # Session client + token fallback
│   └── generate_icons.js
└── icons/
```

## Permissions

| Permission | Purpose |
|------------|---------|
| `tabs` | Open and reuse Jira / GitHub tabs |
| `scripting` | Inject content scripts |
| `storage` | Persist settings |
| Host access | Reach your Jira instance and GitHub / Enterprise hosts |

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| Jira empty / error | Log into Jira in Chrome, confirm the board URL, reload the extension |
| GitHub asks to open Settings / login | Log into the **Enterprise or github.com host you configured**, not a different host |
| Private repo not found | Use full `https://host/org/repo` URLs; confirm you can open that repo in the browser |
| My Items shows nothing on Jira | Set exact email or display name as shown in Jira, or leave blank for session `currentUser()` |
| Changes not applying | Reload the extension on `chrome://extensions/` |
