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
        try {
          scrapeResponse = await chrome.tabs.sendMessage(targetTab.id, { action: 'SCRAPE_TICKETS' });
        } catch (err) {
          console.warn('[Jira Board Reader SW] Retrying message after script re-injection:', err);
          await ensureContentScriptInjected(targetTab.id);
          await new Promise((r) => setTimeout(r, 500));
          scrapeResponse = await chrome.tabs.sendMessage(targetTab.id, { action: 'SCRAPE_TICKETS' });
        }

        if (scrapeResponse && scrapeResponse.success) {
          await saveRecentBoard(targetUrl, scrapeResponse.boardTitle || targetTab.title);
          sendResponse({
            success: true,
            tickets: scrapeResponse.tickets,
            source: scrapeResponse.source,
            boardTitle: scrapeResponse.boardTitle || targetTab.title,
            tabId: targetTab.id,
            url: targetUrl
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
});
