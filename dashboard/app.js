/**
 * HR Contact Collection Agent - Dashboard Client App
 * Handles loading records, searching/filtering, editing, reviewing, deleting,
 * metric cards, pagination, and backend sync.
 */

const API_BASE = "http://127.0.0.1:8000";

let currentPage = 1;
let pageSize = 25;
let totalContacts = 0;
let searchDebounceTimer = null;
let editingContactId = null;

// DOM Elements
const apiStatusBadge = document.getElementById("apiStatusBadge");
const apiStatusText = document.getElementById("apiStatusText");

const statTotal = document.getElementById("statTotal");
const statVerified = document.getElementById("statVerified");
const statUnverified = document.getElementById("statUnverified");
const statGeneric = document.getElementById("statGeneric");
const statPerson = document.getElementById("statPerson");
const statReviewed = document.getElementById("statReviewed");
const statDomains = document.getElementById("statDomains");

const searchInput = document.getElementById("searchInput");
const filterStatus = document.getElementById("filterStatus");
const filterType = document.getElementById("filterType");
const filterReviewed = document.getElementById("filterReviewed");
const filterDomain = document.getElementById("filterDomain");
const sortBy = document.getElementById("sortBy");
const btnResetFilters = document.getElementById("btnResetFilters");

const contactsTableBody = document.getElementById("contactsTableBody");
const tableSummary = document.getElementById("tableSummary");
const pageSizeSelect = document.getElementById("pageSizeSelect");
const btnPrevPage = document.getElementById("btnPrevPage");
const btnNextPage = document.getElementById("btnNextPage");
const pageIndicator = document.getElementById("pageIndicator");

const btnRefresh = document.getElementById("btnRefresh");
const btnNewContact = document.getElementById("btnNewContact");

// Modal Elements
const contactModal = document.getElementById("contactModal");
const modalTitle = document.getElementById("modalTitle");
const btnCloseModal = document.getElementById("btnCloseModal");
const btnCancelModal = document.getElementById("btnCancelModal");
const contactForm = document.getElementById("contactForm");
const modalContactId = document.getElementById("modalContactId");
const modalEmail = document.getElementById("modalEmail");
const modalCompany = document.getElementById("modalCompany");
const modalContactPerson = document.getElementById("modalContactPerson");
const modalJobTitle = document.getElementById("modalJobTitle");
const modalSourceDomain = document.getElementById("modalSourceDomain");
const modalSourceUrl = document.getElementById("modalSourceUrl");
const modalStatus = document.getElementById("modalStatus");
const modalEmailType = document.getElementById("modalEmailType");
const modalReviewed = document.getElementById("modalReviewed");
const modalNotes = document.getElementById("modalNotes");

const toast = document.getElementById("toast");

// Initialize Dashboard
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  checkApiHealth();
  loadStats();
  loadDomains();
  loadContacts();
});

function setupEventListeners() {
  btnRefresh.addEventListener("click", () => {
    loadStats();
    loadDomains();
    loadContacts();
    showToast("Dashboard refreshed");
  });

  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      currentPage = 1;
      loadContacts();
    }, 300);
  });

  filterStatus.addEventListener("change", () => { currentPage = 1; loadContacts(); });
  filterType.addEventListener("change", () => { currentPage = 1; loadContacts(); });
  filterReviewed.addEventListener("change", () => { currentPage = 1; loadContacts(); });
  filterDomain.addEventListener("change", () => { currentPage = 1; loadContacts(); });
  sortBy.addEventListener("change", () => { currentPage = 1; loadContacts(); });

  btnResetFilters.addEventListener("click", () => {
    searchInput.value = "";
    filterStatus.value = "";
    filterType.value = "";
    filterReviewed.value = "";
    filterDomain.value = "";
    sortBy.value = "created_at-desc";
    currentPage = 1;
    loadContacts();
  });

  pageSizeSelect.addEventListener("change", (e) => {
    pageSize = parseInt(e.target.value, 10);
    currentPage = 1;
    loadContacts();
  });

  btnPrevPage.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      loadContacts();
    }
  });

  btnNextPage.addEventListener("click", () => {
    const totalPages = Math.ceil(totalContacts / pageSize) || 1;
    if (currentPage < totalPages) {
      currentPage++;
      loadContacts();
    }
  });

  // Modal Handlers
  btnNewContact.addEventListener("click", openNewContactModal);
  btnCloseModal.addEventListener("click", closeModal);
  btnCancelModal.addEventListener("click", closeModal);
  contactForm.addEventListener("submit", handleContactFormSubmit);
}

