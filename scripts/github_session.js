// DeveloperTool - GitHub session access (github.com + GitHub Enterprise)
(function () {
  if (window.hasDeveloperToolGitHubSession) return;
  window.hasDeveloperToolGitHubSession = true;

  function calculateHoursAgo(dateStr) {
    if (!dateStr) return 0;
    const past = new Date(dateStr).getTime();
    if (isNaN(past)) return 0;
    return Math.floor((Date.now() - past) / (1000 * 60 * 60));
  }

  function calculateMinutesAgo(dateStr) {
    if (!dateStr) return 999999;
    const past = new Date(dateStr).getTime();
    if (isNaN(past)) return 999999;
    return Math.max(0, Math.floor((Date.now() - past) / 60000));
  }

  function extractJiraTicketKey(title = '', body = '', branch = '') {
    const combined = `${title} ${branch} ${body}`;
    const match = combined.match(/\b([A-Za-z]{2,10}-\d+)\b/);
    return match ? match[1].toUpperCase() : null;
  }

  function getPageOrigin(preferredOrigin) {
    if (preferredOrigin) {
      try {
        return new URL(preferredOrigin).origin;
      } catch (e) {
        // fall through
      }
    }
    return window.location.origin;
  }

  function getPageHost(preferredHost) {
    if (preferredHost) {
      return String(preferredHost)
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(/\/+$/, '')
        .toLowerCase();
    }
    return window.location.hostname.replace(/^www\./i, '').toLowerCase();
  }

  function getSessionUser() {
    const meta = document.querySelector('meta[name="user-login"]');
    const login = meta ? (meta.getAttribute('content') || '').trim() : '';
    if (login) return login;

    const loggedInMeta = document.querySelector('meta[name="user-id"]');
    if (loggedInMeta && loggedInMeta.getAttribute('content')) {
      const avatar = document.querySelector('img.avatar-user, img.avatar[alt]');
      if (avatar) {
        const alt = (avatar.getAttribute('alt') || '').replace(/^@/, '').trim();
        if (alt) return alt;
      }
    }
    return '';
  }

  function isLoginPage(url = location.href, html = '') {
    try {
      const u = new URL(url, location.origin);
      if (/\/(login|session)(\/|$)/i.test(u.pathname)) return true;
    } catch (e) {
      if (/\/(login|session)(\/|$|\?)/i.test(url)) return true;
    }
    if (html && /Sign in to GitHub/i.test(html) && !getSessionUser()) return true;
    return false;
  }

  async function githubFetch(url, accept = 'text/html') {
    return fetch(url, {
      headers: {
        Accept: accept,
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'include',
      redirect: 'follow'
    });
  }

  function truncate(text, max = 90) {
    if (!text) return '';
    const t = String(text).replace(/\s+/g, ' ').trim();
    return t.length > max ? t.substring(0, max) + '...' : t;
  }

  function parseRelativeTime(el) {
    if (!el) return null;
    return (
      el.getAttribute('datetime') ||
      el.getAttribute('title') ||
      el.dateTime ||
      null
    );
  }

  function parsePullsFromHtml(html, owner, repo, origin) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const pulls = [];
    const seen = new Set();

    const rows = doc.querySelectorAll(
      'div.js-issue-row, [id^="issue_"], .js-navigation-item[id^="issue_"], turbo-frame .js-issue-row'
    );

    rows.forEach((row) => {
      const link =
        row.querySelector('a[data-hovercard-type="pull_request"]') ||
        row.querySelector(`a[href*="/${owner}/${repo}/pull/"]`) ||
        row.querySelector('a.Link--primary, a[id$="_link"]');

      if (!link) return;

      const href = link.getAttribute('href') || '';
      const numMatch = href.match(/\/pull\/(\d+)/);
      if (!numMatch) return;

      const number = parseInt(numMatch[1], 10);
      if (seen.has(number)) return;
      seen.add(number);

      const title = (link.textContent || '').trim() || `PR #${number}`;
      const authorEl =
        row.querySelector('a[data-hovercard-type="user"]') ||
        row.querySelector('.opened-by a') ||
        row.querySelector('[data-hovercard-type="user"]');
      const author = authorEl
        ? (authorEl.getAttribute('href') || '').replace(/^\/+|\/+$/g, '').split('/').pop() ||
          (authorEl.textContent || '').trim()
        : '';

      const timeEl = row.querySelector('relative-time, time-ago, time[datetime]');
      const updatedAt = parseRelativeTime(timeEl) || new Date().toISOString();

      const draft =
        !!row.querySelector('[aria-label*="Draft" i], .Draft, span.Label--secondary') ||
        /draft/i.test(row.textContent || '');

      const commentsEl = row.querySelector('a[href$="#comments"] .text-small, a[aria-label*="comment" i]');
      let commentsCount = 0;
      if (commentsEl) {
        const n = parseInt((commentsEl.textContent || '').replace(/[^\d]/g, ''), 10);
        if (!isNaN(n)) commentsCount = n;
      }

      pulls.push({
        number,
        title,
        body: '',
        draft,
        state: 'open',
        user: author,
        assignees: author ? [author] : [],
        html_url: `${origin}/${owner}/${repo}/pull/${number}`,
        updated_at: updatedAt,
        created_at: updatedAt,
        head_ref: '',
        comments_count: commentsCount
      });
    });

    if (pulls.length === 0) {
      const re = new RegExp(`href="/(?:${owner}/${repo}/pull/(\\d+))"([^>]*)>([^<]+)`, 'gi');
      let m;
      while ((m = re.exec(html)) !== null) {
        const number = parseInt(m[1], 10);
        if (seen.has(number)) continue;
        seen.add(number);
        const title = (m[3] || '').trim();
        if (!title || title.length < 2) continue;
        pulls.push({
          number,
          title,
          body: '',
          draft: false,
          state: 'open',
          user: '',
          assignees: [],
          html_url: `${origin}/${owner}/${repo}/pull/${number}`,
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          head_ref: '',
          comments_count: 0
        });
      }
    }

    return pulls;
  }

  function parsePullsFromJson(data, owner, repo, origin) {
    if (!data || typeof data !== 'object') return [];

    const candidates = [];
    const visit = (node, depth = 0) => {
      if (!node || depth > 8) return;
      if (Array.isArray(node)) {
        node.forEach((n) => visit(n, depth + 1));
        return;
      }
      if (typeof node !== 'object') return;

      if (
        (node.number || node.number === 0) &&
        (node.title || node.name) &&
        (node.html_url || node.url || node.pull_request)
      ) {
        candidates.push(node);
      }

      Object.keys(node).forEach((k) => {
        if (k === 'pullRequests' || k === 'issues' || k === 'items' || k === 'payload' || k === 'pageParams') {
          visit(node[k], depth + 1);
        } else if (typeof node[k] === 'object') {
          visit(node[k], depth + 1);
        }
      });
    };

    visit(data);

    const seen = new Set();
    return candidates
      .map((pr) => {
        const number = parseInt(pr.number, 10);
        if (!number || seen.has(number)) return null;
        seen.add(number);
        const user =
          (pr.user && (pr.user.login || pr.user)) ||
          pr.author ||
          pr.authorLogin ||
          '';
        return {
          number,
          title: pr.title || pr.name || `PR #${number}`,
          body: pr.body || '',
          draft: !!(pr.draft || pr.isDraft),
          state: pr.state || 'open',
          user: typeof user === 'string' ? user : '',
          assignees: Array.isArray(pr.assignees)
            ? pr.assignees.map((a) => (typeof a === 'string' ? a : a.login)).filter(Boolean)
            : [],
          html_url: pr.html_url || `${origin}/${owner}/${repo}/pull/${number}`,
          updated_at: pr.updated_at || pr.updatedAt || pr.created_at || new Date().toISOString(),
          created_at: pr.created_at || pr.createdAt || pr.updated_at || new Date().toISOString(),
          head_ref: (pr.head && pr.head.ref) || pr.headRefName || '',
          comments_count: pr.comments || pr.review_comments || 0
        };
      })
      .filter(Boolean);
  }

  async function fetchPullDetailSnippet(owner, repo, number, origin) {
    try {
      const resp = await githubFetch(`${origin}/${owner}/${repo}/pull/${number}`);
      if (!resp.ok) return null;
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const branchEl =
        doc.querySelector('.commit-ref.head-ref, .css-truncate.user-select-contain.head-ref') ||
        doc.querySelector('[data-testid="head-ref"]');
      const headRef = branchEl ? (branchEl.textContent || '').trim() : '';

      const bodyEl =
        doc.querySelector('.comment-body.markdown-body') ||
        doc.querySelector('[data-testid="pull-request-body"] .markdown-body');
      const body = bodyEl ? (bodyEl.textContent || '').trim() : '';

      const commentNodes = doc.querySelectorAll(
        '.js-comment-container .timeline-comment, .ReviewThread, [data-testid="review-comment"]'
      );
      let lastCommentAuthor = '';
      let lastCommentText = '';
      let lastCommentDate = null;
      const count = commentNodes.length;

      if (commentNodes.length > 0) {
        const last = commentNodes[commentNodes.length - 1];
        const authorEl =
          last.querySelector('a.author, a[data-hovercard-type="user"]') ||
          last.querySelector('[data-testid="comment-author"]');
        lastCommentAuthor = authorEl
          ? (authorEl.getAttribute('href') || '').replace(/^\/+/, '').split('/')[0] ||
            (authorEl.textContent || '').trim()
          : '';
        const textEl = last.querySelector('.comment-body, .markdown-body');
        lastCommentText = textEl ? truncate(textEl.textContent || '') : '';
        const timeEl = last.querySelector('relative-time, time[datetime]');
        lastCommentDate = parseRelativeTime(timeEl);
      }

      return {
        head_ref: headRef,
        body: truncate(body, 200),
        comments_count: count,
        lastCommentAuthor,
        lastCommentText,
        lastCommentDate
      };
    } catch (e) {
      return null;
    }
  }

  function formatPull(owner, repo, pr, detail, origin, host) {
    const updatedAt = (detail && detail.lastCommentDate) || pr.updated_at || pr.created_at;
    const hoursAgo = calculateHoursAgo(updatedAt);
    const minutesAgo = calculateMinutesAgo(updatedAt);

    let stateLabel = 'Open';
    if (pr.draft) stateLabel = 'Draft';
    if (pr.state === 'closed') stateLabel = 'Closed';
    if (pr.merged_at || pr.state === 'merged') stateLabel = 'Merged';

    const isDoneOrClosed = stateLabel === 'Closed' || stateLabel === 'Merged';
    const actionRequired = !isDoneOrClosed && hoursAgo >= 24;

    const authorLogin = pr.user || '';
    const assigneesList = Array.isArray(pr.assignees) ? [...pr.assignees] : [];

    const branchRef = (detail && detail.head_ref) || pr.head_ref || '';
    const body = (detail && detail.body) || pr.body || '';
    const linkedJiraKey = extractJiraTicketKey(pr.title, body, branchRef);

    const commentCount = (detail && detail.comments_count) || pr.comments_count || 0;
    const hasUnresolvedComments = commentCount > 0;
    const commentAuthor = (detail && detail.lastCommentAuthor) || authorLogin || 'Author';
    const commentText =
      (detail && detail.lastCommentText) ||
      (body ? truncate(body) : 'Pull Request Open');

    return {
      id: `pr-${host}-${owner}-${repo}-${pr.number}`,
      key: `#${pr.number}`,
      repo: `${owner}/${repo}`,
      summary: pr.title,
      status: stateLabel,
      priority: pr.draft ? 'Low' : hasUnresolvedComments ? 'High' : 'Medium',
      author: authorLogin,
      assignee: assigneesList.join(', ') || authorLogin || 'Unassigned',
      assigneeEmail: authorLogin,
      type: 'Pull Request',
      url: pr.html_url || `${origin}/${owner}/${repo}/pull/${pr.number}`,
      linkedJiraKey,
      reviewCommentsCount: commentCount,
      hasUnresolvedComments,
      lastCommentAuthor: commentAuthor,
      lastCommentText: commentText,
      lastCommentDate: (detail && detail.lastCommentDate) || updatedAt,
      hoursSinceUpdate: hoursAgo,
      minutesSinceUpdate: minutesAgo,
      actionRequired,
      isGitHub: true,
      githubHost: host,
      source: 'session'
    };
  }

  async function fetchRepoPullRequests(owner, repo, origin, host, enrichDetails = true) {
    const listUrl = `${origin}/${owner}/${repo}/pulls?q=is%3Aopen+is%3Apr`;

    let pulls = [];
    let fetchError = null;

    try {
      const jsonResp = await githubFetch(listUrl, 'application/json');
      if (jsonResp.redirected && isLoginPage(jsonResp.url)) {
        return { error: 'not_logged_in', pulls: [] };
      }
      if (jsonResp.status === 404) {
        return {
          error: `Repository ${owner}/${repo} not found on ${host}, or you do not have access with this session.`,
          pulls: []
        };
      }
      if (jsonResp.ok) {
        const contentType = jsonResp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await jsonResp.json();
          pulls = parsePullsFromJson(data, owner, repo, origin);
        } else {
          const html = await jsonResp.text();
          if (isLoginPage(jsonResp.url, html)) {
            return { error: 'not_logged_in', pulls: [] };
          }
          pulls = parsePullsFromHtml(html, owner, repo, origin);
        }
      }
    } catch (e) {
      fetchError = e.message;
    }

    if (pulls.length === 0) {
      try {
        const htmlResp = await githubFetch(listUrl, 'text/html');
        if (htmlResp.redirected && isLoginPage(htmlResp.url)) {
          return { error: 'not_logged_in', pulls: [] };
        }
        if (htmlResp.status === 404) {
          return {
            error: `Repository ${owner}/${repo} not found on ${host}, or you do not have access with this session.`,
            pulls: []
          };
        }
        if (!htmlResp.ok) {
          return {
            error: fetchError || `HTTP ${htmlResp.status} fetching ${owner}/${repo}`,
            pulls: []
          };
        }
        const html = await htmlResp.text();
        if (isLoginPage(htmlResp.url, html) || (!getSessionUser() && /Sign in/i.test(html))) {
          return { error: 'not_logged_in', pulls: [] };
        }
        pulls = parsePullsFromHtml(html, owner, repo, origin);
      } catch (e) {
        return { error: e.message || fetchError || 'Failed to fetch pull requests', pulls: [] };
      }
    }

    const toEnrich = enrichDetails ? pulls.slice(0, 15) : [];
    const detailsByNumber = {};
    await Promise.all(
      toEnrich.map(async (pr) => {
        const detail = await fetchPullDetailSnippet(owner, repo, pr.number, origin);
        if (detail) detailsByNumber[pr.number] = detail;
      })
    );

    const formatted = pulls.map((pr) =>
      formatPull(owner, repo, pr, detailsByNumber[pr.number], origin, host)
    );
    return { pulls: formatted, error: null };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'DETECT_GITHUB_SESSION') {
      const sessionUser = getSessionUser();
      const host = getPageHost(message.host);
      const onExpectedHost =
        !message.host || getPageHost() === getPageHost(message.host);
      sendResponse({
        success: true,
        loggedIn: !!sessionUser,
        sessionUser,
        host,
        onGitHub: onExpectedHost,
        needsLogin: onExpectedHost && !sessionUser && isLoginPage()
      });
      return false;
    }

    if (message.action === 'FETCH_GITHUB_REPO_PRS') {
      (async () => {
        try {
          const sessionUser = getSessionUser();
          if (!sessionUser) {
            sendResponse({
              success: false,
              error: 'not_logged_in',
              needsLogin: true,
              pulls: []
            });
            return;
          }

          const owner = message.owner;
          const repo = message.repo;
          const origin = getPageOrigin(message.origin);
          const host = getPageHost(message.host || origin);

          if (!owner || !repo) {
            sendResponse({ success: false, error: 'Missing owner/repo', pulls: [] });
            return;
          }

          const result = await fetchRepoPullRequests(
            owner,
            repo,
            origin,
            host,
            message.enrichDetails !== false
          );
          if (result.error === 'not_logged_in') {
            sendResponse({
              success: false,
              error: 'not_logged_in',
              needsLogin: true,
              sessionUser,
              pulls: []
            });
            return;
          }

          sendResponse({
            success: !result.error,
            error: result.error || null,
            sessionUser,
            host,
            pulls: result.pulls || []
          });
        } catch (err) {
          sendResponse({ success: false, error: err.message, pulls: [] });
        }
      })();
      return true;
    }
  });
})();
