/**
 * HR Contact Collection Agent - Popup Script
 * Handles current tab analysis, extraction preview, saving, and crawl controls.
 */

const API_BASE_URL = "http://127.0.0.1:8000";

let currentTab = null;
let currentAnalysis = null;

// DOM Elements
const apiStatusBadge = document.getElementById("apiStatusBadge");
const apiStatusText = document.getElementById("apiStatusText");
const currentDomainEl = document.getElementById("currentDomain");
const currentUrlEl = document.getElementById("currentUrl");
const complianceNotice = document.getElementById("complianceNotice");
const complianceText = document.getElementById("complianceText");

const tabBtnAnalyze = document.getElementById("tabBtnAnalyze");
const tabBtnCrawler = document.getElementById("tabBtnCrawler");
const viewAnalyze = document.getElementById("viewAnalyze");
const viewCrawler = document.getElementById("viewCrawler");

const btnAnalyze = document.getElementById("btnAnalyze");
const analyzeLoading = document.getElementById("analyzeLoading");
const previewCard = document.getElementById("previewCard");
const previewJobTitle = document.getElementById("previewJobTitle");
const previewCompanyName = document.getElementById("previewCompanyName");
const previewContactName = document.getElementById("previewContactName");
const emailsList = document.getElementById("emailsList");
const emailCountBadge = document.getElementById("emailCountBadge");
const previewLinksCount = document.getElementById("previewLinksCount");
const btnSavePreview = document.getElementById("btnSavePreview");

const crawlMaxPages = document.getElementById("crawlMaxPages");
const crawlDelay = document.getElementById("crawlDelay");
const crawlStatusBadge = document.getElementById("crawlStatusBadge");
const crawlProgressBar = document.getElementById("crawlProgressBar");
const statPagesVisited = document.getElementById("statPagesVisited");
const statContactsFound = document.getElementById("statContactsFound");
const statQueueCount = document.getElementById("statQueueCount");
const crawlerCurrentUrl = document.getElementById("crawlerCurrentUrl");

const btnStartCrawl = document.getElementById("btnStartCrawl");
const btnPauseCrawl = document.getElementById("btnPauseCrawl");
const btnResumeCrawl = document.getElementById("btnResumeCrawl");
const btnStopCrawl = document.getElementById("btnStopCrawl");
const toast = document.getElementById("toast");

// Initialize Popup
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupEventListeners();
  await checkApiHealth();
  await initActiveTab();
  await syncCrawlerState();
});

function setupTabs() {
  tabBtnAnalyze.addEventListener("click", () => {
    tabBtnAnalyze.classList.add("active");
    tabBtnCrawler.classList.remove("active");
    viewAnalyze.classList.add("active");
    viewCrawler.classList.remove("active");
  });

  tabBtnCrawler.addEventListener("click", () => {
    tabBtnCrawler.classList.add("active");
    tabBtnAnalyze.classList.remove("active");
    viewCrawler.classList.add("active");
    viewAnalyze.classList.remove("active");
  });
}

function showToast(message, duration = 3000) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => {
    toast.classList.add("hidden");
  }, duration);
}

/**
 * Check backend API health endpoint
 */
async function checkApiHealth() {
  apiStatusBadge.className = "status-badge status-checking";
  apiStatusText.textContent = "Checking API...";

  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === "ok") {
        apiStatusBadge.className = "status-badge status-online";
        apiStatusText.textContent = "API Online";
        return;
      }
    }
    throw new Error("Invalid health response");
  } catch (e) {
    apiStatusBadge.className = "status-badge status-offline";
    apiStatusText.textContent = "API Offline (Start FastAPI)";
  }
}

/**
 * Detect active browser tab
 */
async function initActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      currentTab = tabs[0];
      const url = new URL(currentTab.url);
      currentDomainEl.textContent = url.hostname.replace(/^www\./, "");
      currentUrlEl.textContent = currentTab.url;

      // Check compliance warning for LinkedIn
      if (url.hostname.includes("linkedin.com")) {
        complianceNotice.classList.remove("hidden");
        complianceText.textContent = "LinkedIn automated collection is intentionally disabled per compliance requirements.";
        btnAnalyze.disabled = true;
        btnStartCrawl.disabled = true;
      } else {
        complianceNotice.classList.add("hidden");
        btnAnalyze.disabled = false;
        btnStartCrawl.disabled = false;
      }
    }
  } catch (e) {
    currentDomainEl.textContent = "Unavailable";
    currentUrlEl.textContent = "Could not inspect active tab.";
  }
}

