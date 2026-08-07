// DeveloperTool - GitHub client (github.com + GitHub Enterprise session/token support)

function normalizeGitHubHost(hostOrUrl) {
  if (!hostOrUrl) return 'github.com';
  let raw = String(hostOrUrl).trim();
  try {
    if (/^https?:\/\//i.test(raw)) {
      raw = new URL(raw).hostname;
    }
  } catch (e) {
    // keep raw
  }
  return raw.replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase() || 'github.com';
}

function getGitHubOrigin(host) {
  const h = normalizeGitHubHost(host);
  return `https://${h}`;
}

function getGitHubApiBase(host) {
  const h = normalizeGitHubHost(host);
  if (h === 'github.com') return 'https://api.github.com';
  return `https://${h}/api/v3`;
}

function parseGitHubRepoUrl(urlOrName, defaultHost = 'github.com') {
  if (!urlOrName) return null;
  let str = urlOrName.trim();
  str = str.split('?')[0].split('#')[0];
  const fallbackHost = normalizeGitHubHost(defaultHost);

  if (str.startsWith('http://') || str.startsWith('https://')) {
    try {
      const u = new URL(str);
      const host = normalizeGitHubHost(u.hostname);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return {
          host,
          origin: getGitHubOrigin(host),
          apiBase: getGitHubApiBase(host),
          owner: parts[0].trim(),
          repo: parts[1].replace(/\.git$/i, '').trim()
        };
      }
    } catch (e) {
      return null;
    }
  } else {
    const parts = str.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const host = fallbackHost;
      return {
        host,
        origin: getGitHubOrigin(host),
        apiBase: getGitHubApiBase(host),
        owner: parts[0].trim(),
        repo: parts[1].replace(/\.git$/i, '').trim()
      };
    }
  }
  return null;
}

function inferGitHubHostFromRepos(repoList = [], configuredHost = '') {
  if (configuredHost) return normalizeGitHubHost(configuredHost);
  for (const item of repoList) {
    const parsed = parseGitHubRepoUrl(item, 'github.com');
    if (parsed && parsed.host) return parsed.host;
  }
  return 'github.com';
}

function extractJiraTicketKey(title = '', body = '', branch = '') {
  const combined = `${title} ${branch} ${body}`;
  const match = combined.match(/\b([A-Za-z]{2,10}-\d+)\b/);
  return match ? match[1].toUpperCase() : null;
}

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

function buildRepoSummaries(pulls, effectiveUser) {
  const byRepo = {};
  pulls.forEach((p) => {
    const name = p.repo || 'unknown';
    if (!byRepo[name]) byRepo[name] = [];
    byRepo[name].push(p);
  });

  return Object.keys(byRepo).map((repoFullName) => {
    const repoPulls = byRepo[repoFullName];
    const openPRs = repoPulls.filter((p) => p.status === 'Open' || p.status === 'Draft').length;
    const myPRs = repoPulls.filter((p) => {
      if (!effectiveUser) return false;
      const author = (p.author || '').toLowerCase();
      const assignee = (p.assignee || '').toLowerCase();
      return author.includes(effectiveUser) || assignee.includes(effectiveUser);
    }).length;

    return {
      repo: repoFullName,
      openPRs,
      myPRs,
      actionNeeded: repoPulls.filter((p) => p.actionRequired).length,
      unresolvedComments: repoPulls.filter((p) => p.hasUnresolvedComments).length
    };
  });
}

// Attempt to detect logged-in GitHub user via API token (fallback path)
async function detectActiveGitHubSessionUser(token = '', host = 'github.com') {
  try {
    const apiBase = getGitHubApiBase(host);
    const headers = { Accept: 'application/vnd.github.v3+json' };
    if (token) headers.Authorization = `token ${token}`;

    const resp = await fetch(`${apiBase}/user`, {
      headers,
      credentials: 'include'
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data && data.login) {
        return data.login;
      }
    }
  } catch (e) {
    console.warn('[DeveloperTool] Could not auto-detect GitHub API user:', e);
  }
  return '';
}

async function fetchPRReviewComments(owner, repo, prNumber, token = '', host = 'github.com') {
  try {
    const apiBase = getGitHubApiBase(host);
    const apiUrl = `${apiBase}/repos/${owner}/${repo}/pulls/${prNumber}/comments?sort=created&direction=desc&per_page=5`;
    const headers = { Accept: 'application/vnd.github.v3+json' };
    if (token) headers.Authorization = `token ${token}`;

    const resp = await fetch(apiUrl, { headers, credentials: 'include' });
    if (!resp.ok) return { count: 0, lastComment: null };

    const comments = await resp.json();
    if (comments && comments.length > 0) {
      const last = comments[0];
      return {
        count: comments.length,
        lastCommentAuthor: last.user ? last.user.login : '',
        lastCommentText: last.body
          ? last.body.length > 90
            ? last.body.substring(0, 90) + '...'
            : last.body
          : '',
        lastCommentDate: last.updated_at || last.created_at
      };
    }
  } catch (e) {
    console.warn(`[DeveloperTool] Could not fetch comments for PR #${prNumber}:`, e);
  }
  return { count: 0, lastComment: null };
}

