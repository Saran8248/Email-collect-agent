# HR Contact Collection Agent

Complete Project Structure, Architecture & Setup Guide for collecting publicly displayed company and HR contact details from permitted German job portals, deduplicating records, reviewing contacts, and exporting CSV.

---

## 1. Project Overview

| Component | Technology / Role |
| :--- | :--- |
| **Browser** | Chrome Extension (Manifest V3), controls the current tab after user invocation |
| **Backend** | Python 3.11+ + FastAPI |
| **Database** | PostgreSQL (with automatic SQLite fallback for local test runs) |
| **Dashboard** | HTML5, CSS3, Modern Vanilla JavaScript |
| **Purpose** | Collect publicly displayed company and HR contact details from permitted German job portals, deduplicate records, review contacts, and export CSV |

The extension analyzes the active Chrome tab after you invoke it. It extracts visible page text, company/job context, published email addresses, and matching same-origin links. A background worker can visit a bounded number of matching pages in that tab. The FastAPI service saves records to the database and exposes a dashboard API for search, filtering, manual audit/review, and CSV export.

> [!IMPORTANT]
> **Limitations & Compliance:** This starter project does not bypass logins, CAPTCHAs, paywalls, or website restrictions. It explicitly excludes automated LinkedIn collection. Email format validation does not prove deliverability, and missing email addresses are not fabricated. Follow each portal's terms of service and applicable privacy laws (e.g. GDPR).

---

## 2. Complete Folder Structure

```
Email-collect-agent/ (or hr_contact_agent/)
├── README.md
├── docker-compose.yml
├── extension/
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.css
│   ├── popup.js
│   ├── content.js
│   └── background.js
├── backend/
│   ├── requirements.txt
│   ├── .env.example
│   ├── .env
│   ├── Dockerfile
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   ├── database.py
│   │   ├── models.py
│   │   ├── schemas.py
│   │   └── collector.py
│   └── tests/
│       ├── test_api.py
│       └── test_collector.py
├── dashboard/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── start_backend.bat
└── start_dashboard.bat
```

---

## 3. Database Schema

Stored in the `contacts` table:

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | Integer (PK) | Auto-incrementing unique identifier. |
| `company_name` | String(255) | Company name inferred from visible page labels or metadata. |
| `contact_name` | String(255) | Contact name only when the page text contains a recognizable explicit contact label. |
| `job_title` | String(255) | Job posting title or page title. |
| `email` | String(255) | Published email address. |
| `email_normalized` | String(255) (Unique) | Normalized lowercase deduplication key. |
| `source_url` | Text | Page URL where the record was found. |
| `source_domain` | String(255) | Website domain where the record was found. |
| `verification_status`| String(50) | `unverified`, `verified`, `not_found`, or `invalid` (review manually before marking verified). |
| `email_type` | String(50) | `generic` inbox vs `person_or_other` classification. |
| `reviewed` | Boolean | Human review audit flag (`false` by default). |
| `notes` | Text | Review remarks and manual audit notes. |
| `created_at` | DateTime | Timestamp when record was ingested. |
| `updated_at` | DateTime | Timestamp when record was last updated. |

---

## 4. Step-by-Step Setup (Windows + VS Code)

### Prerequisites
- Python 3.11+
- Google Chrome
- VS Code
- Docker Desktop (optional for local PostgreSQL; SQLite is automatically supported if PostgreSQL is offline)

### Step 1: Start PostgreSQL (Docker)
Open your terminal at the project root and run:
```powershell
docker compose up -d db
```

### Step 2: Configure & Start Backend
Open a terminal at the project root:
```powershell
cd backend
copy .env.example .env
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
> **Tip:** You can also simply run `.\start_backend.bat` from the project root!

### Step 3: Check API Health
Open your browser to:
[http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

Expected JSON response:
```json
{"status":"ok","service":"hr-contact-agent"}
```

API interactive documentation:
[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### Step 4: Start Review Dashboard
In a separate terminal, from the project root:
```powershell
cd dashboard
python -m http.server 8080
```
> **Tip:** Or run `.\start_dashboard.bat` from the project root.

Open your browser to:
[http://127.0.0.1:8080](http://127.0.0.1:8080)

---

## 5. Chrome Extension Installation

1. Open Chrome and navigate to `chrome://extensions`.
2. Toggle on **Developer mode** in the top right corner.
3. Click **Load unpacked**.
4. Select the `extension` folder inside this repository:
   `c:\Users\sksar\Desktop\Email-collect-agent\extension`
5. Pin the **HR Contact Collection Agent** extension to your Chrome toolbar.
6. Open a permitted public job posting (e.g. on `stepstone.de`, `de.indeed.com`, `arbeitsagentur.de`).
7. Click the extension icon.
8. Click **Analyze Current Page** to inspect the preview, then click **Save to Database**, or switch to the **Bounded Crawler** tab to start an automated crawl.

---

## 6. Controls & Limitations

- **Bounded Same-Origin Navigation:** The crawler is limited to the current website origin. It visits unvisited links adhering to your configured page limit (default: 5) and inter-page delay (default: 2000 ms).
- **Tab Dedication:** The active browser tab navigates as the worker crawls pages. Do not use that tab for manual browsing while a crawl is in progress.
- **Run Controls:** You can **Pause**, **Resume**, or **Stop** an ongoing crawl at any time from the extension popup.
- **German Portal Heuristics:** Contact extraction uses specialized heuristics for German recruiting patterns (`Ansprechpartner`, `Kontaktperson`, `Frau/Herr`, `Bewerbung an`, `Karriere`).
- **Compliance Rules:** LinkedIn automated collection is intentionally disabled.
- **Email Validation:** Email syntax is normalized and validated against standard email format rules. This does not perform intrusive mailbox pinging or email dispatch.

---

## 7. Important URLs

| Purpose | URL |
| :--- | :--- |
| **Review Dashboard** | [http://127.0.0.1:8080](http://127.0.0.1:8080) |
| **API Health Check** | [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health) |
| **API Swagger Docs** | [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) |
| **CSV Export** | [http://127.0.0.1:8000/api/export.csv](http://127.0.0.1:8000/api/export.csv) |
| **Chrome Extensions** | `chrome://extensions` |

---

## 8. Running Automated Tests

Run the test suite using pytest:
```powershell
$env:PYTHONPATH="backend"
.\.venv\Scripts\pytest backend/tests -v
```
All 11 unit and integration tests verify email normalization, generic inbox heuristics, contact deduplication, CRUD API routes, metrics computation, and CSV streaming.
