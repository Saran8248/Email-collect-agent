/**
 * HR Contact Collection Agent - Background Service Worker
 * Coordinates bounded same-origin crawl navigation in the active tab
 * and handles communication with the FastAPI backend.
 */

const API_BASE_URL = "http://127.0.0.1:8000";

let crawlState = {
  status: "idle", // 'idle' | 'running' | 'paused' | 'stopped' | 'completed'
  tabId: null,
  origin: "",
  queue: [],
  visited: [],
  maxPages: 5,
  delayMs: 2000,
  pagesVisited: 0,
  contactsCollected: 0,
  currentUrl: "",
  error: null
};

// Initialize or load state from storage
chrome.storage.local.get(["hrCrawlState"], (res) => {
  if (res.hrCrawlState) {
    crawlState = { ...crawlState, ...res.hrCrawlState };
    // If browser restarted during running, set status to stopped
    if (crawlState.status === "running") {
      crawlState.status = "paused";
      saveState();
    }
  }
});

function saveState() {
  chrome.storage.local.set({ hrCrawlState: crawlState });
  broadcastProgress();
}

function broadcastProgress() {
  chrome.runtime.sendMessage({
    action: "CRAWL_PROGRESS",
    state: crawlState
  }).catch(() => {
    // Popup might not be open, ignore error
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send contact records to FastAPI backend
 */
async function saveContactsToApi(contacts) {
  if (!contacts || contacts.length === 0) return { inserted: 0, updated: 0, skipped: 0 };

  try {
    const response = await fetch(`${API_BASE_URL}/api/contacts/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacts: contacts })
    });

    if (!response.ok) {
      throw new Error(`API responded with status ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error("Error sending contacts to backend:", err);
    throw err;
  }
}

/**
 * Wait for a tab to finish loading
 */
function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Inject content script and execute analysis in the target tab
 */
async function extractFromTab(tabId) {
  try {
    // Inject content.js if not already present
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content.js"]
    });

    // Request analysis
    const response = await chrome.tabs.sendMessage(tabId, { action: "ANALYZE_PAGE" });
    return response;
  } catch (err) {
    console.warn("Failed to extract data from tab:", err);
    return null;
  }
}

/**
 * Main crawl step processor
 */
async function runCrawlLoop() {
  while (crawlState.status === "running") {
    // Check if reached max pages or queue is empty
    if (crawlState.pagesVisited >= crawlState.maxPages) {
      crawlState.status = "completed";
      saveState();
      break;
    }

    if (crawlState.queue.length === 0) {
      crawlState.status = "completed";
      saveState();
      break;
    }

    // Pick next URL
    const nextUrl = crawlState.queue.shift();
    if (crawlState.visited.includes(nextUrl)) {
      continue;
    }

    crawlState.visited.push(nextUrl);
    crawlState.currentUrl = nextUrl;
    crawlState.pagesVisited++;
    saveState();

    try {
      // Navigate tab to nextUrl
      await chrome.tabs.update(crawlState.tabId, { url: nextUrl });
      await waitForTabLoad(crawlState.tabId);

      // Wait configured delay
      await delay(crawlState.delayMs);

      if (crawlState.status !== "running") {
        break;
      }

      // Extract page details
      const analysis = await extractFromTab(crawlState.tabId);
      if (analysis && analysis.success && analysis.data) {
        const pageData = analysis.data;

        // If emails were found on page, format for API
        if (pageData.emails && pageData.emails.length > 0) {
          const contactsToSave = pageData.emails.map(e => ({
            company_name: pageData.company_name,
            contact_name: pageData.contact_name,
            job_title: pageData.job_title,
            email: e.email,
            email_type: e.type,
            source_url: pageData.source_url,
            source_domain: pageData.source_domain,
            verification_status: "unverified",
            reviewed: false,
            notes: `Extracted via crawler from ${pageData.source_domain}`
          }));

          const res = await saveContactsToApi(contactsToSave);
          crawlState.contactsCollected += (res.inserted || 0) + (res.updated || 0);
          saveState();
        }

        // Add newly found same-origin links to queue
        if (pageData.same_origin_links && Array.isArray(pageData.same_origin_links)) {
          for (const link of pageData.same_origin_links) {
            if (!crawlState.visited.includes(link) && !crawlState.queue.includes(link)) {
              crawlState.queue.push(link);
            }
          }
          saveState();
        }
      }
    } catch (err) {
      console.error(`Error crawling ${nextUrl}:`, err);
      crawlState.error = err.message;
      saveState();
    }
  }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_CRAWL") {
    const { tabId, origin, seedUrl, initialLinks, maxPages, delayMs } = request;
    crawlState = {
      status: "running",
      tabId: tabId,
      origin: origin,
      queue: initialLinks ? [...initialLinks] : [],
      visited: seedUrl ? [seedUrl] : [],
      maxPages: Number(maxPages) || 5,
      delayMs: Number(delayMs) || 2000,
      pagesVisited: seedUrl ? 1 : 0,
      contactsCollected: 0,
      currentUrl: seedUrl || "",
      error: null
    };
    saveState();
    runCrawlLoop();
    sendResponse({ ok: true, state: crawlState });
    return true;
  }

  if (request.action === "PAUSE_CRAWL") {
    crawlState.status = "paused";
    saveState();
    sendResponse({ ok: true, state: crawlState });
    return true;
  }

  if (request.action === "RESUME_CRAWL") {
    if (crawlState.status === "paused") {
      crawlState.status = "running";
      saveState();
      runCrawlLoop();
    }
    sendResponse({ ok: true, state: crawlState });
    return true;
  }

  if (request.action === "STOP_CRAWL") {
    crawlState.status = "stopped";
    saveState();
    sendResponse({ ok: true, state: crawlState });
    return true;
  }

  if (request.action === "GET_CRAWL_STATE") {
    sendResponse({ ok: true, state: crawlState });
    return true;
  }

  if (request.action === "SAVE_SINGLE_CONTACT") {
    saveContactsToApi([request.contact])
      .then(res => sendResponse({ ok: true, result: res }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (request.action === "SAVE_BATCH_CONTACTS") {
    saveContactsToApi(request.contacts)
      .then(res => sendResponse({ ok: true, result: res }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return true;
});
