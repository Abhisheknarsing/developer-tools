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

  function escapeJqlString(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  // Exact assignee identity for My Items — never fuzzy name matching
  function buildAssigneeJqlClauses(userIdentity) {
    const clauses = [];
    const identity = (userIdentity || '').trim();

    if (identity) {
      const escaped = escapeJqlString(identity);
      clauses.push(`assignee = "${escaped}"`);
    }

    // Session user is the authoritative match when logged into Jira
    clauses.push('assignee = currentUser()');
    return clauses;
  }

  function extractAssigneeFields(assignee) {
    if (!assignee) {
      return {
        assigneeName: 'Unassigned',
        assigneeEmail: '',
        assigneeAccountId: '',
        assigneeKey: ''
      };
    }

    return {
      assigneeName: assignee.displayName || assignee.name || 'Assigned',
      // Keep email as real email only — do not fall back to name/key
      assigneeEmail: assignee.emailAddress || '',
      assigneeAccountId: assignee.accountId || '',
      assigneeKey: assignee.name || assignee.key || ''
    };
  }

  function mapIssueToTicket(item) {
    const fields = item.fields || {};
    const status = fields.status ? fields.status.name : 'In Progress';
    const assigneeFields = extractAssigneeFields(fields.assignee);

    let lastCommentAuthor = null;
    let lastCommentText = null;
    let lastCommentDate = fields.updated || fields.created;

    if (fields.comment && fields.comment.comments && fields.comment.comments.length > 0) {
      const comments = fields.comment.comments;
      const lastComment = comments[comments.length - 1];
      lastCommentAuthor = lastComment.author
        ? lastComment.author.displayName || lastComment.author.name
        : 'User';
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
      assignee: assigneeFields.assigneeName,
      assigneeEmail: assigneeFields.assigneeEmail,
      assigneeAccountId: assigneeFields.assigneeAccountId,
      assigneeKey: assigneeFields.assigneeKey,
      type: fields.issuetype ? fields.issuetype.name : 'Task',
      url: `${window.location.origin}/browse/${item.key}`,
      lastCommentAuthor,
      lastCommentText,
      lastCommentDate,
      hoursSinceUpdate: hoursAgo,
      minutesSinceUpdate: minutesAgo,
      actionRequired
    };
  }

  // Exact match only: email, display name, accountId, or username/key
  function matchesExactAssignee(ticket, userIdentity) {
    const target = (userIdentity || '').trim().toLowerCase();
    if (!target) return false;

    const email = (ticket.assigneeEmail || '').trim().toLowerCase();
    const name = (ticket.assignee || '').trim().toLowerCase();
    const accountId = (ticket.assigneeAccountId || '').trim().toLowerCase();
    const key = (ticket.assigneeKey || '').trim().toLowerCase();

    if (email && email === target) return true;
    if (name && name === target) return true;
    if (accountId && accountId === target) return true;
    if (key && key === target) return true;
    return false;
  }

  async function jiraApiGet(apiUrl) {
    const resp = await fetch(apiUrl, {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!resp.ok) return null;
    return resp.json();
  }

  function buildBoardIssueUrl(boardId, assigneeJql) {
    const base = `${window.location.origin}/rest/agile/1.0/board/${boardId}/issue?maxResults=100&expand=comment`;
    if (!assigneeJql) return base;
    return `${base}&jql=${encodeURIComponent(assigneeJql)}`;
  }

  function buildSearchUrl(projectKey, assigneeJql) {
    let jql = `project = ${projectKey}`;
    if (assigneeJql) jql += ` AND ${assigneeJql}`;
    jql += ' ORDER BY updated DESC';
    return `${window.location.origin}/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,status,priority,assignee,issuetype,comment,updated,created`;
  }

  // PRIMARY METHOD: Fetch Jira REST API using active session cookies
  // My Items uses assignee JQL (email / exact name / currentUser) — not fuzzy matching
  async function fetchTicketsFromJiraAPI(options = {}) {
    try {
      const myTicketsOnly = !!options.myTicketsOnly;
      const userIdentity = (options.userIdentity || '').trim();
      const url = window.location.href;
      let boardId = null;
      let projectKey = null;

      const boardMatch = url.match(/boards\/(\d+)/i) || url.match(/rapidView=(\d+)/i);
      if (boardMatch) boardId = boardMatch[1];

      const projMatch = url.match(/projects\/([A-Z0-9_]+)/i) || url.match(/project=([A-Z0-9_]+)/i);
      if (projMatch) projectKey = projMatch[1];

      if (!boardId && !projectKey) {
        const keyMatch = extractKeyFromText(url);
        if (keyMatch) projectKey = keyMatch.split('-')[0];
      }

      if (!boardId && !projectKey) return { tickets: [], assigneeFilterApplied: false };

      const attemptAssigneeClauses = myTicketsOnly ? buildAssigneeJqlClauses(userIdentity) : [null];

      for (const assigneeJql of attemptAssigneeClauses) {
        let apiUrl = '';
        if (boardId) {
          apiUrl = buildBoardIssueUrl(boardId, assigneeJql);
        } else {
          apiUrl = buildSearchUrl(projectKey, assigneeJql);
        }

        const data = await jiraApiGet(apiUrl);
        if (!data) continue;

        const issues = data.issues || [];
        const tickets = issues.map(mapIssueToTicket);

        // currentUser()/assignee JQL already filtered — accept even if empty for that clause
        // but if identity clause returns 0, try next clause (e.g. currentUser)
        if (myTicketsOnly && assigneeJql && tickets.length === 0 && assigneeJql !== 'assignee = currentUser()') {
          continue;
        }

        return {
          tickets,
          assigneeFilterApplied: myTicketsOnly && !!assigneeJql,
          assigneeJql: assigneeJql || ''
        };
      }

      return { tickets: [], assigneeFilterApplied: myTicketsOnly, assigneeJql: '' };
    } catch (err) {
      console.warn('[DeveloperTool] API fetch primary error:', err);
      return { tickets: [], assigneeFilterApplied: false };
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
          assigneeAccountId: '',
          assigneeKey: '',
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
        assigneeAccountId: '',
        assigneeKey: '',
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
          const assigneeFields = extractAssigneeFields(fields.assignee);

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
            assignee: fields.assignee ? assigneeFields.assigneeName : t.assignee,
            assigneeEmail: assigneeFields.assigneeEmail,
            assigneeAccountId: assigneeFields.assigneeAccountId,
            assigneeKey: assigneeFields.assigneeKey,
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
  async function collectAllTickets(options = {}) {
    const myTicketsOnly = !!options.myTicketsOnly;
    const userIdentity = (options.userIdentity || '').trim();

    // 1. PRIMARY: Jira REST API with assignee JQL filter when My Items is on
    const apiResult = await fetchTicketsFromJiraAPI(options);
    if (apiResult.tickets && apiResult.tickets.length > 0) {
      return {
        tickets: apiResult.tickets,
        source: apiResult.assigneeFilterApplied ? 'Jira API (assignee filter)' : 'Jira API',
        assigneeFilterApplied: !!apiResult.assigneeFilterApplied
      };
    }

    // If My Items JQL returned zero because you have no assigned tickets, that is a valid result
    if (myTicketsOnly && apiResult.assigneeFilterApplied) {
      return {
        tickets: [],
        source: 'Jira API (assignee filter)',
        assigneeFilterApplied: true
      };
    }

    // 2. FALLBACK: DOM Parsing + exact identity filter (never fuzzy)
    let domTickets = parseTicketsFromDOM();
    if (domTickets.length > 0) {
      const enriched = await enrichDOMTicketsWithComments(domTickets);
      if (myTicketsOnly) {
        const filtered = userIdentity
          ? enriched.filter((t) => matchesExactAssignee(t, userIdentity))
          : enriched;
        return {
          tickets: filtered,
          source: 'DOM Fallback (exact assignee)',
          assigneeFilterApplied: !!userIdentity
        };
      }
      return { tickets: enriched, source: 'DOM Fallback', assigneeFilterApplied: false };
    }

    return { tickets: [], source: 'None', assigneeFilterApplied: false };
  }

  // Listen for messages from extension popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SCRAPE_TICKETS') {
      (async () => {
        try {
          const result = await collectAllTickets({
            myTicketsOnly: !!message.myTicketsOnly,
            userIdentity: message.userIdentity || ''
          });
          const pageTitle = document.title || 'Jira Board';
          sendResponse({
            success: true,
            tickets: result.tickets,
            source: result.source,
            boardTitle: pageTitle,
            url: window.location.href,
            assigneeFilterApplied: !!result.assigneeFilterApplied
          });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }
  });

})();