/**
 * Event Listeners
 */
function setupEventListeners() {
  btnAnalyze.addEventListener("click", analyzePage);
  btnSavePreview.addEventListener("click", savePreview);

  btnStartCrawl.addEventListener("click", startCrawl);
  btnPauseCrawl.addEventListener("click", pauseCrawl);
  btnResumeCrawl.addEventListener("click", resumeCrawl);
  btnStopCrawl.addEventListener("click", stopCrawl);

  // Listen for progress updates from background script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "CRAWL_PROGRESS" && msg.state) {
      updateCrawlerUi(msg.state);
    }
  });
}

/**
 * Inject content script and extract current page info
 */
async function analyzePage() {
  if (!currentTab || !currentTab.id) return;

  btnAnalyze.disabled = true;
  analyzeLoading.classList.remove("hidden");
  previewCard.classList.add("hidden");

  try {
    // Inject content.js dynamically
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ["content.js"]
    });

    // Request analysis
    const response = await chrome.tabs.sendMessage(currentTab.id, { action: "ANALYZE_PAGE" });

    analyzeLoading.classList.add("hidden");
    btnAnalyze.disabled = false;

    if (!response || !response.success) {
      if (response && response.blocked) {
        showToast(response.message || "Page collection restricted.");
      } else {
        showToast("No data extracted. Ensure you are on a permitted job page.");
      }
      return;
    }

    currentAnalysis = response.data;
    renderPreview(currentAnalysis);
  } catch (err) {
    analyzeLoading.classList.add("hidden");
    btnAnalyze.disabled = false;
    showToast(`Extraction error: ${err.message}`);
  }
}

/**
 * Render the extracted fields in the preview card
 */
function renderPreview(data) {
  previewJobTitle.value = data.job_title || "";
  previewCompanyName.value = data.company_name || "";
  previewContactName.value = data.contact_name || "";

  emailsList.innerHTML = "";
  const emails = data.emails || [];
  emailCountBadge.textContent = `${emails.length} email${emails.length === 1 ? "" : "s"}`;

  if (emails.length === 0) {
    emailsList.innerHTML = '<div class="empty-state">No published emails found on this page.</div>';
    btnSavePreview.disabled = true;
  } else {
    emails.forEach(item => {
      const row = document.createElement("div");
      row.className = "email-pill-row";

      const text = document.createElement("span");
      text.className = "email-text";
      text.textContent = item.email;
      text.title = item.email;

      const badge = document.createElement("span");
      badge.className = item.type === "generic" ? "pill-generic" : "pill-person";
      badge.textContent = item.type === "generic" ? "Generic Inbox" : "Person / Specific";

      row.appendChild(text);
      row.appendChild(badge);
      emailsList.appendChild(row);
    });
    btnSavePreview.disabled = false;
  }

  const linksCount = (data.same_origin_links && data.same_origin_links.length) || 0;
  previewLinksCount.textContent = `${linksCount} relevant same-origin link${linksCount === 1 ? "" : "s"}`;

  previewCard.classList.remove("hidden");
}

/**
 * Save previewed contact(s) to FastAPI backend
 */
