// Jira Board Reader - Background Service Worker (Manifest V3)

// Helper to wait for a tab to complete loading
function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    function checkTab() {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          return resolve(false);
        }
        if (tab.status === 'complete') {
          return resolve(true);
        }
        if (Date.now() - startTime > timeoutMs) {
          return resolve(false); // timeout
        }
        setTimeout(checkTab, 500);
      });
    }

    checkTab();
  });
}

// Inject content script if not already present
async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['scripts/content.js']
    });
  } catch (err) {
    console.warn('[Jira Board Reader SW] ExecuteScript notice:', err.message);
  }
}

async function ensureGitHubSessionScriptInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['scripts/github_session.js']
    });
  } catch (err) {
    console.warn('[DeveloperTool SW] GitHub session script inject notice:', err.message);
  }
}

async function findOrOpenGitHubTab(preferLogin = false, host = 'github.com') {
  const normalizedHost = String(host || 'github.com')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase() || 'github.com';
  const origin = `https://${normalizedHost}`;
  const hostPattern = normalizedHost.replace(/\./g, '\\.');

  const tabs = await chrome.tabs.query({});
  let targetTab = tabs.find(
    (t) =>
      t.url &&
      new RegExp(`https?:\\/\\/(www\\.)?${hostPattern}`, 'i').test(t.url) &&
      !/\/(login|session)/i.test(t.url)
  );

  if (!targetTab && preferLogin) {
    targetTab = tabs.find(
      (t) => t.url && new RegExp(`https?:\\/\\/(www\\.)?${hostPattern}\\/(login|session)`, 'i').test(t.url)
    );
  }

  if (!targetTab) {
    const url = preferLogin ? `${origin}/login` : origin;
    targetTab = await chrome.tabs.create({ url, active: preferLogin });
    await waitForTabLoad(targetTab.id);
  } else if (targetTab.status !== 'complete') {
    await waitForTabLoad(targetTab.id);
  }

  await new Promise((r) => setTimeout(r, 600));
  await ensureGitHubSessionScriptInjected(targetTab.id);
  return { tab: targetTab, host: normalizedHost, origin };
}

async function sendGitHubTabMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    await ensureGitHubSessionScriptInjected(tabId);
    await new Promise((r) => setTimeout(r, 400));
    return chrome.tabs.sendMessage(tabId, message);
  }
}

// Save board URL to recent search history in chrome.storage.local
async function saveRecentBoard(url, title = '') {
  try {
    const { recentBoards = [] } = await chrome.storage.local.get('recentBoards');
    const existingIndex = recentBoards.findIndex((b) => b.url === url);

    if (existingIndex !== -1) {
      recentBoards.splice(existingIndex, 1);
    }

    recentBoards.unshift({
      url,
      title: title || url,
      timestamp: Date.now()
    });

    // Keep max 10 recent boards
    const updated = recentBoards.slice(0, 10);
    await chrome.storage.local.set({ recentBoards: updated });
  } catch (err) {
    console.error('[Jira Board Reader SW] Storage error:', err);
  }
}