function showToast(message, duration = 3000) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => {
    toast.classList.add("hidden");
  }, duration);
}

/**
 * Health check
 */
async function checkApiHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === "ok") {
        apiStatusBadge.className = "status-indicator status-online";
        apiStatusText.textContent = "API Connected";
        return;
      }
    }
    throw new Error("Invalid response");
  } catch (e) {
    apiStatusBadge.className = "status-indicator status-offline";
    apiStatusText.textContent = "API Offline (Start FastAPI)";
  }
}

/**
 * Load statistics for top cards
 */
async function loadStats() {
  try {
    const res = await fetch(`${API_BASE}/api/stats`);
    if (!res.ok) return;
    const data = await res.json();

    statTotal.textContent = data.total_contacts.toLocaleString();
    statVerified.textContent = data.verified_contacts.toLocaleString();
    statUnverified.textContent = data.unverified_contacts.toLocaleString();
    statGeneric.textContent = data.generic_inboxes.toLocaleString();
    statPerson.textContent = data.person_inboxes.toLocaleString();
    statReviewed.textContent = data.reviewed_count.toLocaleString();
    statDomains.textContent = data.unique_domains.toLocaleString();
  } catch (err) {
    console.error("Failed to load stats:", err);
  }
}

/**
 * Load distinct domains for dropdown filter
 */
async function loadDomains() {
  try {
    const res = await fetch(`${API_BASE}/api/domains`);
    if (!res.ok) return;
    const domains = await res.json();

    const currentSelected = filterDomain.value;
    filterDomain.innerHTML = '<option value="">All Domains</option>';
    domains.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      filterDomain.appendChild(opt);
    });
    filterDomain.value = currentSelected;
  } catch (err) {
    console.error("Failed to load domains:", err);
  }
}

/**
 * Load and render contacts with active filters and pagination
 */
async function loadContacts() {
  contactsTableBody.innerHTML = `
    <tr>
      <td colspan="10" class="table-loading">
        <div class="spinner"></div> Loading contacts...
      </td>
    </tr>
  `;

  const params = new URLSearchParams();
  if (searchInput.value.trim()) params.append("q", searchInput.value.trim());
  if (filterStatus.value) params.append("verification_status", filterStatus.value);
  if (filterType.value) params.append("email_type", filterType.value);
  if (filterReviewed.value !== "") params.append("reviewed", filterReviewed.value);
  if (filterDomain.value) params.append("source_domain", filterDomain.value);

  const [sortField, sortOrder] = sortBy.value.split("-");
  params.append("sort_by", sortField);
  params.append("sort_order", sortOrder);

  const offset = (currentPage - 1) * pageSize;
  params.append("limit", pageSize);
  params.append("offset", offset);

  try {
    const res = await fetch(`${API_BASE}/api/contacts?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Error ${res.status}`);
    }

    const data = await res.json();
    totalContacts = data.total;
    renderTable(data.items);
    updatePagination();
  } catch (err) {
    contactsTableBody.innerHTML = `
      <tr>
        <td colspan="10" class="table-empty" style="color: var(--danger);">
          Failed to load contacts. Ensure the FastAPI backend is running on http://127.0.0.1:8000.
        </td>
      </tr>
    `;
    tableSummary.textContent = "Showing 0 contacts";
  }
}

/**
 * Render contact rows
 */
