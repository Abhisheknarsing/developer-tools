// DeveloperTool - GitHub API & Activity Client

function parseGitHubRepoUrl(urlOrName) {
  if (!urlOrName) return null;
  let str = urlOrName.trim();
  if (str.startsWith('http://') || str.startsWith('https://')) {
    try {
      const u = new URL(str);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return { owner: parts[0], repo: parts[1].replace('.git', '') };
      }
    } catch (e) {
      return null;
    }
  } else {
    const parts = str.split('/').filter(Boolean);
    if (parts.length === 2) {
      return { owner: parts[0], repo: parts[1] };
    }
  }
  return null;
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

async function fetchGitHubRepoPullRequests(owner, repo, token = '') {
  try {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=20`;
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `token ${token}`;

    const resp = await fetch(apiUrl, { headers });
    if (!resp.ok) return [];

    const pulls = await resp.json();
    return pulls.map((pr) => {
      const updatedAt = pr.updated_at || pr.created_at;
      const hoursAgo = calculateHoursAgo(updatedAt);
      const minutesAgo = calculateMinutesAgo(updatedAt);

      // Determine state label
      let stateLabel = 'Open';
      if (pr.draft) stateLabel = 'Draft';
      if (pr.merged_at) stateLabel = 'Merged';
      if (pr.state === 'closed' && !pr.merged_at) stateLabel = 'Closed';

      // Rule: Exclude closed / merged items from action required!
      const isDoneOrClosed = stateLabel === 'Closed' || stateLabel === 'Merged';
      const actionRequired = !isDoneOrClosed && hoursAgo >= 24;

      const assigneesList = (pr.assignees || []).map((a) => a.login);
      if (pr.assignee && !assigneesList.includes(pr.assignee.login)) {
        assigneesList.push(pr.assignee.login);
      }

      return {
        id: `pr-${pr.id}`,
        key: `#${pr.number}`,
        repo: `${owner}/${repo}`,
        summary: pr.title,
        status: stateLabel,
        priority: pr.draft ? 'Low' : 'High',
        assignee: assigneesList.join(', ') || (pr.user ? pr.user.login : 'Unassigned'),
        assigneeEmail: pr.user ? pr.user.login : '',
        type: 'Pull Request',
        url: pr.html_url,
        lastCommentAuthor: pr.user ? pr.user.login : 'Author',
        lastCommentText: pr.body ? (pr.body.length > 80 ? pr.body.substring(0, 80) + '...' : pr.body) : 'Pull Request',
        lastCommentDate: updatedAt,
        hoursSinceUpdate: hoursAgo,
        minutesSinceUpdate: minutesAgo,
        actionRequired,
        isGitHub: true
      };
    });
  } catch (err) {
    console.warn(`[DeveloperTool] Error fetching PRs for ${owner}/${repo}:`, err);
    return [];
  }
}

async function fetchAllGitHubItems(repoList = [], token = '') {
  if (!repoList || repoList.length === 0) return [];

  const results = await Promise.all(
    repoList.map(async (repoItem) => {
      const parsed = parseGitHubRepoUrl(repoItem);
      if (!parsed) return [];
      return await fetchGitHubRepoPullRequests(parsed.owner, parsed.repo, token);
    })
  );

  return results.flat();
}
