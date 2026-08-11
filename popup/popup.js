// DeveloperTool - Main Popup Controller
document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const openFullTabBtn = document.getElementById('openFullTabBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const openConfigBtn = document.getElementById('openConfigBtn');

  // Standalone Full Tab Mode Check
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('standalone') === 'true' || window.innerWidth > 600) {
    document.body.classList.add('full-tab-mode');
    if (openFullTabBtn) openFullTabBtn.classList.add('hidden');
  }

  if (openFullTabBtn) {
    openFullTabBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?standalone=true') });
    });
  }

  const platformSwitch = document.getElementById('platformSwitch');
  const quickTabBtn = document.getElementById('quickTabBtn');
  const jiraTabBtn = document.getElementById('jiraTabBtn');
  const githubTabBtn = document.getElementById('githubTabBtn');
  const quickActionsSection = document.getElementById('quickActionsSection');

  const statsSection = document.getElementById('statsSection');
  const statTotal = document.getElementById('statTotal');
  const statTodo = document.getElementById('statTodo');
  const statInProgress = document.getElementById('statInProgress');
  const statDone = document.getElementById('statDone');
  const statActionRequired = document.getElementById('statActionRequired');

  const labelTotal = document.getElementById('labelTotal');
  const labelTodo = document.getElementById('labelTodo');
  const labelInProgress = document.getElementById('labelInProgress');
  const labelDone = document.getElementById('labelDone');
  const labelActionNeeded = document.getElementById('labelActionNeeded');

  const githubRepoOverview = document.getElementById('githubRepoOverview');
  const repoChipsContainer = document.getElementById('repoChipsContainer');

  const toolbarSection = document.getElementById('toolbarSection');
  const searchInput = document.getElementById('searchInput');
  const myTicketsToggleBtn = document.getElementById('myTicketsToggleBtn');
  const staleFilterBtn = document.getElementById('staleFilterBtn');
  const unresolvedCommentsFilterBtn = document.getElementById('unresolvedCommentsFilterBtn');
  const statusFilterSelect = document.getElementById('statusFilterSelect');
  const viewBoardBtn = document.getElementById('viewBoardBtn');
  const viewListBtn = document.getElementById('viewListBtn');
  const exportBtn = document.getElementById('exportBtn');

  const welcomeState = document.getElementById('welcomeState');
  const loadingState = document.getElementById('loadingState');
  const loadingMsg = document.getElementById('loadingMsg');
  const errorState = document.getElementById('errorState');
  const errorTitle = document.getElementById('errorTitle');
  const errorMsg = document.getElementById('errorMsg');
  const retryBtn = document.getElementById('retryBtn');
  const ticketsContainer = document.getElementById('ticketsContainer');

  const userLabel = document.getElementById('userLabel');
  const sourceBadge = document.getElementById('sourceBadge');
  const boardTitleLabel = document.getElementById('boardTitleLabel');

  // State Variables
  let currentPlatform = 'quick'; // 'quick' | 'jira' | 'github'
  let jiraTickets = [];
  let myJiraTickets = []; // Always My Items — source for Quick Actions
  let jiraAssigneeFilterApplied = false;
  let githubTickets = [];
  let githubRepoSummaries = [];
  let githubErrors = [];
  let detectedSessionUser = '';
  let activeViewMode = 'board';

  let userEmail = '';
  let defaultJiraUrl = '';
  let githubRepos = [];
  let githubToken = '';
  let githubHost = '';
  let myTicketsOnly = true;
  let staleOnly = false;
  let unresolvedCommentsOnly = false;

  // Load User Configuration from Chrome Local Storage
  const userConfig = await chrome.storage.local.get([
    'userEmail',
    'defaultJiraUrl',
    'myTicketsOnly',
    'githubRepos',
    'githubToken',
    'githubHost'
  ]);

  if (userConfig.userEmail) userEmail = userConfig.userEmail;
  if (userConfig.defaultJiraUrl) defaultJiraUrl = userConfig.defaultJiraUrl;
  if (typeof userConfig.myTicketsOnly === 'boolean') myTicketsOnly = userConfig.myTicketsOnly;
  if (userConfig.githubHost) githubHost = userConfig.githubHost;

  if (userConfig.githubRepos) {
    if (Array.isArray(userConfig.githubRepos)) {
      githubRepos = userConfig.githubRepos;
    } else if (typeof userConfig.githubRepos === 'string') {
      githubRepos = userConfig.githubRepos.split('\n').map((r) => r.trim()).filter(Boolean);
    }
  }
  if (userConfig.githubToken) githubToken = userConfig.githubToken;

  updateUserUI();

  // Show platform switcher when any source is configured
  if (defaultJiraUrl || githubRepos.length > 0) {
    platformSwitch.classList.remove('hidden');
  }
  if (!githubRepos.length && githubTabBtn) {
    githubTabBtn.classList.add('hidden');
  }
  if (!defaultJiraUrl && jiraTabBtn) {
    jiraTabBtn.classList.add('hidden');
  }

  // Open Options Webpage on Settings Click
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }
  if (openConfigBtn) {
    openConfigBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  function setActivePlatformTab(platform) {
    currentPlatform = platform;
    if (quickTabBtn) quickTabBtn.classList.toggle('active', platform === 'quick');
    if (jiraTabBtn) jiraTabBtn.classList.toggle('active', platform === 'jira');
    if (githubTabBtn) githubTabBtn.classList.toggle('active', platform === 'github');
    renderPlatformData();
  }

  // Platform Switcher Listeners
  if (quickTabBtn) {
    quickTabBtn.addEventListener('click', () => setActivePlatformTab('quick'));
  }
  if (jiraTabBtn) {
    jiraTabBtn.addEventListener('click', () => setActivePlatformTab('jira'));
  }
  if (githubTabBtn) {
    githubTabBtn.addEventListener('click', () => setActivePlatformTab('github'));
  }

  // Initial Fetch
  if (defaultJiraUrl || githubRepos.length > 0) {
    triggerFetchAllData();
  }

  async function triggerFetchAllData() {
    showLoading('Fetching tickets & activity...');
    try {
      if (defaultJiraUrl) {
        // Always fetch My Items for Quick Actions
        const myResp = await chrome.runtime.sendMessage({
          action: 'OPEN_AND_READ_BOARD',
          url: defaultJiraUrl,
          myTicketsOnly: true,
          userIdentity: userEmail || ''
        });
        if (myResp && myResp.success) {
          myJiraTickets = myResp.tickets || [];
          boardTitleLabel.innerText = myResp.boardTitle || 'Jira Board';
        }

        if (myTicketsOnly) {
          jiraTickets = myJiraTickets;
          jiraAssigneeFilterApplied = !!(myResp && myResp.assigneeFilterApplied);
          sourceBadge.innerText = `Source: ${(myResp && myResp.source) || 'Jira'}`;
        } else {
          const allResp = await chrome.runtime.sendMessage({
            action: 'OPEN_AND_READ_BOARD',
            url: defaultJiraUrl,
            myTicketsOnly: false,
            userIdentity: userEmail || ''
          });
          if (allResp && allResp.success) {
            jiraTickets = allResp.tickets || [];
            jiraAssigneeFilterApplied = !!allResp.assigneeFilterApplied;
            sourceBadge.innerText = `Source: ${allResp.source || 'Jira'}`;
            boardTitleLabel.innerText = allResp.boardTitle || boardTitleLabel.innerText || 'Jira Board';
          }
        }
      }

      if (githubRepos.length > 0 && typeof fetchAllGitHubData === 'function') {
        const ghData = await fetchAllGitHubData(githubRepos, githubToken, userEmail, githubHost || 'github.com');
        githubTickets = ghData.pullRequests || [];
        githubRepoSummaries = ghData.repoSummaries || [];
        detectedSessionUser = ghData.sessionUser || '';
        githubErrors = ghData.errors || [];
        if (ghData.githubHost) githubHost = ghData.githubHost;

        if (ghData.needsLogin && githubErrors.length === 0) {
          const hostLabel = githubHost || 'GitHub';
          githubErrors = [`Log into ${hostLabel} in your browser to access private repositories, then refresh.`];
        }

        if (!userEmail && detectedSessionUser) {
          userEmail = detectedSessionUser;
          updateUserUI();
        }
      }

      renderPlatformData();
    } catch (err) {
      showError('Execution Error', err.message);
    }
  }

  function isJiraInProgressStatus(status) {
    const s = (status || '').toLowerCase();
    if (s.includes('ready for test')) return false;
    return s.includes('in progress') || s.includes('in review') || s.includes('dev');
  }

  function isJiraReadyForTestingStatus(status) {
    const s = (status || '').toLowerCase();
    return s.includes('ready for testing') || s.includes('ready for test') || s === 'testing';
  }

  function isJiraDoneStatus(status) {
    const s = (status || '').toLowerCase();
    return s.includes('done') || s.includes('closed') || s.includes('resolved') || s.includes('complete') || s.includes('merged');
  }

  function isCommentFromCurrentUser(author) {
    const activeUser = (userEmail || detectedSessionUser || '').toLowerCase().trim();
    if (!activeUser || !author) return false;
    const a = author.toLowerCase().trim();
    if (a === activeUser) return true;
    if (a.includes(activeUser) || activeUser.includes(a)) return true;
    const userPart = activeUser.split('@')[0];
    if (userPart && (a === userPart || a.includes(userPart))) return true;
    return false;
  }

  function buildQuickActionsData() {
    const mine = Array.isArray(myJiraTickets) ? myJiraTickets : [];

    const staleTickets = mine.filter((t) => !isJiraDoneStatus(t.status) && t.actionRequired);

    // Same In Progress definition as Jira My Items stats
    const inProgressTickets = mine.filter((t) => {
      const s = (t.status || '').toLowerCase();
      return s.includes('in progress') || s.includes('in review') || s.includes('dev') || s.includes('testing');
    });

    // Open Comments: only In Progress tickets (not Ready For Testing)
    const openCommentInProgress = mine.filter((t) => isJiraInProgressStatus(t.status));

    const prsWithOpenComments = [];
    let openCommentsCount = 0;
    openCommentInProgress.forEach((ticket) => {
      const key = (ticket.key || '').toUpperCase();
      if (!key) return;
      const linkedPrs = githubTickets.filter((pr) => {
        const linked = (pr.linkedJiraKey || '').toUpperCase();
        return linked && linked === key && (pr.hasUnansweredReviewComments || (pr.unansweredReviewCommentsCount || 0) > 0);
      });
      linkedPrs.forEach((pr) => {
        if (!prsWithOpenComments.some((p) => p.id === pr.id || (p.url && p.url === pr.url))) {
          prsWithOpenComments.push({
            ...pr,
            linkedTicketKey: ticket.key,
            linkedTicketSummary: ticket.summary
          });
          openCommentsCount += pr.unansweredReviewCommentsCount || 1;
        }
      });
    });

    const testerTickets = mine.filter((t) => {
      if (!isJiraReadyForTestingStatus(t.status)) return false;
      if (!t.lastCommentText && !t.lastCommentAuthor) return false;
      // Latest comment from current user = already replied — skip
      if (isCommentFromCurrentUser(t.lastCommentAuthor)) return false;
      return true;
    });

    return {
      actionNeededCount: staleTickets.length,
      inProgressCount: inProgressTickets.length,
      openCommentsCount,
      testerCommentsCount: testerTickets.length,
      staleTickets,
      prsWithOpenComments,
      testerTickets
    };
  }

  function renderQaItemList(container, items, emptyText, mapper) {
    if (!container) return;
    container.innerHTML = '';
    if (!items || items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'qa-empty';
      empty.textContent = emptyText;
      container.appendChild(empty);
      return;
    }
    items.forEach((item) => {
      container.appendChild(mapper(item));
    });
  }

  function createQaLinkItem({ key, meta, summary, comment, url }) {
    const el = document.createElement(url ? 'a' : 'div');
    el.className = 'qa-item';
    if (url) {
      el.href = url;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    }
    el.innerHTML = `
      <div class="qa-item-top">
        <span class="qa-item-key">${escapeHtml(key || '')}</span>
        <span class="qa-item-meta">${escapeHtml(meta || '')}</span>
      </div>
      <div class="qa-item-summary">${escapeHtml(summary || '')}</div>
      ${comment ? `<div class="qa-item-comment">${escapeHtml(comment)}</div>` : ''}
    `;
    if (url) {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(url, '_blank');
      });
    }
    return el;
  }

  function renderQuickActions() {
    if (loadingState) loadingState.classList.add('hidden');
    if (welcomeState) welcomeState.classList.add('hidden');
    if (errorState) errorState.classList.add('hidden');
    if (ticketsContainer) ticketsContainer.classList.add('hidden');
    if (statsSection) statsSection.classList.add('hidden');
    if (toolbarSection) toolbarSection.classList.add('hidden');
    if (githubRepoOverview) githubRepoOverview.classList.add('hidden');
    if (refreshBtn) refreshBtn.classList.remove('spinning');

    if (quickActionsSection) quickActionsSection.classList.remove('hidden');

    const data = buildQuickActionsData();

    const qaStatActionNeeded = document.getElementById('qaStatActionNeeded');
    const qaStatInProgress = document.getElementById('qaStatInProgress');
    const qaStatOpenComments = document.getElementById('qaStatOpenComments');
    const qaStatTesterComments = document.getElementById('qaStatTesterComments');
    const qaStaleCount = document.getElementById('qaStaleCount');
    const qaPrCommentsCount = document.getElementById('qaPrCommentsCount');
    const qaTesterCount = document.getElementById('qaTesterCount');

    if (qaStatActionNeeded) qaStatActionNeeded.innerText = data.actionNeededCount;
    if (qaStatInProgress) qaStatInProgress.innerText = data.inProgressCount;
    if (qaStatOpenComments) qaStatOpenComments.innerText = data.openCommentsCount;
    if (qaStatTesterComments) qaStatTesterComments.innerText = data.testerCommentsCount;
    if (qaStaleCount) qaStaleCount.innerText = data.staleTickets.length;
    if (qaPrCommentsCount) qaPrCommentsCount.innerText = data.prsWithOpenComments.length;
    if (qaTesterCount) qaTesterCount.innerText = data.testerTickets.length;

    renderQaItemList(
      document.getElementById('qaStaleList'),
      data.staleTickets,
      'No stale My Items right now.',
      (t) =>
        createQaLinkItem({
          key: t.key,
          meta: `${t.status || ''} · ${t.hoursSinceUpdate || 24}h`,
          summary: t.summary,
          comment: t.lastCommentText
            ? `${t.lastCommentAuthor || 'User'}: ${t.lastCommentText}`
            : '',
          url: t.url
        })
    );

    renderQaItemList(
      document.getElementById('qaPrCommentsList'),
      data.prsWithOpenComments,
      'No unanswered PR review comments on In Progress tickets.',
      (pr) =>
        createQaLinkItem({
          key: `${pr.linkedTicketKey || ''} ${pr.key || ''}`.trim(),
          meta: pr.repo || '',
          summary: pr.summary,
          comment: pr.lastCommentText
            ? `${pr.lastCommentAuthor || 'Reviewer'}: ${pr.lastCommentText}`
            : 'Unanswered review comments',
          url: pr.url
        })
    );

    renderQaItemList(
      document.getElementById('qaTesterList'),
      data.testerTickets,
      'No tester comments waiting on Ready For Testing items.',
      (t) =>
        createQaLinkItem({
          key: t.key,
          meta: t.status || 'Ready For Testing',
          summary: t.summary,
          comment: t.lastCommentText
            ? `${t.lastCommentAuthor || 'Tester'}: ${t.lastCommentText}`
            : '',
          url: t.url
        })
    );

    if (sourceBadge) sourceBadge.innerText = 'Source: Quick Actions (My Items)';
  }

  function renderPlatformData() {
    const isQuick = currentPlatform === 'quick';
    const isGH = currentPlatform === 'github';

    if (isQuick) {
      renderQuickActions();
      return;
    }

    if (quickActionsSection) quickActionsSection.classList.add('hidden');

    const tickets = isGH ? githubTickets : jiraTickets;

    // Update stat card labels for GitHub vs Jira
    if (labelTotal) labelTotal.innerText = isGH ? 'Total PRs' : 'Total';
    if (labelTodo) labelTodo.innerText = isGH ? 'Open PRs' : 'To Do';
    if (labelInProgress) labelInProgress.innerText = isGH ? 'My PRs' : 'In Progress';
    if (labelDone) labelDone.innerText = isGH ? 'Merged/Closed' : 'Done';
    if (labelActionNeeded) labelActionNeeded.innerText = 'Action Needed';

    // Render GitHub Repos Summary Chips
    if (isGH && githubRepoSummaries.length > 0) {
      renderRepoChips(githubRepoSummaries);
      githubRepoOverview.classList.remove('hidden');
    } else {
      githubRepoOverview.classList.add('hidden');
    }

    renderStats(tickets);
    renderStatusFilterOptions(tickets);
    renderTickets();
  }

  function renderRepoChips(summaries) {
    if (!repoChipsContainer) return;
    repoChipsContainer.innerHTML = '';

    summaries.forEach((summary) => {
      const chip = document.createElement('div');
      chip.className = 'repo-chip';
      chip.title = `${summary.repo}: ${summary.openPRs} open PRs, ${summary.myPRs} by me`;
      chip.innerHTML = `
        <span class="repo-chip-name">${escapeHtml(summary.repo)}</span>
        <span class="repo-chip-pill" title="Total Open PRs">${summary.openPRs} Open</span>
        ${summary.myPRs > 0 ? `<span class="repo-chip-pill my-prs" title="My PRs">${summary.myPRs} Mine</span>` : ''}
      `;
      repoChipsContainer.appendChild(chip);
    });
  }

  // Refresh Button Listener
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('spinning');
      await triggerFetchAllData();
      refreshBtn.classList.remove('spinning');
    });
  }

  if (retryBtn) retryBtn.addEventListener('click', triggerFetchAllData);

  if (myTicketsToggleBtn) {
    myTicketsToggleBtn.addEventListener('click', async () => {
      myTicketsOnly = !myTicketsOnly;
      await chrome.storage.local.set({ myTicketsOnly });
      updateUserUI();
      // Re-fetch Jira with assignee JQL so My Items is exact (not fuzzy client filter)
      if ((currentPlatform === 'jira' || currentPlatform === 'quick') && defaultJiraUrl) {
        showLoading(myTicketsOnly ? 'Filtering your Jira tickets...' : 'Loading all Jira tickets...');
        try {
          // Keep My Items cache fresh for Quick Actions
          const myResp = await chrome.runtime.sendMessage({
            action: 'OPEN_AND_READ_BOARD',
            url: defaultJiraUrl,
            myTicketsOnly: true,
            userIdentity: userEmail || ''
          });
          if (myResp && myResp.success) {
            myJiraTickets = myResp.tickets || [];
          }

          if (myTicketsOnly) {
            jiraTickets = myJiraTickets;
            jiraAssigneeFilterApplied = !!(myResp && myResp.assigneeFilterApplied);
            sourceBadge.innerText = `Source: ${(myResp && myResp.source) || 'Jira'}`;
          } else {
            const resp = await chrome.runtime.sendMessage({
              action: 'OPEN_AND_READ_BOARD',
              url: defaultJiraUrl,
              myTicketsOnly: false,
              userIdentity: userEmail || ''
            });
            if (resp && resp.success) {
              jiraTickets = resp.tickets || [];
              jiraAssigneeFilterApplied = !!resp.assigneeFilterApplied;
              sourceBadge.innerText = `Source: ${resp.source || 'Jira'}`;
              boardTitleLabel.innerText = resp.boardTitle || 'Jira Board';
            }
          }
        } catch (err) {
          console.warn('[DeveloperTool] Jira re-fetch on My Items toggle failed:', err);
        }
        renderPlatformData();
      } else {
        renderTickets();
      }
    });
  }

  if (staleFilterBtn) {
    staleFilterBtn.addEventListener('click', () => {
      staleOnly = !staleOnly;
      staleFilterBtn.classList.toggle('active', staleOnly);
      renderTickets();
    });
  }

  if (unresolvedCommentsFilterBtn) {
    unresolvedCommentsFilterBtn.addEventListener('click', () => {
      unresolvedCommentsOnly = !unresolvedCommentsOnly;
      unresolvedCommentsFilterBtn.classList.toggle('active', unresolvedCommentsOnly);
      renderTickets();
    });
  }

  function updateUserUI() {
    if (myTicketsToggleBtn) myTicketsToggleBtn.classList.toggle('active', myTicketsOnly);
    if (userLabel) {
      const displayUser = userEmail || detectedSessionUser;
      userLabel.innerText = displayUser ? `👤 ${displayUser}` : '';
      userLabel.title = displayUser ? `User: ${displayUser}` : '';
    }
  }

  // --- State Rendering ---
  function showLoading(msg = 'Loading...') {
    if (welcomeState) welcomeState.classList.add('hidden');
    if (errorState) errorState.classList.add('hidden');
    if (ticketsContainer) ticketsContainer.classList.add('hidden');
    if (quickActionsSection) quickActionsSection.classList.add('hidden');
    if (statsSection) statsSection.classList.add('hidden');
    if (toolbarSection) toolbarSection.classList.add('hidden');

    if (loadingMsg) loadingMsg.innerText = msg;
    if (loadingState) loadingState.classList.remove('hidden');
  }

  function showError(title, msg) {
    if (welcomeState) welcomeState.classList.add('hidden');
    if (loadingState) loadingState.classList.add('hidden');
    if (ticketsContainer) ticketsContainer.classList.add('hidden');
    if (statsSection) statsSection.classList.add('hidden');
    if (toolbarSection) toolbarSection.classList.add('hidden');

    if (errorTitle) errorTitle.innerText = title;
    if (errorMsg) errorMsg.innerText = msg;
    if (errorState) errorState.classList.remove('hidden');

    if (refreshBtn) refreshBtn.classList.remove('spinning');
  }

  // --- Stats & Filter Logic ---
  function renderStats(tickets) {
    const isGH = currentPlatform === 'github';
    const total = tickets.length;

    const todoCount = tickets.filter(t => {
      const s = (t.status || '').toLowerCase();
      return s.includes('to do') || s.includes('backlog') || s.includes('open') || s.includes('draft');
    }).length;

    const effectiveUser = (userEmail || detectedSessionUser || '').toLowerCase().trim();
    const inProgCount = isGH
      ? tickets.filter(t => matchesUserAssignee(t, effectiveUser)).length
      : tickets.filter(t => {
          const s = (t.status || '').toLowerCase();
          return s.includes('in progress') || s.includes('in review') || s.includes('dev') || s.includes('testing');
        }).length;

    const doneCount = tickets.filter(t => {
      const s = (t.status || '').toLowerCase();
      return s.includes('done') || s.includes('closed') || s.includes('resolved') || s.includes('complete') || s.includes('merged');
    }).length;

    // RULE: Exclude Done/Closed/Merged items from Action Needed metrics!
    const actionNeededCount = tickets.filter(t => {
      const s = (t.status || '').toLowerCase();
      const isDone = s.includes('done') || s.includes('closed') || s.includes('resolved') || s.includes('merged');
      return !isDone && t.actionRequired;
    }).length;

    if (statTotal) statTotal.innerText = total;
    if (statTodo) statTodo.innerText = todoCount;
    if (statInProgress) statInProgress.innerText = inProgCount;
    if (statDone) statDone.innerText = doneCount;
    if (statActionRequired) statActionRequired.innerText = actionNeededCount;

    if (statsSection) statsSection.classList.remove('hidden');
    if (toolbarSection) toolbarSection.classList.remove('hidden');
  }

  function renderStatusFilterOptions(tickets) {
    if (!statusFilterSelect) return;
    const statuses = new Set();
    tickets.forEach(t => {
      if (t.status) statuses.add(t.status);
    });

    statusFilterSelect.innerHTML = '<option value="ALL">All Statuses</option>';
    statuses.forEach(st => {
      const opt = document.createElement('option');
      opt.value = st;
      opt.innerText = st;
      statusFilterSelect.appendChild(opt);
    });
  }

  // --- View Switcher & Rendering ---
  if (viewBoardBtn) {
    viewBoardBtn.addEventListener('click', () => {
      activeViewMode = 'board';
      viewBoardBtn.classList.add('active');
      if (viewListBtn) viewListBtn.classList.remove('active');
      renderTickets();
    });
  }

  if (viewListBtn) {
    viewListBtn.addEventListener('click', () => {
      activeViewMode = 'list';
      viewListBtn.classList.add('active');
      if (viewBoardBtn) viewBoardBtn.classList.remove('active');
      renderTickets();
    });
  }

  if (searchInput) searchInput.addEventListener('input', renderTickets);
  if (statusFilterSelect) statusFilterSelect.addEventListener('change', renderTickets);

  // Jira: exact email / display name / accountId / username only (no fuzzy matching)
  function matchesJiraAssigneeExact(ticket, userTarget) {
    if (!userTarget) return true;
    if (!ticket) return false;

    const target = userTarget.toLowerCase().trim();
    const email = (ticket.assigneeEmail || '').toLowerCase().trim();
    const name = (ticket.assignee || '').toLowerCase().trim();
    const accountId = (ticket.assigneeAccountId || '').toLowerCase().trim();
    const key = (ticket.assigneeKey || '').toLowerCase().trim();

    if (email && email === target) return true;
    if (name && name === target) return true;
    if (accountId && accountId === target) return true;
    if (key && key === target) return true;
    return false;
  }

  // GitHub: login / author matching (still uses includes for username variants)
  function matchesGitHubUser(ticket, userTarget) {
    if (!userTarget) return true;
    if (!ticket) return false;

    const targetRaw = userTarget.toLowerCase().trim();
    const assigneeName = (ticket.assignee || '').toLowerCase().trim();
    const assigneeEmail = (ticket.assigneeEmail || '').toLowerCase().trim();
    const authorName = (ticket.author || '').toLowerCase().trim();

    if (assigneeName && (assigneeName === targetRaw || assigneeName.includes(targetRaw) || targetRaw.includes(assigneeName))) return true;
    if (assigneeEmail && (assigneeEmail === targetRaw || assigneeEmail.includes(targetRaw))) return true;
    if (authorName && (authorName === targetRaw || authorName.includes(targetRaw) || targetRaw.includes(authorName))) return true;

    const usernamePart = targetRaw.split('@')[0];
    if (usernamePart && (authorName === usernamePart || assigneeName === usernamePart || assigneeEmail === usernamePart)) {
      return true;
    }

    return false;
  }

  function matchesUserAssignee(ticket, userTarget) {
    if (currentPlatform === 'jira' || currentPlatform === 'quick') {
      return matchesJiraAssigneeExact(ticket, userTarget);
    }
    return matchesGitHubUser(ticket, userTarget);
  }

  function getFilteredTickets() {
    const activeTickets = currentPlatform === 'jira' ? jiraTickets : githubTickets;
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const statusVal = statusFilterSelect ? statusFilterSelect.value : 'ALL';
    const activeUser = userEmail || detectedSessionUser;

    return activeTickets.filter((t) => {
      const matchesSearch =
        !query ||
        t.key.toLowerCase().includes(query) ||
        t.summary.toLowerCase().includes(query) ||
        t.assignee.toLowerCase().includes(query) ||
        (t.linkedJiraKey && t.linkedJiraKey.toLowerCase().includes(query)) ||
        (t.lastCommentText && t.lastCommentText.toLowerCase().includes(query));

      const matchesStatus = statusVal === 'ALL' || t.status === statusVal;

      // Jira My Items already applied via assignee JQL / exact identity — don't fuzzy re-filter
      let matchesUser = true;
      if (myTicketsOnly) {
        if (currentPlatform === 'jira' && jiraAssigneeFilterApplied) {
          matchesUser = true;
        } else if (activeUser) {
          matchesUser = matchesUserAssignee(t, activeUser);
        }
      }

      const s = (t.status || '').toLowerCase();
      const isDone = s.includes('done') || s.includes('closed') || s.includes('resolved') || s.includes('merged');

      // Rule: Done tickets NEVER match stale filter!
      const matchesStale = !staleOnly || (!isDone && t.actionRequired);

      const matchesUnresolvedComments = !unresolvedCommentsOnly || t.hasUnresolvedComments || !!t.lastCommentText;

      return matchesSearch && matchesStatus && matchesUser && matchesStale && matchesUnresolvedComments;
    });
  }

  function getJiraBaseUrl(defaultUrl) {
    if (!defaultUrl) return '';
    try {
      const u = new URL(defaultUrl);
      return `${u.protocol}//${u.host}`;
    } catch (e) {
      return '';
    }
  }

  function renderTickets() {
    if (loadingState) loadingState.classList.add('hidden');
    if (welcomeState) welcomeState.classList.add('hidden');
    if (errorState) errorState.classList.add('hidden');
    if (refreshBtn) refreshBtn.classList.remove('spinning');

    const filtered = getFilteredTickets();
    const activeTickets = currentPlatform === 'jira' ? jiraTickets : githubTickets;

    if (!ticketsContainer) return;

    if (filtered.length === 0) {
      let emptyMsg = '<p>No items matched your filter or search query.</p>';
      
      if (currentPlatform === 'github' && githubErrors.length > 0) {
        const needsLogin = githubErrors.some((e) => /log into/i.test(e));
        const loginHost = githubHost || 'github.com';
        emptyMsg = `
          <div style="color: var(--accent-red, #ef4444); font-size: 12px; max-width: 340px; text-align: center;">
            <p>${escapeHtml(githubErrors.join(' '))}</p>
            <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap; margin-top: 12px;">
              ${needsLogin ? `<button id="githubLoginBtn" class="primary-btn">Log in to ${escapeHtml(loginHost)}</button>` : ''}
              <button id="errorConfigBtn" class="secondary-btn">Open Settings</button>
            </div>
          </div>
        `;
      } else if (activeTickets.length > 0 && myTicketsOnly) {
        emptyMsg = `
          <div style="font-size: 12px; color: var(--text-secondary); text-align: center;">
            <p>Found ${activeTickets.length} open item(s) in repo, but none matched your user name ("${escapeHtml(userEmail || detectedSessionUser)}").</p>
            <p style="margin-top: 6px; font-weight: 600; color: var(--accent-blue, #2563eb);">Click 👤 "My Items" filter button above to show ALL open PRs.</p>
          </div>
        `;
      }

      ticketsContainer.innerHTML = `
        <div class="state-container">
          ${emptyMsg}
        </div>
      `;

      const errBtn = document.getElementById('errorConfigBtn');
      if (errBtn) errBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

      const loginBtn = document.getElementById('githubLoginBtn');
      if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
          await chrome.runtime.sendMessage({
            action: 'OPEN_GITHUB_LOGIN',
            host: githubHost || 'github.com'
          });
        });
      }

      ticketsContainer.classList.remove('hidden');
      return;
    }

    if (activeViewMode === 'board') {
      renderBoardView(filtered);
    } else {
      renderListView(filtered);
    }

    ticketsContainer.classList.remove('hidden');
  }

  function getStatusClass(status) {
    const s = (status || '').toLowerCase();
    if (s.includes('done') || s.includes('closed') || s.includes('resolved') || s.includes('merged')) return 'done';
    if (s.includes('review') || s.includes('qa')) return 'in-review';
    if (s.includes('progress') || s.includes('dev') || s.includes('open')) return 'in-progress';
    return 'todo';
  }

  function getPriorityClass(priority) {
    const p = (priority || '').toLowerCase();
    if (p.includes('high') || p.includes('highest') || p.includes('critical')) return 'priority-high';
    if (p.includes('low') || p.includes('lowest')) return 'priority-low';
    return 'priority-med';
  }

  function createTicketCard(ticket) {
    const card = document.createElement('a');
    card.className = `ticket-card ${ticket.actionRequired ? 'stale-warning' : ''}`;
    card.href = ticket.url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';

    const statusClass = getStatusClass(ticket.status);
    const priorityClass = getPriorityClass(ticket.priority);

    // Stale action required alert badge (Only for active non-done items!)
    let actionBadgeHtml = '';
    const s = (ticket.status || '').toLowerCase();
    const isDone = s.includes('done') || s.includes('closed') || s.includes('resolved') || s.includes('merged');

    if (ticket.actionRequired && !isDone) {
      actionBadgeHtml = `
        <div class="action-required-badge">
          <span>🚨 Action Required</span>
          <span>(No update >${ticket.hoursSinceUpdate || 24}h)</span>
        </div>
      `;
    }

    // Linked Jira Ticket Badge on GitHub PR
    let linkedJiraHtml = '';
    if (ticket.isGitHub && ticket.linkedJiraKey) {
      const jiraBase = getJiraBaseUrl(defaultJiraUrl);
      const jiraTicketUrl = jiraBase ? `${jiraBase}/browse/${ticket.linkedJiraKey}` : '#';
      linkedJiraHtml = `
        <span class="linked-jira-badge" data-jira-url="${jiraTicketUrl}" title="Linked Jira Ticket: ${ticket.linkedJiraKey}">
          📌 ${ticket.linkedJiraKey}
        </span>
      `;
    }

    let commentHtml = '';
    if (ticket.lastCommentText) {
      commentHtml = `
        <div class="comment-box ${ticket.hasUnresolvedComments ? 'unresolved-comments' : ''}">
          <div class="comment-header">
            <span class="comment-author">💬 ${escapeHtml(ticket.lastCommentAuthor || 'User')}</span>
            <span class="comment-time">${ticket.hoursSinceUpdate ? `${ticket.hoursSinceUpdate}h ago` : ''}</span>
          </div>
          <div class="comment-snippet">"${escapeHtml(ticket.lastCommentText)}"</div>
        </div>
      `;
    }

    card.innerHTML = `
      ${actionBadgeHtml}
      <div class="ticket-top">
        <div class="ticket-key-group">
          <span class="ticket-key">${ticket.key} ${ticket.isGitHub ? `(${escapeHtml(ticket.repo)})` : ''}</span>
          ${linkedJiraHtml}
        </div>
        <span class="status-badge ${statusClass}">${ticket.status}</span>
      </div>
      <div class="ticket-summary">${escapeHtml(ticket.summary)}</div>
      ${commentHtml}
      <div class="ticket-meta">
        <div class="priority-tag ${priorityClass}">
          <span class="priority-dot"></span>
          <span>${escapeHtml(ticket.priority || 'Medium')}</span>
        </div>
        <div class="assignee-tag" title="${escapeHtml(ticket.assignee)}">
          👤 ${escapeHtml(ticket.assignee || 'Unassigned')}
        </div>
      </div>
    `;

    // Linked Jira Badge Click Listener
    const jiraBadgeElem = card.querySelector('.linked-jira-badge');
    if (jiraBadgeElem) {
      jiraBadgeElem.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const jiraUrl = jiraBadgeElem.getAttribute('data-jira-url');
        if (jiraUrl && jiraUrl !== '#') {
          window.open(jiraUrl, '_blank');
        }
      });
    }

    card.addEventListener('click', (e) => {
      e.preventDefault();
      window.open(ticket.url, '_blank');
    });

    return card;
  }

  function renderBoardView(tickets) {
    const groups = {};
    tickets.forEach((t) => {
      const st = t.status || 'To Do';
      if (!groups[st]) groups[st] = [];
      groups[st].push(t);
    });

    const kanbanWrapper = document.createElement('div');
    kanbanWrapper.className = 'kanban-view';

    Object.keys(groups).forEach((statusName) => {
      const col = document.createElement('div');
      col.className = 'kanban-column';

      const header = document.createElement('div');
      header.className = 'kanban-col-header';
      header.innerHTML = `
        <span class="kanban-col-title">${escapeHtml(statusName)}</span>
        <span class="kanban-col-count">${groups[statusName].length}</span>
      `;

      const cardsWrapper = document.createElement('div');
      cardsWrapper.className = 'kanban-cards-wrapper';

      groups[statusName].forEach((ticket) => {
        cardsWrapper.appendChild(createTicketCard(ticket));
      });

      col.appendChild(header);
      col.appendChild(cardsWrapper);
      kanbanWrapper.appendChild(col);
    });

    ticketsContainer.innerHTML = '';
    ticketsContainer.appendChild(kanbanWrapper);
  }

  function renderListView(tickets) {
    const listWrapper = document.createElement('div');
    listWrapper.className = 'list-view';

    tickets.forEach((ticket) => {
      listWrapper.appendChild(createTicketCard(ticket));
    });

    ticketsContainer.innerHTML = '';
    ticketsContainer.appendChild(listWrapper);
  }

  // --- CSV Export ---
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const activeTickets = currentPlatform === 'jira' ? jiraTickets : githubTickets;
      if (activeTickets.length === 0) return;

      const headers = ['Key', 'Summary', 'Status', 'Priority', 'Assignee', 'Linked Jira Ticket', 'Last Comment Author', 'Last Comment Text', 'Action Required', 'URL'];
      const csvRows = [headers.join(',')];

      activeTickets.forEach((t) => {
        const row = [
          `"${t.key.replace(/"/g, '""')}"`,
          `"${t.summary.replace(/"/g, '""')}"`,
          `"${t.status.replace(/"/g, '""')}"`,
          `"${t.priority.replace(/"/g, '""')}"`,
          `"${t.assignee.replace(/"/g, '""')}"`,
          `"${(t.linkedJiraKey || '').replace(/"/g, '""')}"`,
          `"${(t.lastCommentAuthor || '').replace(/"/g, '""')}"`,
          `"${(t.lastCommentText || '').replace(/"/g, '""')}"`,
          `"${t.actionRequired ? 'YES' : 'NO'}"`,
          `"${t.url.replace(/"/g, '""')}"`
        ];
        csvRows.push(row.join(','));
      });

      const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvRows.join('\n'));
      const link = document.createElement('a');
      link.setAttribute('href', csvContent);
      link.setAttribute('download', `DeveloperTool_${currentPlatform}_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
});