function renderTable(contacts) {
  if (!contacts || contacts.length === 0) {
    contactsTableBody.innerHTML = `
      <tr>
        <td colspan="10" class="table-empty">
          No contacts found matching the selected criteria.
        </td>
      </tr>
    `;
    tableSummary.textContent = "Showing 0 contacts";
    return;
  }

  const startIdx = (currentPage - 1) * pageSize + 1;
  const endIdx = Math.min(currentPage * pageSize, totalContacts);
  tableSummary.textContent = `Showing ${startIdx}-${endIdx} of ${totalContacts} contacts`;

  contactsTableBody.innerHTML = "";

  contacts.forEach(c => {
    const tr = document.createElement("tr");

    // 1. Audit Checkbox
    const tdAudit = document.createElement("td");
    tdAudit.className = "checkbox-cell";
    const chkReviewed = document.createElement("input");
    chkReviewed.type = "checkbox";
    chkReviewed.className = "custom-checkbox";
    chkReviewed.checked = !!c.reviewed;
    chkReviewed.title = c.reviewed ? "Reviewed (click to toggle)" : "Needs Review (click to toggle)";
    chkReviewed.addEventListener("change", async () => {
      await updateContactField(c.id, { reviewed: chkReviewed.checked });
      loadStats();
    });
    tdAudit.appendChild(chkReviewed);
    tr.appendChild(tdAudit);

    // 2. Company Name
    const tdCompany = document.createElement("td");
    tdCompany.textContent = c.company_name || "—";
    tdCompany.style.fontWeight = "600";
    tr.appendChild(tdCompany);

    // 3. Contact Person
    const tdContact = document.createElement("td");
    tdContact.textContent = c.contact_name || "—";
    tr.appendChild(tdContact);

    // 4. Job Title
    const tdTitle = document.createElement("td");
    tdTitle.textContent = c.job_title || "—";
    tr.appendChild(tdTitle);

    // 5. Email Address with Copy Button
    const tdEmail = document.createElement("td");
    tdEmail.innerHTML = `
      <div class="email-cell">
        <span class="email-address">${escapeHtml(c.email)}</span>
        <button class="btn-copy" title="Copy email address" onclick="copyToClipboard('${escapeHtml(c.email)}')">📋</button>
      </div>
    `;
    tr.appendChild(tdEmail);

    // 6. Email Type
    const tdType = document.createElement("td");
    const isGeneric = c.email_type === "generic";
    tdType.innerHTML = `
      <span class="pill-badge ${isGeneric ? 'pill-type-generic' : 'pill-type-person'}">
        ${isGeneric ? 'Generic Inbox' : 'Person / Specific'}
      </span>
    `;
    tr.appendChild(tdType);

    // 7. Verification Status Select
    const tdStatus = document.createElement("td");
    const selectStatus = document.createElement("select");
    selectStatus.className = `status-select ${c.verification_status || 'unverified'}`;
    selectStatus.innerHTML = `
      <option value="unverified" ${c.verification_status === 'unverified' ? 'selected' : ''}>Unverified</option>
      <option value="verified" ${c.verification_status === 'verified' ? 'selected' : ''}>Verified</option>
      <option value="invalid" ${c.verification_status === 'invalid' ? 'selected' : ''}>Invalid</option>
      <option value="not_found" ${c.verification_status === 'not_found' ? 'selected' : ''}>Not Found</option>
    `;
    selectStatus.addEventListener("change", async () => {
      selectStatus.className = `status-select ${selectStatus.value}`;
      await updateContactField(c.id, { verification_status: selectStatus.value });
      loadStats();
    });
    tdStatus.appendChild(selectStatus);
    tr.appendChild(tdStatus);

    // 8. Source Domain
    const tdDomain = document.createElement("td");
    tdDomain.innerHTML = `
      <div class="domain-cell">
        <a href="${escapeHtml(c.source_url)}" target="_blank" rel="noopener noreferrer" class="domain-pill" title="View Source Job Page">
          ${escapeHtml(c.source_domain || 'link')} ↗
        </a>
      </div>
    `;
    tr.appendChild(tdDomain);

    // 9. Notes
    const tdNotes = document.createElement("td");
    tdNotes.className = "notes-cell";
    tdNotes.textContent = c.notes || "—";
    tdNotes.title = c.notes || "";
    tr.appendChild(tdNotes);

    // 10. Actions
    const tdActions = document.createElement("td");
    tdActions.style.textAlign = "right";
    tdActions.innerHTML = `
      <div class="action-buttons">
        <button class="btn-icon-action" title="Edit Contact" onclick="openEditContactModal(${c.id})">✏️</button>
        <button class="btn-icon-action delete" title="Delete Contact" onclick="deleteContact(${c.id})">🗑️</button>
      </div>
    `;
    tr.appendChild(tdActions);

    contactsTableBody.appendChild(tr);
  });
}