async function fetchGitHubRepoPullRequests(owner, repo, token = '', host = 'github.com') {
  try {
    const apiBase = getGitHubApiBase(host);
    const origin = getGitHubOrigin(host);
    const apiUrl = `${apiBase}/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=100`;
    const headers = { Accept: 'application/vnd.github.v3+json' };
    if (token) headers.Authorization = `token ${token}`;

    const resp = await fetch(apiUrl, { headers, credentials: 'include' });

    if (!resp.ok) {
      console.warn(`[DeveloperTool] GitHub API HTTP ${resp.status} for ${owner}/${repo} @ ${host}`);
      if (resp.status === 403 || resp.status === 401) {
        return {
          error: `Authentication error (HTTP ${resp.status}). Log into ${host} in your browser, or add a Personal Access Token in Settings.`,
          pulls: []
        };
      }
      if (resp.status === 404) {
        return {
          error: `Repository ${owner}/${repo} not found or private on ${host}. Log into that GitHub host (or add a token) for private access.`,
          pulls: []
        };
      }
      return { error: `HTTP ${resp.status} fetching ${owner}/${repo}`, pulls: [] };
    }

    const pulls = await resp.json();

    const formattedPulls = await Promise.all(
      pulls.map(async (pr) => {
        const updatedAt = pr.updated_at || pr.created_at;
        const hoursAgo = calculateHoursAgo(updatedAt);
        const minutesAgo = calculateMinutesAgo(updatedAt);

        let stateLabel = 'Open';
        if (pr.draft) stateLabel = 'Draft';
        if (pr.merged_at) stateLabel = 'Merged';
        if (pr.state === 'closed' && !pr.merged_at) stateLabel = 'Closed';

        const isDoneOrClosed = stateLabel === 'Closed' || stateLabel === 'Merged';
        const actionRequired = !isDoneOrClosed && hoursAgo >= 24;

        const authorLogin = pr.user ? pr.user.login : '';
        const assigneesList = (pr.assignees || []).map((a) => a.login);
        if (pr.assignee && !assigneesList.includes(pr.assignee.login)) {
          assigneesList.push(pr.assignee.login);
        }

        const branchRef = pr.head ? pr.head.ref : '';
        const linkedJiraKey = extractJiraTicketKey(pr.title, pr.body, branchRef);

        const commentData = await fetchPRReviewComments(owner, repo, pr.number, token, host);
        const hasUnresolvedComments = commentData.count > 0;

        const commentAuthor = commentData.lastCommentAuthor || authorLogin || 'Author';
        const commentText =
          commentData.lastCommentText ||
          (pr.body
            ? pr.body.length > 90
              ? pr.body.substring(0, 90) + '...'
              : pr.body
            : 'Pull Request Open');

        return {
          id: `pr-${pr.id}`,
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
          reviewCommentsCount: commentData.count,
          hasUnresolvedComments,
          lastCommentAuthor: commentAuthor,
          lastCommentText: commentText,
          lastCommentDate: commentData.lastCommentDate || updatedAt,
          hoursSinceUpdate: hoursAgo,
          minutesSinceUpdate: minutesAgo,
          actionRequired,
          isGitHub: true,
          githubHost: host,
          source: token ? 'token' : 'api'
        };
      })
    );

    return { pulls: formattedPulls };
  } catch (err) {
    console.warn(`[DeveloperTool] Error fetching PRs for ${owner}/${repo}:`, err);
    return { error: err.message, pulls: [] };
  }
}

