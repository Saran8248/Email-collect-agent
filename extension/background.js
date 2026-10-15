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
 * Wait for a tab to finish loading (with safety timeout)
 */
function waitForTabLoad(tabId, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        if (timer) clearTimeout(timer);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);
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
 * Main job-walker processor
 * Steps through detected job posts one by one:
 * "enter the job post, take the email, save it, then move to the next job post, then return to search"
 */
async function runCrawlLoop() {
  while (crawlState.status === "running") {
    // Check if reached max pages or queue is empty
    if (crawlState.pagesVisited >= crawlState.maxPages || crawlState.queue.length === 0) {
      crawlState.status = "completed";
      // Return back to the original search listing page
      if (crawlState.seedUrl && crawlState.tabId) {
        try {
          await chrome.tabs.update(crawlState.tabId, { url: crawlState.seedUrl });
          await waitForTabLoad(crawlState.tabId);
        } catch (e) {}
      }
      saveState();
      break;
    }

    // Pick next job post
    const nextJob = crawlState.queue.shift();
    const nextUrl = typeof nextJob === "object" ? nextJob.url : nextJob;
    const titleHint = typeof nextJob === "object" ? nextJob.title : "Job Role";
    const companyHint = typeof nextJob === "object" ? nextJob.company : null;

    if (!nextUrl || crawlState.visited.includes(nextUrl)) {
      continue;
    }

    crawlState.visited.push(nextUrl);
    crawlState.currentUrl = nextUrl;
    crawlState.pagesVisited++;
    saveState();

    try {
      // 1. Enter the job post
      await chrome.tabs.update(crawlState.tabId, { url: nextUrl });
      await waitForTabLoad(crawlState.tabId);

      // Wait configured delay for full rendering
      await delay(crawlState.delayMs);

      if (crawlState.status !== "running") {
        break;
      }

      // 2. Extract job details & direct apply email inside this job post
      const analysis = await extractFromTab(crawlState.tabId);
      if (analysis && analysis.success && analysis.data) {
        const pageData = analysis.data;

        // If emails were found in requirements / application section
        if (pageData.emails && pageData.emails.length > 0) {
          const contactsToSave = pageData.emails.map(firstEmail => ({
            company_name: pageData.company_name || companyHint,
            contact_name: pageData.contact_name,
            job_title: pageData.job_title || titleHint,
            email: firstEmail.email,
            email_type: firstEmail.type || "direct_apply",
            source_url: pageData.source_url || nextUrl,
            source_domain: pageData.source_domain,
            verification_status: "unverified",
            reviewed: false,
            notes: pageData.job_requirements
              ? `Direct apply email in requirements: ${pageData.job_requirements.slice(0, 100)}...`
              : `Extracted via Job-Walker from ${pageData.source_domain}`
          }));

          const res = await saveContactsToApi(contactsToSave);
          // ONLY increment for genuinely new unique contacts inserted into the database!
          if (res && res.inserted > 0) {
            crawlState.contactsCollected += res.inserted;
            saveState();
          }
        }
      }

      // Small pause before advancing to next job post
      await delay(600);
    } catch (err) {
      console.error(`Error walking job ${nextUrl}:`, err);
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
      seedUrl: seedUrl || "",
      queue: initialLinks ? [...initialLinks] : [],
      visited: seedUrl ? [seedUrl] : [],
      maxPages: Number(maxPages) || 15,
      delayMs: Number(delayMs) || 2000,
      pagesVisited: 0,
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