/**
 * Update pagination UI
 */
function updatePagination() {
  const totalPages = Math.ceil(totalContacts / pageSize) || 1;
  pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
  btnPrevPage.disabled = currentPage <= 1;
  btnNextPage.disabled = currentPage >= totalPages;
}

/**
 * Quick inline update helper
 */
async function updateContactField(id, data) {
  try {
    const res = await fetch(`${API_BASE}/api/contacts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error("Update failed");
    showToast("Contact updated");
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Copy helper
 */
window.copyToClipboard = function(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(`Copied to clipboard: ${text}`);
  }).catch(() => {
    showToast("Failed to copy to clipboard");
  });
};

/**
 * Delete contact
 */
window.deleteContact = async function(id) {
  if (!confirm("Are you sure you want to delete this contact?")) return;

  try {
    const res = await fetch(`${API_BASE}/api/contacts/${id}`, {
      method: "DELETE"
    });
    if (!res.ok) throw new Error("Delete failed");
    showToast("Contact deleted");
    loadStats();
    loadContacts();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
};

/**
 * Open Modal for New Contact
 */
function openNewContactModal() {
  editingContactId = null;
  modalTitle.textContent = "Add New HR Contact";
  contactForm.reset();
  modalContactId.value = "";
  modalEmail.disabled = false;
  modalStatus.value = "unverified";
  modalEmailType.value = "person_or_other";
  modalReviewed.checked = false;
  contactModal.classList.remove("hidden");
}

/**
 * Open Modal for Editing Contact
 */
window.openEditContactModal = async function(id) {
  try {
    const res = await fetch(`${API_BASE}/api/contacts/${id}`);
    if (!res.ok) throw new Error("Could not fetch contact details");
    const data = await res.json();

    editingContactId = id;
    modalTitle.textContent = "Edit HR Contact";
    modalContactId.value = data.id;
    modalEmail.value = data.email || "";
    modalCompany.value = data.company_name || "";
    modalContactPerson.value = data.contact_name || "";
    modalJobTitle.value = data.job_title || "";
    modalSourceDomain.value = data.source_domain || "";
    modalSourceUrl.value = data.source_url || "";
    modalStatus.value = data.verification_status || "unverified";
    modalEmailType.value = data.email_type || "person_or_other";
    modalReviewed.checked = !!data.reviewed;
    modalNotes.value = data.notes || "";

    contactModal.classList.remove("hidden");
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
};

function closeModal() {
  contactModal.classList.add("hidden");
}

/**
 * Save / Update Form Handler
 */
async function handleContactFormSubmit(e) {
  e.preventDefault();

  const payload = {
    company_name: modalCompany.value.trim() || null,
    contact_name: modalContactPerson.value.trim() || null,
    job_title: modalJobTitle.value.trim() || null,
    email: modalEmail.value.trim(),
    source_url: modalSourceUrl.value.trim(),
    source_domain: modalSourceDomain.value.trim() || null,
    verification_status: modalStatus.value,
    email_type: modalEmailType.value,
    reviewed: modalReviewed.checked,
    notes: modalNotes.value.trim() || null
  };

  try {
    let res;
    if (editingContactId) {
      res = await fetch(`${API_BASE}/api/contacts/${editingContactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch(`${API_BASE}/api/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || "Save failed");
    }

    closeModal();
    showToast(editingContactId ? "Contact updated successfully!" : "Contact created successfully!");
    loadStats();
    loadDomains();
    loadContacts();
  } catch (err) {
    showToast(`Failed: ${err.message}`);
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
