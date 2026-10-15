/**
 * HR Contact Collection Agent - Popup Script
 * Handles current tab analysis, extraction preview, saving, and crawl controls.
 */

const API_BASE_URL = "http://127.0.0.1:8000";

let currentTab = null;
let currentAnalysis = null;
let inpagePollInterval = null;

// DOM Elements
const apiStatusBadge = document.getElementById("apiStatusBadge");
const apiStatusText = document.getElementById("apiStatusText");
const currentDomainEl = document.getElementById("currentDomain");
const currentUrlEl = document.getElementById("currentUrl");
const complianceNotice = document.getElementById("complianceNotice");
const complianceText = document.getElementById("complianceText");

// Navigation Tabs
const tabBtnInPage = document.getElementById("tabBtnInPage");
const tabBtnAnalyze = document.getElementById("tabBtnAnalyze");
const tabBtnCrawler = document.getElementById("tabBtnCrawler");
const viewInPage = document.getElementById("viewInPage");
const viewAnalyze = document.getElementById("viewAnalyze");
const viewCrawler = document.getElementById("viewCrawler");

// In-Page Scanner Elements
const inpageMaxJobs = document.getElementById("inpageMaxJobs");
const inpageDelay = document.getElementById("inpageDelay");
const inpageStatusBadge = document.getElementById("inpageStatusBadge");
const inpageProgressBar = document.getElementById("inpageProgressBar");
const inpageStatInspected = document.getElementById("inpageStatInspected");
const inpageStatSaved = document.getElementById("inpageStatSaved");
const inpageStatRemaining = document.getElementById("inpageStatRemaining");
const inpageStatusMsg = document.getElementById("inpageStatusMsg");
const btnStartInPage = document.getElementById("btnStartInPage");
const btnPauseInPage = document.getElementById("btnPauseInPage");
const btnResumeInPage = document.getElementById("btnResumeInPage");
const btnStopInPage = document.getElementById("btnStopInPage");

// Single Job Elements
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

// Multi-Page Crawler Elements
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
  await checkInPageScanStatus();
});

