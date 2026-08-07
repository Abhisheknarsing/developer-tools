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

async function findOrOpenGitHubTab(preferLogin = false) {
  const tabs = await chrome.tabs.query({});
  let targetTab = tabs.find(
    (t) => t.url && /https?:\/\/(www\.)?github\.com/i.test(t.url) && !/\/login/i.test(t.url)
  );

  if (!targetTab && preferLogin) {
    targetTab = tabs.find((t) => t.url && /https?:\/\/(www\.)?github\.com\/login/i.test(t.url));
  }

  if (!targetTab) {
    const url = preferLogin ? 'https://github.com/login' : 'https://github.com/';
    targetTab = await chrome.tabs.create({ url, active: preferLogin });
    await waitForTabLoad(targetTab.id);
  } else if (targetTab.status !== 'complete') {
    await waitForTabLoad(targetTab.id);
  }

  await new Promise((r) => setTimeout(r, 600));
  await ensureGitHubSessionScriptInjected(targetTab.id);
  return targetTab;
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
  if (message.action === 'FETCH_GITHUB_VIA_SESSION') {
    (async () => {
      try {
        const repos = Array.isArray(message.repos) ? message.repos : [];
        if (repos.length === 0) {
          sendResponse({ success: true, sessionUser: '', results: [], needsLogin: false });
          return;
        }

        let targetTab = await findOrOpenGitHubTab(false);
        let sessionInfo = await sendGitHubTabMessage(targetTab.id, { action: 'DETECT_GITHUB_SESSION' });

        if (!sessionInfo || !sessionInfo.loggedIn) {
          // Open login so the user can authenticate with their browser session
          targetTab = await findOrOpenGitHubTab(true);
          sessionInfo = await sendGitHubTabMessage(targetTab.id, { action: 'DETECT_GITHUB_SESSION' });

          if (!sessionInfo || !sessionInfo.loggedIn) {
            sendResponse({
              success: false,
              needsLogin: true,
              sessionUser: '',
              results: [],
              error: 'Log into GitHub in your browser, then refresh DeveloperTool. Private repos use your browser session.'
            });
            return;
          }
        }

        const sessionUser = sessionInfo.sessionUser || '';
        const results = [];

        for (const repoItem of repos) {
          const owner = repoItem.owner;
          const repo = repoItem.repo;
          if (!owner || !repo) continue;

          const prResponse = await sendGitHubTabMessage(targetTab.id, {
            action: 'FETCH_GITHUB_REPO_PRS',
            owner,
            repo,
            enrichDetails: message.enrichDetails !== false
          });

          if (prResponse && prResponse.needsLogin) {
            sendResponse({
              success: false,
              needsLogin: true,
              sessionUser,
              results,
              error: 'GitHub session expired. Log into GitHub in your browser, then refresh.'
            });
            return;
          }

          results.push({
            owner,
            repo,
            error: prResponse && prResponse.error ? prResponse.error : null,
            pulls: (prResponse && prResponse.pulls) || []
          });
        }

        sendResponse({
          success: true,
          needsLogin: false,
          sessionUser,
          results,
          source: 'GitHub Session'
        });
      } catch (err) {
        console.error('[DeveloperTool SW] GitHub session fetch error:', err);
        sendResponse({
          success: false,
          needsLogin: false,
          sessionUser: '',
          results: [],
          error: err.message
        });
      }
    })();
    return true;
  }

  if (message.action === 'OPEN_GITHUB_LOGIN') {
    (async () => {
      try {
        await findOrOpenGitHubTab(true);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});
