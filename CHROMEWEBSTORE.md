# Chrome Web Store Metadata & Documentation

**Extension Name**: DeveloperTool  
**Version**: 1.0.0  
**Category**: Productivity & Developer Tools  
**Last Updated**: 2026-08-07  

---

## 1. Extension Description

### Short Description (132 chars max)
Apple-inspired Jira Developer Tool to track tickets, inspect comments, and flag stale issues requiring action (>24h).

### Detailed Description
DeveloperTool brings an Apple-inspired light mode dashboard to your Jira workflow. Inspect tickets, read the latest comment updates, and automatically detect stale tickets that have not received an update in more than 24 hours.

**Key Features:**
- **Renamed & Rebranded**: Clean, modern developer utility titled **DeveloperTool**.
- **Apple Light Mode DNA**: Crafted with Apple design principles—translucent SF-Pro blurred headers, clean white card elevation, crisp typography, and pastel status badges.
- **Comment Inspection Engine**: Reads recent ticket comments and update timestamps.
- **🚨 Action Required Warning**: Automatically flags active tickets (To Do, In Progress, In Review) with no updates for >24 hours with a prominent red badge (`🚨 Action Required`).
- **Open in New Tab**: Single click opens any ticket directly in a new browser tab.
- **User Ticket Filtering**: Single-click toggle between "My Tickets" and "All Board Tickets".
- **Kanban & List Views**: Switch between visual status columns and linear card list views.
- **CSV Export**: One-click ticket & comment export to CSV.

---

## 2. Permissions Justifications

| Permission | Justification |
|---|---|
| `tabs` | Required to query open browser tabs and open ticket pages in new tabs. |
| `scripting` | Required to inject the content parsing script into target Jira pages. |
| `storage` | Required to persist user UI configuration and recent board history. |
| `host_permissions` | Required to interact with custom domain Jira Server/DC and Jira Cloud (`*.atlassian.net`). |

---

## 3. How to Load and Test the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top right corner.
3. Click the **Load unpacked** button.
4. Select directory: `/Users/abhishek/Desktop/chrome-ext`.
5. Click **DeveloperTool** in your Chrome extension toolbar!