function setupTabs() {
  function activateTab(btn, view) {
    [tabBtnInPage, tabBtnAnalyze, tabBtnCrawler].forEach(b => b.classList.remove("active"));
    [viewInPage, viewAnalyze, viewCrawler].forEach(v => v.classList.remove("active"));
    btn.classList.add("active");
    view.classList.add("active");
  }

  tabBtnInPage.addEventListener("click", () => activateTab(tabBtnInPage, viewInPage));
  tabBtnAnalyze.addEventListener("click", () => activateTab(tabBtnAnalyze, viewAnalyze));
  tabBtnCrawler.addEventListener("click", () => activateTab(tabBtnCrawler, viewCrawler));
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

      // Keep compliance notice hidden and allow scanning across all job portals
      complianceNotice.classList.add("hidden");
      btnAnalyze.disabled = false;
      btnStartCrawl.disabled = false;
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
  // In-Page Scanner Controls
  btnStartInPage.addEventListener("click", startInPageScan);
  btnPauseInPage.addEventListener("click", pauseInPageScan);
  btnResumeInPage.addEventListener("click", resumeInPageScan);
  btnStopInPage.addEventListener("click", stopInPageScan);

  // Single Page Analysis
  btnAnalyze.addEventListener("click", analyzePage);
  btnSavePreview.addEventListener("click", savePreview);

  // Multi-Page Crawler
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
      if (item.type === "direct_apply") {
        badge.className = "pill-person";
        badge.style = "background: #dcfce7; color: #15803d; font-weight: 700;";
        badge.textContent = "⚡ Direct Apply Email";
      } else if (item.type === "generic") {
        badge.className = "pill-generic";
        badge.textContent = "Generic Inbox";
      } else {
        badge.className = "pill-person";
        badge.textContent = "Person / Specific";
      }

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
    notes: currentAnalysis.job_requirements ? `Direct apply email from requirements: ${currentAnalysis.job_requirements.slice(0, 100)}...` : "Saved via manual preview"
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

  // Grab exact job cards from current page
  let initialLinks = [];
  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ["content.js"]
    });

    // 1. First prioritize directly detected job cards on this listing page
    const cardsRes = await chrome.tabs.sendMessage(currentTab.id, { action: "DETECT_JOB_CARDS" });
    if (cardsRes && cardsRes.cards && cardsRes.cards.length > 0) {
      initialLinks = cardsRes.cards;
    } else {
      // 2. Fallback to same-origin job links from page analysis
      const res = await chrome.tabs.sendMessage(currentTab.id, { action: "ANALYZE_PAGE" });
      if (res && res.data && res.data.same_origin_links) {
        initialLinks = res.data.same_origin_links;
      }
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
      showToast(`Job Walker started with ${initialLinks.length} target job post(s)!`);
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

/**
 * =========================================================================
 * In-Page Job Scanner (Zero Page Reload - "Don't Change the Pages")
 * =========================================================================
 */
async function checkInPageScanStatus() {
  if (!currentTab || !currentTab.id) return;
  try {
    const res = await chrome.tabs.sendMessage(currentTab.id, { action: "GET_INPAGE_STATUS" });
    if (res && res.state) {
      updateInPageUi(res.state);
      if (res.state.status === "running") {
        startInPagePolling();
      }
    }
  } catch (e) {}
}

function startInPagePolling() {
  if (inpagePollInterval) clearInterval(inpagePollInterval);
  inpagePollInterval = setInterval(async () => {
    if (!currentTab || !currentTab.id) return;
    try {
      const res = await chrome.tabs.sendMessage(currentTab.id, { action: "GET_INPAGE_STATUS" });
      if (res && res.state) {
        updateInPageUi(res.state);
        if (res.state.status !== "running" && res.state.status !== "paused") {
          clearInterval(inpagePollInterval);
          inpagePollInterval = null;
        }
      }
    } catch (e) {
      clearInterval(inpagePollInterval);
      inpagePollInterval = null;
    }
  }, 500);
}

function updateInPageUi(state) {
  inpageStatusBadge.className = `status-pill pill-${state.status}`;
  inpageStatusBadge.textContent = state.status;

  inpageStatInspected.textContent = state.currentIndex || 0;
  inpageStatSaved.textContent = state.savedCount || 0;
  inpageStatRemaining.textContent = Math.max(0, (state.totalJobs || 0) - (state.currentIndex || 0));

  const total = state.totalJobs || 1;
  const pct = Math.min(100, Math.round(((state.currentIndex || 0) / total) * 100));
  inpageProgressBar.style.width = `${pct}%`;

  if (state.status === "running") {
    inpageStatusMsg.textContent = `Inspecting job ${state.currentIndex} of ${state.totalJobs}... (No page reload)`;
    btnStartInPage.disabled = true;
    btnPauseInPage.disabled = false;
    btnResumeInPage.disabled = true;
    btnStopInPage.disabled = false;
  } else if (state.status === "paused") {
    inpageStatusMsg.textContent = "Inspection paused. Click Resume to continue.";
    btnStartInPage.disabled = true;
    btnPauseInPage.disabled = true;
    btnResumeInPage.disabled = false;
    btnStopInPage.disabled = false;
  } else if (state.status === "completed") {
    inpageStatusMsg.textContent = `Done! Inspected ${state.totalJobs} jobs, saved ${state.savedCount} HR contacts.`;
    btnStartInPage.disabled = false;
    btnPauseInPage.disabled = true;
    btnResumeInPage.disabled = true;
    btnStopInPage.disabled = true;
  } else {
    // idle or stopped
    inpageStatusMsg.textContent = state.status === "stopped" ? "Inspection stopped." : "Ready to inspect jobs on this page.";
    btnStartInPage.disabled = false;
    btnPauseInPage.disabled = true;
    btnResumeInPage.disabled = true;
    btnStopInPage.disabled = true;
  }
}

async function startInPageScan() {
  if (!currentTab || !currentTab.id) return;

  btnStartInPage.disabled = true;
  showToast("Starting in-page inspection without changing pages...");

  // Ensure content.js is injected
  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ["content.js"]
    });
  } catch (e) {}

  const maxJobs = parseInt(inpageMaxJobs.value, 10) || 25;
  const delayMs = parseInt(inpageDelay.value, 10) || 1200;

  try {
    chrome.tabs.sendMessage(currentTab.id, {
      action: "START_INPAGE_SCAN",
      options: { maxJobs, delayMs }
    });
    startInPagePolling();
  } catch (err) {
    showToast(`Error: ${err.message}`);
    btnStartInPage.disabled = false;
  }
}

function pauseInPageScan() {
  if (!currentTab || !currentTab.id) return;
  chrome.tabs.sendMessage(currentTab.id, { action: "PAUSE_INPAGE_SCAN" });
  btnPauseInPage.disabled = true;
  btnResumeInPage.disabled = false;
}

function resumeInPageScan() {
  if (!currentTab || !currentTab.id) return;
  chrome.tabs.sendMessage(currentTab.id, { action: "RESUME_INPAGE_SCAN" });
  btnPauseInPage.disabled = false;
  btnResumeInPage.disabled = true;
  startInPagePolling();
}

function stopInPageScan() {
  if (!currentTab || !currentTab.id) return;
  chrome.tabs.sendMessage(currentTab.id, { action: "STOP_INPAGE_SCAN" });
  if (inpagePollInterval) {
    clearInterval(inpagePollInterval);
    inpagePollInterval = null;
  }
  showToast("In-page scan stopped.");
}