// Handle runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'OPEN_AND_READ_BOARD') {
    (async () => {
      try {
        const targetUrl = message.url;
        if (!targetUrl) {
          sendResponse({ success: false, error: 'No URL provided' });
          return;
        }

        // Check existing tabs
        const tabs = await chrome.tabs.query({});
        let targetTab = tabs.find((t) => t.url && t.url.includes(targetUrl));

        if (!targetTab) {
          // Check by domain or pattern
          const urlObj = new URL(targetUrl);
          targetTab = tabs.find((t) => t.url && t.url.includes(urlObj.hostname));
        }

        if (targetTab) {
          // Ensure loaded without stealing focus from popup
          if (targetTab.status !== 'complete') {
            await waitForTabLoad(targetTab.id);
          }
        } else {
          // Open tab in background (active: false) so popup stays open
          targetTab = await chrome.tabs.create({ url: targetUrl, active: false });
          await waitForTabLoad(targetTab.id);
        }

        // Wait brief pause for SPA rendering
        await new Promise((r) => setTimeout(r, 1500));

        // Inject content script
        await ensureContentScriptInjected(targetTab.id);

        // Send scrape request
        let scrapeResponse = null;
        const scrapePayload = {
          action: 'SCRAPE_TICKETS',
          myTicketsOnly: !!message.myTicketsOnly,
          userIdentity: message.userIdentity || ''
        };
        try {
          scrapeResponse = await chrome.tabs.sendMessage(targetTab.id, scrapePayload);
        } catch (err) {
          console.warn('[Jira Board Reader SW] Retrying message after script re-injection:', err);
          await ensureContentScriptInjected(targetTab.id);
          await new Promise((r) => setTimeout(r, 500));
          scrapeResponse = await chrome.tabs.sendMessage(targetTab.id, scrapePayload);
        }

        if (scrapeResponse && scrapeResponse.success) {
          await saveRecentBoard(targetUrl, scrapeResponse.boardTitle || targetTab.title);
          sendResponse({
            success: true,
            tickets: scrapeResponse.tickets,
            source: scrapeResponse.source,
            boardTitle: scrapeResponse.boardTitle || targetTab.title,
            tabId: targetTab.id,
            url: targetUrl,
            assigneeFilterApplied: !!scrapeResponse.assigneeFilterApplied
          });
        } else {
          sendResponse({
            success: false,
            error: scrapeResponse ? scrapeResponse.error : 'Could not read tickets from Jira page. Make sure you are logged into Jira.'
          });
        }
      } catch (err) {
        console.error('[Jira Board Reader SW] Process error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep channel open
  }

  if (message.action === 'GET_ACTIVE_TAB_TICKETS') {
    (async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab || !activeTab.url) {
          sendResponse({ success: false, error: 'No active tab found' });
          return;
        }

        await ensureContentScriptInjected(activeTab.id);
        const scrapeResponse = await chrome.tabs.sendMessage(activeTab.id, { action: 'SCRAPE_TICKETS' });

        if (scrapeResponse && scrapeResponse.success) {
          await saveRecentBoard(activeTab.url, scrapeResponse.boardTitle || activeTab.title);
          sendResponse({
            success: true,
            tickets: scrapeResponse.tickets,
            source: scrapeResponse.source,
            boardTitle: scrapeResponse.boardTitle || activeTab.title,
            url: activeTab.url
          });
        } else {
          sendResponse({ success: false, error: 'Not a recognized Jira page or page is loading' });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // Fetch private/public GitHub PRs using the browser's logged-in GitHub session
  // Supports github.com and GitHub Enterprise hosts (e.g. github.securian.com)
  if (message.action === 'FETCH_GITHUB_VIA_SESSION') {
    (async () => {
      try {
        const repos = Array.isArray(message.repos) ? message.repos : [];
        if (repos.length === 0) {
          sendResponse({ success: true, sessionUser: '', results: [], needsLogin: false, githubHost: 'github.com' });
          return;
        }

        // Group by host so Enterprise and github.com sessions stay separate
        const byHost = {};
        repos.forEach((repoItem) => {
          const host = (repoItem.host || message.host || 'github.com').toLowerCase();
          if (!byHost[host]) byHost[host] = [];
          byHost[host].push(repoItem);
        });

        const allResults = [];
        let sessionUser = '';
        let primaryHost = message.host || Object.keys(byHost)[0] || 'github.com';

        for (const host of Object.keys(byHost)) {
          primaryHost = host;
          let opened = await findOrOpenGitHubTab(false, host);
          let targetTab = opened.tab;
          let sessionInfo = await sendGitHubTabMessage(targetTab.id, {
            action: 'DETECT_GITHUB_SESSION',
            host
          });

          if (!sessionInfo || !sessionInfo.loggedIn) {
            opened = await findOrOpenGitHubTab(true, host);
            targetTab = opened.tab;
            sessionInfo = await sendGitHubTabMessage(targetTab.id, {
              action: 'DETECT_GITHUB_SESSION',
              host
            });

            if (!sessionInfo || !sessionInfo.loggedIn) {
              sendResponse({
                success: false,
                needsLogin: true,
                sessionUser: '',
                results: allResults,
                githubHost: host,
                error: `Log into ${host} in your browser, then refresh DeveloperTool. Enterprise GitHub uses that host's session (not github.com).`
              });
              return;
            }
          }

          sessionUser = sessionInfo.sessionUser || sessionUser;

          for (const repoItem of byHost[host]) {
            const owner = repoItem.owner;
            const repo = repoItem.repo;
            if (!owner || !repo) continue;

            const prResponse = await sendGitHubTabMessage(targetTab.id, {
              action: 'FETCH_GITHUB_REPO_PRS',
              owner,
              repo,
              host,
              origin: repoItem.origin || opened.origin,
              enrichDetails: message.enrichDetails !== false
            });

            if (prResponse && prResponse.needsLogin) {
              sendResponse({
                success: false,
                needsLogin: true,
                sessionUser,
                results: allResults,
                githubHost: host,
                error: `Session expired on ${host}. Log into that GitHub host in your browser, then refresh.`
              });
              return;
            }

            allResults.push({
              owner,
              repo,
              host,
              error: prResponse && prResponse.error ? prResponse.error : null,
              pulls: (prResponse && prResponse.pulls) || []
            });
          }
        }

        sendResponse({
          success: true,
          needsLogin: false,
          sessionUser,
          results: allResults,
          githubHost: primaryHost,
          source: 'GitHub Session'
        });
      } catch (err) {
        console.error('[DeveloperTool SW] GitHub session fetch error:', err);
        sendResponse({
          success: false,
          needsLogin: false,
          sessionUser: '',
          results: [],
          githubHost: message.host || 'github.com',
          error: err.message
        });
      }
    })();
    return true;
  }

  if (message.action === 'OPEN_GITHUB_LOGIN') {
    (async () => {
      try {
        await findOrOpenGitHubTab(true, message.host || 'github.com');
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});