async function savePreview() {
  if (!currentAnalysis || !currentAnalysis.emails || currentAnalysis.emails.length === 0) {
    return;
  }

  btnSavePreview.disabled = true;
  btnSavePreview.textContent = "Saving...";

  const contactsToSave = currentAnalysis.emails.map(item => ({
    company_name: previewCompanyName.value.trim() || currentAnalysis.company_name,
    contact_name: previewContactName.value.trim() || currentAnalysis.contact_name,
    job_title: previewJobTitle.value.trim() || currentAnalysis.job_title,
    email: item.email,
    email_type: item.type,
    source_url: currentAnalysis.source_url,
    source_domain: currentAnalysis.source_domain,
    verification_status: "unverified",
    reviewed: false,
    notes: "Saved via manual preview"
  }));

  try {
    const res = await fetch(`${API_BASE_URL}/api/contacts/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacts: contactsToSave })
    });

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    const result = await res.json();
    btnSavePreview.textContent = "✓ Saved!";
    showToast(`Successfully saved ${result.inserted + result.updated} record(s)!`);
    setTimeout(() => {
      btnSavePreview.disabled = false;
      btnSavePreview.textContent = "💾 Save to Database";
    }, 2000);
  } catch (err) {
    btnSavePreview.disabled = false;
    btnSavePreview.textContent = "💾 Save to Database";
    showToast(`Failed to save: ${err.message}`);
  }
}

/**
 * Bounded Crawler Controls
 */
async function syncCrawlerState() {
  chrome.runtime.sendMessage({ action: "GET_CRAWL_STATE" }, (res) => {
    if (res && res.state) {
      updateCrawlerUi(res.state);
    }
  });
}

function updateCrawlerUi(state) {
  // Update badge
  crawlStatusBadge.className = `status-pill pill-${state.status}`;
  crawlStatusBadge.textContent = state.status;

  // Stats
  statPagesVisited.textContent = `${state.pagesVisited} / ${state.maxPages}`;
  statContactsFound.textContent = state.contactsCollected;
  statQueueCount.textContent = state.queue.length;

  const pct = Math.min(100, Math.round((state.pagesVisited / (state.maxPages || 1)) * 100));
  crawlProgressBar.style.width = `${pct}%`;

  crawlerCurrentUrl.textContent = state.currentUrl ? state.currentUrl : "Waiting to start...";

  // Button States
  if (state.status === "running") {
    btnStartCrawl.disabled = true;
    btnPauseCrawl.disabled = false;
    btnResumeCrawl.disabled = true;
    btnStopCrawl.disabled = false;
  } else if (state.status === "paused") {
    btnStartCrawl.disabled = true;
    btnPauseCrawl.disabled = true;
    btnResumeCrawl.disabled = false;
    btnStopCrawl.disabled = false;
  } else {
    // idle, stopped, completed
    btnStartCrawl.disabled = false;
    btnPauseCrawl.disabled = true;
    btnResumeCrawl.disabled = true;
    btnStopCrawl.disabled = true;
  }
}

async function startCrawl() {
  if (!currentTab || !currentTab.id) return;

  const maxPages = parseInt(crawlMaxPages.value, 10) || 5;
  const delayMs = parseInt(crawlDelay.value, 10) || 2000;
  const urlObj = new URL(currentTab.url);

  // If we haven't analyzed yet, grab initial links from current page
  let initialLinks = [];
  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ["content.js"]
    });
    const res = await chrome.tabs.sendMessage(currentTab.id, { action: "ANALYZE_PAGE" });
    if (res && res.data && res.data.same_origin_links) {
      initialLinks = res.data.same_origin_links;
    }
  } catch (e) {
    // Ignore, will start from seed URL
  }

  chrome.runtime.sendMessage({
    action: "START_CRAWL",
    tabId: currentTab.id,
    origin: urlObj.origin,
    seedUrl: currentTab.url,
    initialLinks: initialLinks,
    maxPages: maxPages,
    delayMs: delayMs
  }, (res) => {
    if (res && res.state) {
      updateCrawlerUi(res.state);
      showToast("Crawl started in active tab!");
    }
  });
}

function pauseCrawl() {
  chrome.runtime.sendMessage({ action: "PAUSE_CRAWL" }, (res) => {
    if (res && res.state) {
      updateCrawlerUi(res.state);
      showToast("Crawl paused.");
    }
  });
}

function resumeCrawl() {
  chrome.runtime.sendMessage({ action: "RESUME_CRAWL" }, (res) => {
    if (res && res.state) {
      updateCrawlerUi(res.state);
      showToast("Crawl resumed.");
    }
  });
}

function stopCrawl() {
  chrome.runtime.sendMessage({ action: "STOP_CRAWL" }, (res) => {
    if (res && res.state) {
      updateCrawlerUi(res.state);
      showToast("Crawl stopped.");
    }
  });
}
