// DeveloperTool - Jira Ticket & Comment Activity Content Script
(function () {
  if (window.hasDeveloperToolInjected) return;
  window.hasDeveloperToolInjected = true;

  console.log('[DeveloperTool] Content script loaded on:', window.location.href);

  function extractKeyFromText(text) {
    if (!text) return null;
    const match = text.match(/([A-Z][A-Z0-9]{1,10}-\d+)/);
    return match ? match[1] : null;
  }

  // Calculate hours elapsed since timestamp
  function calculateHoursAgo(dateStr) {
    if (!dateStr) return 0;
    const past = new Date(dateStr).getTime();
    if (isNaN(past)) return 0;
    const now = Date.now();
    return Math.floor((now - past) / (1000 * 60 * 60));
  }

  // Calculate minutes elapsed since timestamp
  function calculateMinutesAgo(dateStr) {
    if (!dateStr) return 999999;
    const past = new Date(dateStr).getTime();
    if (isNaN(past)) return 999999;
    const now = Date.now();
    return Math.max(0, Math.floor((now - past) / 60000));
  }

  // Determine if ticket requires action (>24 hours stale)
  function checkIfActionRequired(statusName, hoursAgo) {
    if (!statusName) return false;
    const s = statusName.toLowerCase();
    const isDone = s.includes('done') || s.includes('closed') || s.includes('resolved') || s.includes('complete');
    return !isDone && hoursAgo >= 24;
  }

  // PRIMARY METHOD: Fetch Jira REST API using active session cookies
  async function fetchTicketsFromJiraAPI() {
    try {
      const url = window.location.href;
      let boardId = null;
      let projectKey = null;

      const boardMatch = url.match(/boards\/(\d+)/i) || url.match(/rapidView=(\d+)/i);
      if (boardMatch) boardId = boardMatch[1];

      const projMatch = url.match(/projects\/([A-Z0-9_]+)/i) || url.match(/project=([A-Z0-9_]+)/i);
      if (projMatch) projectKey = projMatch[1];

      let apiUrl = '';
      if (boardId) {
        apiUrl = `${window.location.origin}/rest/agile/1.0/board/${boardId}/issue?maxResults=100&expand=comment`;
      } else if (projectKey) {
        apiUrl = `${window.location.origin}/rest/api/2/search?jql=project=${projectKey}%20ORDER%20BY%20updated%20DESC&maxResults=50&fields=summary,status,priority,assignee,issuetype,comment,updated,created`;
      } else {
        const keyMatch = extractKeyFromText(url);
        if (keyMatch) {
          const prefix = keyMatch.split('-')[0];
          apiUrl = `${window.location.origin}/rest/api/2/search?jql=project=${prefix}&maxResults=50&fields=summary,status,priority,assignee,issuetype,comment,updated,created`;
        }
      }

      if (!apiUrl) return [];

      const resp = await fetch(apiUrl, {
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      });

      if (!resp.ok) return [];

      const data = await resp.json();
      const issues = data.issues || [];

      return issues.map((item) => {
        const fields = item.fields || {};
        const status = fields.status ? fields.status.name : 'In Progress';

        // Extract Assignee Details (Name, Email, Key)
        let assigneeName = 'Unassigned';
        let assigneeEmail = '';
        if (fields.assignee) {
          assigneeName = fields.assignee.displayName || fields.assignee.name || 'Assigned';
          assigneeEmail = fields.assignee.emailAddress || fields.assignee.name || fields.assignee.key || '';
        }

        // Process comments & timestamps
        let lastCommentAuthor = null;
        let lastCommentText = null;
        let lastCommentDate = fields.updated || fields.created;

        if (fields.comment && fields.comment.comments && fields.comment.comments.length > 0) {
          const comments = fields.comment.comments;
          const lastComment = comments[comments.length - 1];
          lastCommentAuthor = lastComment.author ? (lastComment.author.displayName || lastComment.author.name) : 'User';
          lastCommentText = lastComment.body || '';
          lastCommentDate = lastComment.updated || lastComment.created || fields.updated;
        }

        const hoursAgo = calculateHoursAgo(lastCommentDate);
        const minutesAgo = calculateMinutesAgo(lastCommentDate);
        const actionRequired = checkIfActionRequired(status, hoursAgo);

        return {
          key: item.key,
          summary: fields.summary || item.key,
          status,
          priority: fields.priority ? fields.priority.name : 'Medium',
          assignee: assigneeName,
          assigneeEmail: assigneeEmail,
          type: fields.issuetype ? fields.issuetype.name : 'Task',
          url: `${window.location.origin}/browse/${item.key}`,
          lastCommentAuthor,
          lastCommentText,
          lastCommentDate,
          hoursSinceUpdate: hoursAgo,
          minutesSinceUpdate: minutesAgo,
          actionRequired
        };
      });
    } catch (err) {
      console.warn('[DeveloperTool] API fetch primary error:', err);
      return [];
    }
  }

  // FALLBACK METHOD: Scrape Jira tickets directly from DOM
  function parseTicketsFromDOM() {
    const tickets = [];
    const seenKeys = new Set();

    const ghxCards = document.querySelectorAll('.ghx-issue');
    if (ghxCards.length > 0) {
      ghxCards.forEach((card) => {
        const keyEl = card.querySelector('.ghx-key');
        const key = keyEl ? keyEl.innerText.trim() : null;
        if (!key || seenKeys.has(key)) return;

        seenKeys.add(key);
        const summaryEl = card.querySelector('.ghx-summary');
        const summary = summaryEl ? summaryEl.innerText.trim() : key;

        const column = card.closest('.ghx-column');
        let status = 'In Progress';
        if (column) {
          const colId = column.getAttribute('data-column-id');
          const colHeader = document.querySelector(`.ghx-column[data-column-id="${colId}"] .ghx-column-title`) ||
                            document.querySelector(`[data-id="${colId}"] .ghx-column-title`);
          if (colHeader) status = colHeader.innerText.trim();
        }

        const priorityEl = card.querySelector('.ghx-priority img');
        const priority = priorityEl ? (priorityEl.getAttribute('title') || priorityEl.getAttribute('alt') || 'Medium') : 'Medium';

        const assigneeEl = card.querySelector('.ghx-avatar img');
        const assignee = assigneeEl ? (assigneeEl.getAttribute('data-tooltip') || assigneeEl.getAttribute('alt') || 'Unassigned') : 'Unassigned';

        const typeEl = card.querySelector('.ghx-type img');
        const type = typeEl ? (typeEl.getAttribute('title') || typeEl.getAttribute('alt') || 'Task') : 'Task';

        const keyLink = keyEl ? keyEl.getAttribute('href') : null;
        const url = keyLink ? (keyLink.startsWith('http') ? keyLink : `${window.location.origin}${keyLink}`) : `${window.location.origin}/browse/${key}`;

        tickets.push({
          key,
          summary,
          status,
          priority,
          assignee,
          assigneeEmail: '',
          type,
          url,
          lastCommentAuthor: null,
          lastCommentText: null,
          lastCommentDate: null,
          hoursSinceUpdate: 0,
          minutesSinceUpdate: 999999,
          actionRequired: false
        });
      });
      return tickets;
    }

    const cloudCards = document.querySelectorAll('[data-test-id*="issue"], [data-issue-key], [data-component-selector="platform-board-kit.ui.card"], div[draggable="true"]');
    cloudCards.forEach((card) => {
      let key = card.getAttribute('data-issue-key');
      if (!key) {
        const keyAttrEl = card.querySelector('[data-test-id*="key"], a[href*="/browse/"]');
        if (keyAttrEl) {
          key = extractKeyFromText(keyAttrEl.innerText || keyAttrEl.getAttribute('href'));
        }
      }
      if (!key) {
        key = extractKeyFromText(card.innerText);
      }
      if (!key || seenKeys.has(key)) return;

      seenKeys.add(key);

      let summary = '';
      const summaryEl = card.querySelector('[data-test-id*="summary"], [data-test-id*="issue-title"], p, span[dir="auto"]');
      if (summaryEl) {
        summary = summaryEl.innerText.trim();
      } else {
        const textLines = card.innerText.split('\n').filter(t => t.trim().length > 0);
        summary = textLines.find(t => t !== key && !extractKeyFromText(t)) || key;
      }

      let status = 'In Progress';
      const colContainer = card.closest('[data-test-id*="column"], [data-component-selector*="column"], [data-testid*="column"]');
      if (colContainer) {
        const headerEl = colContainer.querySelector('h2, h3, [data-test-id*="column-header"], [data-testid*="column-title"]');
        if (headerEl) {
          status = headerEl.innerText.split('\n')[0].trim();
        }
      }

      let priority = 'Medium';
      const priorityEl = card.querySelector('[data-test-id*="priority"], img[src*="priority"], [aria-label*="Priority"]');
      if (priorityEl) {
        priority = priorityEl.getAttribute('aria-label') || priorityEl.getAttribute('alt') || priorityEl.getAttribute('title') || 'Medium';
        priority = priority.replace(/Priority:\s*/i, '').trim();
      }

      let assignee = 'Unassigned';
      const avatarEl = card.querySelector('[data-test-id*="assignee"], img[src*="avatar"], [aria-label*="Assignee"], [data-testid*="avatar"]');
      if (avatarEl) {
        assignee = avatarEl.getAttribute('aria-label') || avatarEl.getAttribute('alt') || avatarEl.getAttribute('title') || 'Assigned';
        assignee = assignee.replace(/Assignee:\s*/i, '').trim();
      }

      let type = 'Task';
      const typeEl = card.querySelector('[data-test-id*="issue-type"], img[src*="issuetype"], [aria-label*="Type"]');
      if (typeEl) {
        type = typeEl.getAttribute('aria-label') || typeEl.getAttribute('alt') || typeEl.getAttribute('title') || 'Task';
      }

      const url = `${window.location.origin}/browse/${key}`;
      tickets.push({
        key,
        summary,
        status,
        priority,
        assignee,
        assigneeEmail: '',
        type,
        url,
        lastCommentAuthor: null,
        lastCommentText: null,
        lastCommentDate: null,
        hoursSinceUpdate: 0,
        minutesSinceUpdate: 999999,
        actionRequired: false
      });
    });

    return tickets;
  }

  // Enrich DOM tickets by fetching single issue details in parallel
  async function enrichDOMTicketsWithComments(tickets) {
    if (!tickets || tickets.length === 0) return tickets;

    const enriched = await Promise.all(
      tickets.map(async (t) => {
        try {
          const resp = await fetch(`${window.location.origin}/rest/api/2/issue/${t.key}?fields=comment,updated,created,assignee`, {
            headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
          });

          if (!resp.ok) return t;

          const data = await resp.json();
          const fields = data.fields || {};

          let assigneeName = t.assignee;
          let assigneeEmail = t.assigneeEmail;
          if (fields.assignee) {
            assigneeName = fields.assignee.displayName || fields.assignee.name || t.assignee;
            assigneeEmail = fields.assignee.emailAddress || fields.assignee.name || fields.assignee.key || '';
          }

          let lastCommentAuthor = null;
          let lastCommentText = null;
          let lastCommentDate = fields.updated || fields.created;

          if (fields.comment && fields.comment.comments && fields.comment.comments.length > 0) {
            const comments = fields.comment.comments;
            const lastComment = comments[comments.length - 1];
            lastCommentAuthor = lastComment.author ? (lastComment.author.displayName || lastComment.author.name) : 'User';
            lastCommentText = lastComment.body || '';
            lastCommentDate = lastComment.updated || lastComment.created || fields.updated;
          }

          const hoursAgo = calculateHoursAgo(lastCommentDate);
          const minutesAgo = calculateMinutesAgo(lastCommentDate);
          const actionRequired = checkIfActionRequired(t.status, hoursAgo);

          return {
            ...t,
            assignee: assigneeName,
            assigneeEmail,
            lastCommentAuthor,
            lastCommentText,
            lastCommentDate,
            hoursSinceUpdate: hoursAgo,
            minutesSinceUpdate: minutesAgo,
            actionRequired
          };
        } catch (e) {
          return t;
        }
      })
    );

    return enriched;
  }

  // Combined ticket collector: REST API FIRST, DOM Fallback SECOND
  async function collectAllTickets() {
    // 1. PRIMARY: Jira REST API (Cookies)
    const apiTickets = await fetchTicketsFromJiraAPI();
    if (apiTickets.length > 0) {
      return { tickets: apiTickets, source: 'Jira API' };
    }

    // 2. FALLBACK: DOM Parsing
    let domTickets = parseTicketsFromDOM();
    if (domTickets.length > 0) {
      const enriched = await enrichDOMTicketsWithComments(domTickets);
      return { tickets: enriched, source: 'DOM Fallback' };
    }

    return { tickets: [], source: 'None' };
  }

  // Listen for messages from extension popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SCRAPE_TICKETS') {
      (async () => {
        try {
          const result = await collectAllTickets();
          const pageTitle = document.title || 'Jira Board';
          sendResponse({
            success: true,
            tickets: result.tickets,
            source: result.source,
            boardTitle: pageTitle,
            url: window.location.href
          });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }
  });

})();