async function fetchGitHubDataViaBrowserSession(repoList = [], defaultHost = 'github.com') {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
    return null;
  }

  const hostHint = inferGitHubHostFromRepos(repoList, defaultHost);
  const parsedRepos = repoList
    .map((item) => parseGitHubRepoUrl(item, hostHint))
    .filter(Boolean);

  if (parsedRepos.length === 0) {
    return { pullRequests: [], repoSummaries: [], sessionUser: '', errors: [], needsLogin: false, source: 'session', githubHost: hostHint };
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'FETCH_GITHUB_VIA_SESSION',
      repos: parsedRepos,
      host: hostHint,
      enrichDetails: true
    });

    if (!response) return null;

    if (response.needsLogin) {
      const host = response.githubHost || hostHint;
      return {
        pullRequests: [],
        repoSummaries: [],
        sessionUser: '',
        errors: [
          response.error ||
            `Log into ${host} in your browser to access private repositories, then refresh.`
        ],
        needsLogin: true,
        source: 'session',
        githubHost: host
      };
    }

    if (!response.success && !response.results) {
      return {
        pullRequests: [],
        repoSummaries: [],
        sessionUser: '',
        errors: [response.error || 'GitHub session fetch failed'],
        needsLogin: false,
        source: 'session',
        githubHost: hostHint
      };
    }

    const allPRs = [];
    const errorList = [];

    (response.results || []).forEach((result) => {
      const repoFullName = `${result.owner}/${result.repo}`;
      if (result.error) {
        errorList.push(`${repoFullName}: ${result.error}`);
      }
      if (result.pulls && result.pulls.length) {
        allPRs.push(...result.pulls);
      }
    });

    const sessionUser = response.sessionUser || '';
    const effectiveUser = sessionUser.toLowerCase().trim();

    return {
      pullRequests: allPRs,
      repoSummaries: buildRepoSummaries(allPRs, effectiveUser),
      sessionUser,
      errors: errorList,
      needsLogin: false,
      source: 'session',
      githubHost: response.githubHost || hostHint
    };
  } catch (err) {
    console.warn('[DeveloperTool] Browser session GitHub fetch failed:', err);
    return null;
  }
}

async function fetchAllGitHubData(repoList = [], token = '', userTarget = '', defaultHost = 'github.com') {
  if (!repoList || repoList.length === 0) {
    return { pullRequests: [], repoSummaries: [], sessionUser: '', errors: [], needsLogin: false, source: '', githubHost: defaultHost };
  }

  const hostHint = inferGitHubHostFromRepos(repoList, defaultHost);

  // Primary: use the browser GitHub login/session on the correct host (incl. Enterprise)
  const sessionData = await fetchGitHubDataViaBrowserSession(repoList, hostHint);

  if (sessionData) {
    const sessionEmpty =
      (!sessionData.pullRequests || sessionData.pullRequests.length === 0) &&
      (sessionData.errors || []).length > 0;

    if (sessionData.needsLogin && token) {
      console.info('[DeveloperTool] No GitHub browser session; falling back to Personal Access Token');
    } else if (!sessionData.needsLogin && !(sessionEmpty && token)) {
      const effectiveUser = (userTarget || sessionData.sessionUser || '').toLowerCase().trim();
      if (userTarget && effectiveUser !== (sessionData.sessionUser || '').toLowerCase().trim()) {
        sessionData.repoSummaries = buildRepoSummaries(sessionData.pullRequests, effectiveUser);
      }
      sessionData.sessionUser = sessionData.sessionUser || userTarget;
      return sessionData;
    } else if (sessionData.needsLogin && !token) {
      return sessionData;
    } else if (sessionEmpty && token) {
      console.info('[DeveloperTool] Session scrape returned no PRs; falling back to Personal Access Token');
    }
  }

  // Fallback: official API with optional Personal Access Token (supports Enterprise /api/v3)
  const sessionUser = await detectActiveGitHubSessionUser(token, hostHint);
  const effectiveUser = (userTarget || sessionUser || '').toLowerCase().trim();

  const repoSummaries = [];
  const allPRs = [];
  const errorList = [];

  for (const repoItem of repoList) {
    const parsed = parseGitHubRepoUrl(repoItem, hostHint);
    if (!parsed) continue;

    const repoFullName = `${parsed.owner}/${parsed.repo}`;
    const result = await fetchGitHubRepoPullRequests(parsed.owner, parsed.repo, token, parsed.host);

    if (result.error) {
      errorList.push(`${repoFullName}: ${result.error}`);
    }

    const pulls = result.pulls || [];
    allPRs.push(...pulls);

    const openPRs = pulls.filter((p) => p.status === 'Open' || p.status === 'Draft').length;
    const myPRs = pulls.filter((p) => {
      if (!effectiveUser) return false;
      const author = (p.author || '').toLowerCase();
      const assignee = (p.assignee || '').toLowerCase();
      return author.includes(effectiveUser) || assignee.includes(effectiveUser);
    }).length;

    repoSummaries.push({
      repo: repoFullName,
      openPRs,
      myPRs,
      actionNeeded: pulls.filter((p) => p.actionRequired).length,
      unresolvedComments: pulls.filter((p) => p.hasUnresolvedComments).length
    });
  }

  return {
    pullRequests: allPRs,
    repoSummaries,
    sessionUser: sessionUser || userTarget,
    errors: errorList,
    needsLogin: false,
    source: token ? 'token' : 'api',
    githubHost: hostHint
  };
}

async function fetchAllGitHubItems(repoList = [], token = '', defaultHost = 'github.com') {
  const data = await fetchAllGitHubData(repoList, token, '', defaultHost);
  return data.pullRequests;
}
