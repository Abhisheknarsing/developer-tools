// DeveloperTool - Popup Script
document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const refreshBtn = document.getElementById('refreshBtn');
  const settingsBtn = document.getElementById('settingsBtn');

  const statsSection = document.getElementById('statsSection');
  const statTotal = document.getElementById('statTotal');
  const statTodo = document.getElementById('statTodo');
  const statInProgress = document.getElementById('statInProgress');
  const statDone = document.getElementById('statDone');
  const statActionRequired = document.getElementById('statActionRequired');

  const toolbarSection = document.getElementById('toolbarSection');
  const searchInput = document.getElementById('searchInput');
  const myTicketsToggleBtn = document.getElementById('myTicketsToggleBtn');
  const staleFilterBtn = document.getElementById('staleFilterBtn');
  const recent5mFilterBtn = document.getElementById('recent5mFilterBtn');
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

  const settingsModal = document.getElementById('settingsModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const modalJiraUrl = document.getElementById('modalJiraUrl');
  const modalUserEmail = document.getElementById('modalUserEmail');
  const modalMyTicketsOnly = document.getElementById('modalMyTicketsOnly');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');

  // State Variables
  let currentTickets = [];
  let activeViewMode = 'board';
  let userEmail = '';
  let defaultJiraUrl = '';
  let myTicketsOnly = true;
  let staleOnly = false;
  let recent5mOnly = false;

  // Load User Configuration
  const userConfig = await chrome.storage.local.get(['userEmail', 'defaultJiraUrl', 'myTicketsOnly']);
  if (userConfig.userEmail) userEmail = userConfig.userEmail;
  if (userConfig.defaultJiraUrl) defaultJiraUrl = userConfig.defaultJiraUrl;
  if (typeof userConfig.myTicketsOnly === 'boolean') myTicketsOnly = userConfig.myTicketsOnly;

  updateUserUI();

  // Auto-fetch if URL is configured. If empty, open configuration modal.
  if (!defaultJiraUrl) {
    openSettingsModal();
  } else {
    triggerOpenAndRead(defaultJiraUrl);
  }

  // --- Core Ticket Loading Functions ---
  async function triggerOpenAndRead(targetUrl = defaultJiraUrl) {
    const rawUrl = targetUrl || defaultJiraUrl;
    if (!rawUrl) {
      return; // Do nothing if URL is empty
    }

    let formattedUrl = rawUrl.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = 'https://' + formattedUrl;
    }

    showLoading('Reading tickets & comments...');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'OPEN_AND_READ_BOARD',
        url: formattedUrl
      });

      if (response && response.success) {
        handleTicketsLoaded(response);
      } else {
        showError(
          'Could not read Jira tickets',
          response ? response.error : 'Make sure you are logged into Jira and the URL is accessible.'
        );
      }
    } catch (err) {
      showError('Execution Error', err.message);
    }
  }

  function handleTicketsLoaded(data) {
    currentTickets = data.tickets || [];
    renderStats(currentTickets);
    renderStatusFilterOptions(currentTickets);

    sourceBadge.innerText = data.source ? `Source: ${data.source}` : 'Source: DOM';
    boardTitleLabel.innerText = data.boardTitle || 'Jira Board';

    renderTickets();
  }

  // --- Settings & Control Event Listeners ---
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (!defaultJiraUrl) {
        openSettingsModal();
        return;
      }
      refreshBtn.classList.add('spinning');
      triggerOpenAndRead(defaultJiraUrl);
    });
  }

  if (settingsBtn) settingsBtn.addEventListener('click', openSettingsModal);
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeSettingsModal);
  if (retryBtn) retryBtn.addEventListener('click', () => triggerOpenAndRead(defaultJiraUrl));

  if (myTicketsToggleBtn) {
    myTicketsToggleBtn.addEventListener('click', async () => {
      myTicketsOnly = !myTicketsOnly;
      await chrome.storage.local.set({ myTicketsOnly });
      updateUserUI();
      renderTickets();
    });
  }

  if (staleFilterBtn) {
    staleFilterBtn.addEventListener('click', () => {
      staleOnly = !staleOnly;
      staleFilterBtn.classList.toggle('active', staleOnly);
      renderTickets();
    });
  }

  if (recent5mFilterBtn) {
    recent5mFilterBtn.addEventListener('click', () => {
      recent5mOnly = !recent5mOnly;
      recent5mFilterBtn.classList.toggle('active', recent5mOnly);
      renderTickets();
    });
  }

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', async () => {
      const urlVal = modalJiraUrl.value.trim();
      const emailVal = modalUserEmail.value.trim();
      const myOnlyVal = modalMyTicketsOnly.checked;

      if (!urlVal) {
        alert('Please enter a default Jira Board URL');
        return;
      }
      if (!emailVal) {
        alert('Please enter your email or username');
        return;
      }

      userEmail = emailVal;
      defaultJiraUrl = urlVal;
      myTicketsOnly = myOnlyVal;

      await chrome.storage.local.set({
        userEmail,
        defaultJiraUrl,
        myTicketsOnly
      });

      updateUserUI();
      closeSettingsModal();
      triggerOpenAndRead(defaultJiraUrl);
    });
  }

  function openSettingsModal() {
    if (modalJiraUrl) modalJiraUrl.value = defaultJiraUrl || '';
    if (modalUserEmail) modalUserEmail.value = userEmail || '';
    if (modalMyTicketsOnly) modalMyTicketsOnly.checked = myTicketsOnly;
    if (settingsModal) settingsModal.classList.remove('hidden');
  }

  function closeSettingsModal() {
    if (settingsModal) settingsModal.classList.add('hidden');
  }

  function updateUserUI() {
    if (myTicketsToggleBtn) myTicketsToggleBtn.classList.toggle('active', myTicketsOnly);
    if (userLabel) {
      userLabel.innerText = userEmail ? `👤 ${userEmail}` : '';
      userLabel.title = userEmail ? `User: ${userEmail}` : '';
    }
  }

  // --- State Rendering ---
  function showLoading(msg = 'Loading...') {
    if (welcomeState) welcomeState.classList.add('hidden');
    if (errorState) errorState.classList.add('hidden');
    if (ticketsContainer) ticketsContainer.classList.add('hidden');

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

    resetButtonState();
  }

  function resetButtonState() {
    if (refreshBtn) refreshBtn.classList.remove('spinning');
  }

  // --- Stats & Filter Logic ---
  function renderStats(tickets) {
    const total = tickets.length;

    const todoCount = tickets.filter(t => {
      const s = (t.status || '').toLowerCase();
      return s.includes('to do') || s.includes('backlog') || s.includes('open');
    }).length;

    const inProgCount = tickets.filter(t => {
      const s = (t.status || '').toLowerCase();
      return s.includes('in progress') || s.includes('in review') || s.includes('dev') || s.includes('testing');
    }).length;

    const doneCount = tickets.filter(t => {
      const s = (t.status || '').toLowerCase();
      return s.includes('done') || s.includes('closed') || s.includes('resolved') || s.includes('complete');
    }).length;

    const actionNeededCount = tickets.filter(t => t.actionRequired).length;

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

  function matchesUserAssignee(ticket, userTarget) {
    if (!userTarget) return true;
    if (!ticket) return false;

    const targetRaw = userTarget.toLowerCase().trim();
    const assigneeName = (ticket.assignee || '').toLowerCase().trim();
    const assigneeEmail = (ticket.assigneeEmail || '').toLowerCase().trim();

    if (assigneeName.includes(targetRaw) || targetRaw.includes(assigneeName)) return true;
    if (assigneeEmail && (assigneeEmail.includes(targetRaw) || targetRaw.includes(assigneeEmail))) return true;

    const usernamePart = targetRaw.split('@')[0];
    const targetTokens = usernamePart.split(/[\s._-]+/).filter(t => t.length > 1);

    if (targetTokens.length > 0) {
      const allMatch = targetTokens.every(token => assigneeName.includes(token) || assigneeEmail.includes(token));
      if (allMatch) return true;

      const anyMatch = targetTokens.some(token => assigneeName.includes(token));
      if (anyMatch) return true;
    }

    return false;
  }

  function getFilteredTickets() {
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const statusVal = statusFilterSelect ? statusFilterSelect.value : 'ALL';

    return currentTickets.filter((t) => {
      const matchesSearch =
        !query ||
        t.key.toLowerCase().includes(query) ||
        t.summary.toLowerCase().includes(query) ||
        t.assignee.toLowerCase().includes(query) ||
        (t.lastCommentText && t.lastCommentText.toLowerCase().includes(query));

      const matchesStatus = statusVal === 'ALL' || t.status === statusVal;

      const matchesUser = !myTicketsOnly || !userEmail || matchesUserAssignee(t, userEmail);

      const matchesStale = !staleOnly || t.actionRequired;

      const matchesRecent5m = !recent5mOnly || (typeof t.minutesSinceUpdate === 'number' && t.minutesSinceUpdate <= 5);

      return matchesSearch && matchesStatus && matchesUser && matchesStale && matchesRecent5m;
    });
  }

  function renderTickets() {
    resetButtonState();
    if (loadingState) loadingState.classList.add('hidden');
    if (welcomeState) welcomeState.classList.add('hidden');
    if (errorState) errorState.classList.add('hidden');

    const filtered = getFilteredTickets();

    if (!ticketsContainer) return;

    if (filtered.length === 0) {
      ticketsContainer.innerHTML = `
        <div class="state-container">
          <p>No tickets matched your filter or search query.</p>
        </div>
      `;
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
    if (s.includes('done') || s.includes('closed') || s.includes('resolved')) return 'done';
    if (s.includes('review') || s.includes('qa')) return 'in-review';
    if (s.includes('progress') || s.includes('dev')) return 'in-progress';
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

    let actionBadgeHtml = '';
    if (ticket.actionRequired) {
      actionBadgeHtml = `
        <div class="action-required-badge">
          <span>🚨 Action Required</span>
          <span>(No update >${ticket.hoursSinceUpdate || 24}h)</span>
        </div>
      `;
    }

    let commentHtml = '';
    if (ticket.lastCommentText) {
      commentHtml = `
        <div class="comment-box">
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
        <span class="ticket-key">${ticket.key}</span>
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
      if (currentTickets.length === 0) return;

      const headers = ['Key', 'Summary', 'Status', 'Priority', 'Assignee', 'Last Comment Author', 'Last Comment Text', 'Action Required', 'URL'];
      const csvRows = [headers.join(',')];

      currentTickets.forEach((t) => {
        const row = [
          `"${t.key.replace(/"/g, '""')}"`,
          `"${t.summary.replace(/"/g, '""')}"`,
          `"${t.status.replace(/"/g, '""')}"`,
          `"${t.priority.replace(/"/g, '""')}"`,
          `"${t.assignee.replace(/"/g, '""')}"`,
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
      link.setAttribute('download', `DeveloperTool_Tickets_${Date.now()}.csv`);
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
