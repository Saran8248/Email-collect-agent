/**
 * HR Contact Collection Agent - Content Script
 * Extracts visible text, company/job title hints, published emails,
 * contact names, and matching same-origin links from permitted job portals.
 */

(function () {
  // Prevent duplicate execution if injected multiple times
  if (window.__hrContactAgentInjected) {
    return;
  }
  window.__hrContactAgentInjected = true;

  const GENERIC_PREFIXES = [
    "info", "kontakt", "contact", "karriere", "career", "careers", "jobs", "job",
    "bewerbung", "bewerbungen", "bewerber", "hr", "recruiting", "talent", "team",
    "office", "mail", "support", "service", "hello", "hallo", "personal", "arbeit",
    "presse", "press", "marketing", "sales", "admin", "poststelle", "empfang", "zentrale"
  ];

  const INVALID_EXTENSIONS = [
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
    ".js", ".css", ".woff", ".woff2", ".ttf", ".pdf", ".zip"
  ];

  /**
   * Universal compliance check - allows scanning across all job portals
   */
  function checkComplianceRestrictions() {
    return { blocked: false };
  }

  /**
   * Automatically expand "See more", "Show more", "Read more" buttons
   * commonly found on Indeed, StepStone, and other job portals to reveal
   * the full description and hidden HR contact details.
   */
  async function expandHiddenContent() {
    const expandSelectors = [
      '#viewJobSSRRoot button',
      '[data-testid="viewJob-description-show-more"]',
      'button[aria-expanded="false"]',
      'button[class*="showMore"]',
      'button[class*="show-more"]',
      'button[class*="ShowMore"]',
      'button[id*="showMore"]',
      '.jobsearch-JobComponent-description-toggle',
      'button[data-testid*="show-more"]'
    ];

    // Click targeted selector buttons
    for (const sel of expandSelectors) {
      const elements = document.querySelectorAll(sel);
      for (const el of elements) {
        try {
          el.click();
        } catch (e) {}
      }
    }

    // Click buttons and links by text content
    const clickables = document.querySelectorAll("button, a, [role='button'], summary");
    for (const el of clickables) {
      const text = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (
        text === "show more" ||
        text === "see more" ||
        text === "read more" ||
        text === "view full job description" ||
        text.includes("view full description") ||
        text.includes("read full description") ||
        text === "show full description" ||
        text === "mehr anzeigen" ||
        text === "mehr lesen"
      ) {
        try {
          el.click();
        } catch (e) {}
      }
    }

    // Wait 150ms for DOM expansion
    await new Promise(r => setTimeout(r, 150));
  }

  /**
   * Helper to ensure navigation menus, headers, footers, breadcrumbs,
   * and mega-menus are never mistaken for job postings.
   */
  function isNavigationOrFooter(el) {
    if (!el) return false;
    return !!el.closest(
      "header, nav, footer, [role='navigation'], [role='banner'], [role='contentinfo'], " +
      ".rel_megamenu, [class*='megamenu'], [class*='mega-menu'], [class*='navbar'], " +
      "[class*='breadcrumb'], [aria-label*='breadcrumb'], [class*='pagination'], " +
      "[class*='filter'], [class*='facet'], aside"
    );
  }

  /**
   * Extract JSON-LD JobPosting metadata if available
   */
  function extractJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.innerText);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item["@type"] === "JobPosting") {
            const title = item.title;
            const company = item.hiringOrganization && typeof item.hiringOrganization === "object"
              ? item.hiringOrganization.name
              : (typeof item.hiringOrganization === "string" ? item.hiringOrganization : null);
            return { title, company };
          }
        }
      } catch (e) {
        // Ignore JSON parse errors in embedded scripts
      }
    }
    return {};
  }

  /**
   * Infer Job Title / Role Name using DOM selectors, meta tags, and heuristics
   */
  function extractJobTitle(jsonLd) {
    if (jsonLd.title && jsonLd.title.trim()) {
      return jsonLd.title.trim();
    }

    const titleSelectors = [
      '[data-locator-id="jobdetails_applyjobs_jobtitle"]',
      '[data-locator-id="joblisting_jobcard_title"]',
      '[data-locator-id*="jobtitle"]',
      '[data-testid="jobsearch-JobInfoHeader-title"]',
      'h1.jobsearch-JobInfoHeader-title',
      'h1[class*="jobsearch-JobInfoHeader-title"]',
      '[data-qa="job-title"]',
      '.jobsearch-JobInfoHeader-title',
      '.job-title',
      'h1[class*="jobTitle"]',
      'h2.jobTitle',
      '[class*="JobHeader-title"]',
      '[itemprop="title"]',
      'h1'
    ];

    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.trim().length > 2) {
        const text = el.innerText.trim().split("\n")[0];
        if (text.length > 2 && text.length < 150) {
          return text;
        }
      }
    }

    // Fallback to og:title or document.title
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && ogTitle.content) {
      return ogTitle.content.split("|")[0].split("-")[0].trim();
    }

    return document.title.split("|")[0].split("-")[0].trim();
  }

  /**
   * Infer Company Name using DOM selectors, meta tags, and heuristics
   */
  function extractCompanyName(jsonLd) {
    if (jsonLd.company && jsonLd.company.trim()) {
      return jsonLd.company.trim();
    }

    const companySelectors = [
      '[data-locator-id="jobdetails_summary_clientname"]',
      '[data-locator-id*="clientname"]',
      '[data-testid="inlineHeader-companyName"]',
      '[data-testid="company-name"]',
      '[data-company-name="true"]',
      '.jobsearch-CompanyInfoContainer a',
      '.jobsearch-InlineCompanyRating div a',
      '.jobsearch-InlineCompanyRating div',
      '.companyName',
      '[data-qa="company-name"]',
      '.company-name',
      '[class*="company-name"]',
      '[itemprop="hiringOrganization"]',
      '[class*="employer"]',
      '[class*="Employer"]',
      '[class*="company"]'
    ];

    for (const sel of companySelectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.trim()) {
        const text = el.innerText.trim().split("\n")[0];
        if (text.length >= 2 && text.length < 100) {
          return text;
        }
      }
    }

    const ogSite = document.querySelector('meta[property="og:site_name"]');
    if (ogSite && ogSite.content) {
      return ogSite.content.trim();
    }

    // Heuristic: split document title e.g. "Job Title at Company Name"
    const docTitle = document.title;
    if (docTitle.includes(" bei ")) {
      const parts = docTitle.split(" bei ");
      if (parts[1]) return parts[1].split("|")[0].split("-")[0].trim();
    }
    if (docTitle.includes(" at ")) {
      const parts = docTitle.split(" at ");
      if (parts[1]) return parts[1].split("|")[0].split("-")[0].trim();
    }

    return null;
  }

  const INVALID_NAME_TOKENS = new Set([
    "details", "contact", "us", "info", "hr", "recruiter", "team", "department",
    "support", "careers", "jobs", "hiring", "manager", "person", "address",
    "telephone", "phone", "email", "website", "apply", "application", "resume", "cv",
    "description", "requirements", "overview", "responsibilities", "qualifications",
    "profile", "client", "company", "location", "salary", "experience", "skills",
    "benefits", "role", "position", "summary", "instructions", "portal", "link",
    "information", "privacy", "policy", "terms", "notice"
  ]);

  function isValidContactPersonName(raw) {
    if (!raw || typeof raw !== "string") return false;
    const clean = raw.trim();
    if (clean.length < 3 || clean.length > 50) return false;
    const lower = clean.toLowerCase();
    if (lower.includes("http") || lower.includes("www.") || lower.includes("@") || lower.includes(".com") || lower.includes("click here")) {
      return false;
    }
    const words = lower.replace(/[^a-zäöüß\s]/g, " ").split(/\s+/).filter(Boolean);
    if (words.length === 0) return false;
    if (words.every(w => INVALID_NAME_TOKENS.has(w))) return false;
    if (words.length === 1 && INVALID_NAME_TOKENS.has(words[0])) return false;
    return true;
  }

  /**
   * Detect Contact Person / Recruiter Name using recruiting labels & honorifics
   */
  function extractContactName() {
    const labelPatterns = [
      /(?:posted\s+by(?:\s+recruiter)?|hiring\s+manager|job\s+poster|recruiter|hr\s+executive|talent\s+acquisition|hr\s+manager)\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i,
      /(?:contact\s*(?:person)?|reach\s+out\s+to|queries\s+to|send\s+(?:your\s+)?(?:resume|cv)\s+to)\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i,
      /(?:ihr(?:e)?\s+)?ansprechpartner(?:in)?\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i,
      /(?:ihr(?:e)?\s+)?kontakt(?:person)?\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i,
      /bewerbung(?:en)?\s+an\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i,
      /zuständig(?:er|e)?\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i
    ];

    // English and German honorific patterns
    const honorificPattern = /(?:Mr\.|Mrs\.|Ms\.|Frau|Herr|Dr\.|Prof\.)\s+[A-ZÄÖÜ][a-zäöüß]+\s+[A-ZÄÖÜ][a-zäöüß]+/g;

    const bodyText = document.body ? document.body.innerText : "";

    for (const pat of labelPatterns) {
      const match = bodyText.match(pat);
      if (match && match[1]) {
        let name = match[1].trim().split("\n")[0].split(",")[0].trim();
        name = name.replace(/^(Mr\.|Mrs\.|Ms\.|Frau|Herr|Dr\.|Prof\.)\s*/i, "$1 ");
        if (isValidContactPersonName(name)) {
          return name;
        }
      }
    }

    // Try honorific matching in visible text
    const honorificMatches = bodyText.match(honorificPattern);
    if (honorificMatches && honorificMatches.length > 0) {
      const candidate = honorificMatches[0].trim();
      if (isValidContactPersonName(candidate)) {
        return candidate;
      }
    }

    // Check embedded Next.js / framework state for recruiter fullName
    const scripts = document.querySelectorAll("script:not([src])");
    for (const script of scripts) {
      const scriptText = script.textContent || script.innerText || "";
      if (scriptText.includes("fullName") || scriptText.includes("internalConsultant")) {
        const m = scriptText.match(/(?:\\"|"|')fullName(?:\\"|"|')\s*:\s*(?:\\"|"|')([A-Za-z\s.]{3,40})(?:\\"|"|')/i);
        if (m && m[1] && m[1] !== "null" && isValidContactPersonName(m[1])) {
          return m[1].trim();
        }
      }
    }

    return null;
  }

  /**
   * De-obfuscate and clean an email string
   */
  function cleanRawEmail(str) {
    if (!str) return "";
    let s = str.trim();
    if (s.toLowerCase().startsWith("mailto:")) {
      s = s.substring(7);
    }
    if (s.includes("?")) {
      s = s.split("?")[0];
    }
    s = s.replace(/\s*\[at\]\s*/gi, "@")
         .replace(/\s*\(at\)\s*/gi, "@")
         .replace(/\s+at\s+/gi, "@")
         .replace(/&#64;/g, "@")
         .replace(/%40/g, "@")
         .replace(/\s*\[dot\]\s*/gi, ".")
         .replace(/\s*\(dot\)\s*/gi, ".");
    return s.trim().replace(/^['"<>()]+|['"<>()]+$/g, "").toLowerCase();
  }

  /**
   * Extract all published email addresses
   */
  function extractEmails() {
    const found = new Set();
    const emailRegex = /\b[A-Za-z0-9._%+-]+(?:@|\[at\]|\(at\))[A-Za-z0-9.-]+\.[A-Za-z]{2,7}\b/gi;

    // 1. Scan mailto links
    const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
    for (const a of mailtoLinks) {
      const cleaned = cleanRawEmail(a.getAttribute("href"));
      if (isValidScrapedEmail(cleaned)) {
        found.add(cleaned);
      }
    }

    // 2. Scan visible text
    const bodyText = document.body ? document.body.innerText : "";
    const textMatches = bodyText.match(emailRegex);
    if (textMatches) {
      for (const m of textMatches) {
        const cleaned = cleanRawEmail(m);
        if (isValidScrapedEmail(cleaned)) {
          found.add(cleaned);
        }
      }
    }

    // 3. Scan attributes (e.g. data-email)
    const elementsWithEmail = document.querySelectorAll('[data-email], [data-qa*="email"]');
    for (const el of elementsWithEmail) {
      const raw = el.getAttribute("data-email") || el.innerText;
      const cleaned = cleanRawEmail(raw);
      if (isValidScrapedEmail(cleaned)) {
        found.add(cleaned);
      }
    }

    // 4. Scan embedded script chunks (Next.js / Nuxt / JSON-LD / inline scripts)
    const inlineScripts = document.querySelectorAll("script:not([src])");
    for (const script of inlineScripts) {
      const scriptText = script.textContent || script.innerText || "";
      if (scriptText.includes("@")) {
        const m = scriptText.match(/(?:\\"|"|')emailAddress(?:\\"|"|')\s*:\s*(?:\\"|"|')([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,7})(?:\\"|"|')/i);
        if (m && m[1] && isValidScrapedEmail(m[1])) {
          found.add(cleanRawEmail(m[1]));
        }
      }
    }

    return Array.from(found);
  }

  function isValidScrapedEmail(email) {
    if (!email || email.length < 5 || email.length > 100 || !email.includes("@")) {
      return false;
    }
    for (const ext of INVALID_EXTENSIONS) {
      if (email.endsWith(ext)) return false;
    }
    const validPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,7}$/;
    if (!validPattern.test(email)) return false;

    // Skip generic placeholder emails
    const placeholders = ["yourname@domain.com", "email@example.com", "name@domain.de", "test@test.de", "test@domain.com"];
    if (placeholders.includes(email.toLowerCase())) return false;

    return true;
  }

  /**
   * Filter out compliance, legal, and GDPR notice emails
   * to ensure genuine recruiter / application emails are prioritized.
   */
  function isExcludedLegalEmail(email) {
    const lower = (email || "").toLowerCase();
    const blacklist = [
      "dpis.india", "dataprotection", "privacy@", "legal@",
      "compliance@", "dpo@", "abuse@", "webmaster@", "sales.enquiry@"
    ];
    return blacklist.some(term => lower.includes(term));
  }

  /**
   * Extract job requirements and description text from job pages
   */
  function extractJobRequirements(root = document) {
    const selectors = [
      '[data-locator-id="jobdetails_description_leftsidecomponent"]',
      '[data-locator-id*="jobdetails_description"]',
      '#jobsearch-ViewjobPaneWrapper',
      '[data-testid="jobsearch-JobComponent-description"]',
      '.jobsearch-jobDescriptionText',
      '[data-qa="job-description"]',
      '#job-description',
      '.job-description',
      '.job-details',
      '[itemprop="description"]',
      'article'
    ];
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el && (el.innerText || el.textContent)) {
        const text = (el.innerText || el.textContent).trim();
        if (text.length > 30) return text;
      }
    }
    return "";
  }

  /**
   * Scans job requirements, description, and application instructions
   * specifically for direct applying emails (e.g., "send CV to...", "apply at...", "mail resume to...")
   */
  function extractDirectApplyEmails(text, html = "") {
    const directEmails = [];
    const seen = new Set();
    const combined = (text || "") + " " + (html || "");

    const contextPatterns = [
      /(?:send|forward|email|mail|drop|submit|share)\s+(?:your\s+)?(?:cv|resume|profile|application|details)?\s*(?:to|at|on)?\s*[:\-]?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,7})/gi,
      /(?:apply|applying|application)\s*(?:directly)?\s*(?:to|at|email)?\s*[:\-]?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,7})/gi,
      /(?:reach\s+out|contact|queries|write)\s+(?:to|at)?\s*[:\-]?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,7})/gi,
      /(?:hiring|recruiter|hr|talent)\s*(?:team|manager|executive|contact|email)?\s*[:\-]?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,7})/gi,
      /mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,7})/gi
    ];

    for (const pat of contextPatterns) {
      let match;
      while ((match = pat.exec(combined)) !== null) {
        if (match[1]) {
          const email = cleanRawEmail(match[1]);
          if (isValidScrapedEmail(email) && !isExcludedLegalEmail(email) && !seen.has(email)) {
            seen.add(email);
            directEmails.push({
              email: email,
              type: "direct_apply",
              source: "job_requirements"
            });
          }
        }
      }
    }

    // Also check embedded consultant / application email
    const consultantM = combined.match(/(?:\\"|"|')emailAddress(?:\\"|"|')\s*:\s*(?:\\"|"|')([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,7})(?:\\"|"|')/i);
    if (consultantM && consultantM[1]) {
      const cEmail = cleanRawEmail(consultantM[1]);
      if (isValidScrapedEmail(cEmail) && !isExcludedLegalEmail(cEmail) && !seen.has(cEmail)) {
        seen.add(cEmail);
        directEmails.push({
          email: cEmail,
          type: "direct_apply",
          source: "consultant_profile"
        });
      }
    }

    return directEmails;
  }

  /**
   * Classify email type as 'direct_apply', 'generic', or 'person_or_other'
   */
  function classifyEmail(email) {
    if (!email) return "generic";
    const lower = email.toLowerCase();
    if (lower.startsWith("job.application") || lower.startsWith("apply.") || lower.startsWith("recruitment")) {
      return "direct_apply";
    }
    const local = lower.split("@")[0];
    for (const prefix of GENERIC_PREFIXES) {
      if (local === prefix || local.startsWith(prefix + ".") || local.startsWith(prefix + "-") || local.startsWith(prefix + "_")) {
        return "generic";
      }
    }
    return "person_or_other";
  }

  /**
   * Find matching same-origin links relevant to job / career listings.
   * Includes specific Indeed job key (jk) card extraction.
   */
  function extractSameOriginLinks() {
    const currentOrigin = window.location.origin;
    const linksSet = new Set();

    // 1. Prioritize all directly detected job cards on this page first
    try {
      const detectedCards = detectJobCards();
      for (const card of detectedCards) {
        if (card.url && card.url !== window.location.href) {
          linksSet.add(card.url);
        }
      }
    } catch (e) {}

    // 2. Indeed-specific: detect individual job cards (data-jk, job_*, /viewjob, /rc/clk)
    const indeedCards = document.querySelectorAll("[data-jk], a[href*='jk='], a.jcs-JobTitle, a[id^='job_']");
    for (const card of indeedCards) {
      if (isNavigationOrFooter(card)) continue;
      let jk = card.getAttribute("data-jk");
      if (!jk && card.getAttribute("href")) {
        try {
          const u = new URL(card.getAttribute("href"), window.location.href);
          jk = u.searchParams.get("jk");
        } catch (e) {}
      }
      if (jk && /^[a-zA-Z0-9]+$/.test(jk)) {
        linksSet.add(`${currentOrigin}/viewjob?jk=${jk}`);
      }
    }

    // 3. Scan other same-origin job links, EXCLUDING navigation, header, footer menus
    const allAnchors = document.querySelectorAll("a[href]");
    const jobKeywords = [
      "/job/", "/jobs/", "stellenangebot", "karriere", "career", "position",
      "detail", "angebot", "viewjob"
    ];

    for (const a of allAnchors) {
      try {
        if (isNavigationOrFooter(a)) continue;

        const href = a.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) {
          continue;
        }

        const fullUrl = new URL(href, window.location.href);
        if (fullUrl.origin === currentOrigin) {
          const cleanUrl = fullUrl.origin + fullUrl.pathname + fullUrl.search;
          const pathLower = cleanUrl.toLowerCase();

          // Skip root directory search / navigation links
          if (cleanUrl === window.location.href || cleanUrl === `${currentOrigin}/jobs/` || cleanUrl === `${currentOrigin}/jobs`) {
            continue;
          }

          const isRelevant = jobKeywords.some(kw => pathLower.includes(kw));
          if (isRelevant) {
            linksSet.add(cleanUrl);
          }
        }
      } catch (e) {
        // Skip malformed URLs
      }
    }

    return Array.from(linksSet).slice(0, 50);
  }

  /**
   * Execute full page extraction
   * Automatically expands hidden "See more" text first
   */
  async function analyzeCurrentPage() {
    const compliance = checkComplianceRestrictions();
    if (compliance.blocked) {
      return {
        success: false,
        blocked: true,
        message: compliance.reason,
        url: window.location.href,
        domain: window.location.hostname
      };
    }

    // Expand hidden "See more" / "Show more" accordion before reading DOM
    await expandHiddenContent();

    const jsonLd = extractJsonLd();
    const jobTitle = extractJobTitle(jsonLd);
    const companyName = extractCompanyName(jsonLd);
    const contactName = extractContactName();
    const jobRequirements = extractJobRequirements();
    const directEmails = extractDirectApplyEmails(jobRequirements, document.body ? document.body.innerHTML : "");
    const rawEmails = extractEmails();
    const sameOriginLinks = extractSameOriginLinks();

    // Deduplicate and place direct applying emails first
    const seen = new Set();
    const emails = [];

    for (const d of directEmails) {
      if (!seen.has(d.email)) {
        seen.add(d.email);
        emails.push({ email: d.email, type: "direct_apply" });
      }
    }

    for (const em of rawEmails) {
      if (!seen.has(em) && !isExcludedLegalEmail(em)) {
        seen.add(em);
        emails.push({ email: em, type: classifyEmail(em) });
      }
    }

    return {
      success: true,
      blocked: false,
      data: {
        page_title: document.title,
        job_title: jobTitle,
        company_name: companyName,
        contact_name: contactName,
        job_requirements: jobRequirements ? jobRequirements.slice(0, 300) : null,
        emails: emails,
        source_url: window.location.href,
        source_domain: window.location.hostname.replace(/^www\./, ""),
        same_origin_links: sameOriginLinks
      }
    };
  }

  // =========================================================================
  // In-Page Job Scanner (Zero Page Reload - "Don't Change the Pages")
  // Inspects each job role one by one, opens details, checks for HR email,
  // saves if found, and cleanly skips if not found without navigating away.
  // =========================================================================

  window.__hrInPageScanState = {
    status: "idle", // 'idle' | 'running' | 'paused' | 'stopped' | 'completed'
    currentIndex: 0,
    totalJobs: 0,
    savedCount: 0,
    currentJobTitle: "",
    currentCompany: ""
  };

  function getOrCreateHud() {
    let hud = document.getElementById("__hr_agent_hud");
    if (!hud) {
      hud = document.createElement("div");
      hud.id = "__hr_agent_hud";
      hud.innerHTML = `
        <div style="
          position: fixed;
          bottom: 20px;
          right: 20px;
          width: 380px;
          background: #0f172a;
          color: #f8fafc;
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5), 0 4px 6px rgba(0,0,0,0.3);
          border: 1px solid #334155;
          padding: 16px;
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 13px;
          line-height: 1.4;
        ">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="background:#2563eb; color:#fff; font-weight:700; font-size:11px; padding:2px 6px; border-radius:4px;">HR AGENT</span>
              <span style="font-weight:700; font-size:13px;" id="__hr_hud_title">In-Page Job Scanner</span>
            </div>
            <button id="__hr_hud_close" style="background:none; border:none; color:#94a3b8; font-size:18px; cursor:pointer; line-height:1;" title="Close HUD">&times;</button>
          </div>
          <div id="__hr_hud_status" style="font-size:12px; color:#cbd5e1; margin-bottom:8px; min-height: 34px;">
            Initializing job inspection...
          </div>
          <div style="background:#1e293b; height:6px; border-radius:3px; overflow:hidden; margin-bottom:10px;">
            <div id="__hr_hud_progress" style="background:#22c55e; height:100%; width:0%; transition:width 0.25s ease;"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:11px; color:#94a3b8; margin-bottom:12px;">
            <span id="__hr_hud_counts">Inspected: 0 / 0</span>
            <span id="__hr_hud_saved" style="color:#4ade80; font-weight:700;">Saved: 0 HR emails</span>
          </div>
          <div style="display:flex; gap:8px;">
            <button id="__hr_hud_pause_btn" style="flex:1; padding:7px; background:#334155; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">⏸ Pause</button>
            <button id="__hr_hud_stop_btn" style="flex:1; padding:7px; background:#ef4444; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">⏹ Stop</button>
            <a href="http://127.0.0.1:8000/dashboard" target="_blank" style="padding:7px 12px; background:#2563eb; color:#fff; text-decoration:none; border-radius:6px; font-size:11px; font-weight:600; display:flex; align-items:center;">📊 Dashboard</a>
          </div>
        </div>
      `;
      document.body.appendChild(hud);

      hud.querySelector("#__hr_hud_close").addEventListener("click", () => hud.remove());

      hud.querySelector("#__hr_hud_pause_btn").addEventListener("click", () => {
        if (window.__hrInPageScanState.status === "running") {
          window.__hrInPageScanState.status = "paused";
          hud.querySelector("#__hr_hud_pause_btn").textContent = "▶ Resume";
          hud.querySelector("#__hr_hud_status").textContent = "Paused. Click Resume to continue.";
        } else if (window.__hrInPageScanState.status === "paused") {
          window.__hrInPageScanState.status = "running";
          hud.querySelector("#__hr_hud_pause_btn").textContent = "⏸ Pause";
          hud.querySelector("#__hr_hud_status").textContent = "Resuming inspection...";
        }
      });

      hud.querySelector("#__hr_hud_stop_btn").addEventListener("click", () => {
        window.__hrInPageScanState.status = "stopped";
        hud.querySelector("#__hr_hud_status").textContent = "Stopping scan...";
      });
    }
    return hud;
  }

  /**
   * Universal Job Card Detector across ALL Job Portals
   * Supports: Indeed, StepStone, Naukri, Monster/Foundit, Arbeitsagentur,
   * Glassdoor, ZipRecruiter, Xing, and generic career boards.
   */
  function detectJobCards() {
    const cards = [];
    const seenUrls = new Set();
    const currentOrigin = window.location.origin;

    function addCard(element, clickable, rawUrl, titleHint, companyHint) {
      if (!rawUrl) return;
      try {
        const resolved = new URL(rawUrl, window.location.href).href;
        if (seenUrls.has(resolved)) return;
        seenUrls.add(resolved);

        cards.push({
          id: resolved,
          element: element || clickable,
          clickable: clickable || element,
          url: resolved,
          titleHint: titleHint ? titleHint.trim() : null,
          companyHint: companyHint ? companyHint.trim() : null
        });
      } catch (e) {}
    }

    // 1. Randstad (randstad.in, randstad.com, etc.):
    // Cards use data-locator-id="joblisting_jobcard_jobitem"
    const randstadCards = document.querySelectorAll(
      "[data-locator-id='joblisting_jobcard_jobitem'], [data-locator-id*='jobcard_jobitem'], [data-locator-id*='joblisting_jobcard']"
    );
    for (const el of randstadCards) {
      if (isNavigationOrFooter(el)) continue;
      const link = el.querySelector("a[href*='/jobs/'], a");
      const titleEl = el.querySelector("[data-locator-id='joblisting_jobcard_title'], h2, h3");
      const locEl = el.querySelector("[data-locator-id='joblisting_jobcard_location']");
      const title = titleEl ? (titleEl.innerText || titleEl.textContent || "").trim() : null;
      const href = link ? link.getAttribute("href") : null;
      const loc = locEl ? (locEl.innerText || locEl.textContent || "").trim() : null;
      if (href && title) {
        addCard(el, link || el, href, title, loc ? `Randstad (${loc})` : "Randstad");
      }
    }

    // 2. Indeed: [data-jk], .job_seen_beacon
    const indeedCards = document.querySelectorAll("[data-jk]");
    for (const el of indeedCards) {
      if (isNavigationOrFooter(el)) continue;
      const jk = el.getAttribute("data-jk");
      if (jk) {
        const clickable = el.querySelector("a.jcs-JobTitle, h2.jobTitle a, a") || el;
        const title = el.querySelector("h2, .jobTitle")?.innerText?.trim();
        const company = el.querySelector(".companyName, [data-company-name='true']")?.innerText?.trim();
        addCard(el, clickable, `${currentOrigin}/viewjob?jk=${jk}`, title, company);
      }
    }

    // 3. StepStone: article[data-qa="job-item"], a[href*="/stellenangebote--"]
    const stepstoneCards = document.querySelectorAll(
      "article[data-qa='job-item'], article[data-testid*='job-item'], article[data-testid*='job-element']"
    );
    for (const el of stepstoneCards) {
      if (isNavigationOrFooter(el)) continue;
      const link = el.querySelector("a[href*='/stellenangebote--'], a[href*='/jobs--'], a[data-qa*='job-item-title'], a");
      if (link && link.getAttribute("href")) {
        const title = el.querySelector("[data-qa='job-item-title'], h2, h3")?.innerText?.trim();
        const company = el.querySelector("[data-qa='job-item-company-name'], [class*='company']")?.innerText?.trim();
        addCard(el, link, link.getAttribute("href"), title, company);
      }
    }

    // 4. Naukri: .srp-jobtuple-wrapper, .jobTuple, a.title
    const naukriCards = document.querySelectorAll(".srp-jobtuple-wrapper, .jobTuple, article.jobTuple, [data-job-id]");
    for (const el of naukriCards) {
      if (isNavigationOrFooter(el)) continue;
      const link = el.querySelector("a.title, a[href*='job-listings'], a");
      if (link && link.getAttribute("href")) {
        const title = link.innerText?.trim();
        const company = el.querySelector(".comp-name, .subTitle, a.companyName")?.innerText?.trim();
        addCard(el, link, link.getAttribute("href"), title, company);
      }
    }

    // 5. Monster / Foundit: .cardContainer, [data-job-id], .job-tittle a
    const monsterCards = document.querySelectorAll(".cardContainer, [data-job-id], .job-card");
    for (const el of monsterCards) {
      if (isNavigationOrFooter(el)) continue;
      const link = el.querySelector(".job-tittle a, a[href*='/job-'], a");
      if (link && link.getAttribute("href")) {
        const title = link.innerText?.trim();
        const company = el.querySelector(".company-name, .comp-name")?.innerText?.trim();
        addCard(el, link, link.getAttribute("href"), title, company);
      }
    }

    // 6. Arbeitsagentur: [data-e2e="ergebnisliste-eintrag"], /jobsuche/suche/detail/
    const baCards = document.querySelectorAll("[data-e2e='ergebnisliste-eintrag'], [id*='ergebnisliste-eintrag']");
    for (const el of baCards) {
      if (isNavigationOrFooter(el)) continue;
      const link = el.querySelector("a[href*='detail'], a");
      if (link && link.getAttribute("href")) {
        const title = el.querySelector("h3, a")?.innerText?.trim();
        const company = el.querySelector(".arbeitgeber, [class*='firma']")?.innerText?.trim();
        addCard(el, link, link.getAttribute("href"), title, company);
      }
    }

    // 7. LinkedIn: .jobs-search__results-list li, .base-card, .job-search-card, li.ember-view[data-occludable-job-id]
    const linkedinCards = document.querySelectorAll(
      ".jobs-search__results-list li, .base-card, .job-search-card, li.ember-view[data-occludable-job-id]"
    );
    for (const el of linkedinCards) {
      if (isNavigationOrFooter(el)) continue;
      const link = el.querySelector("a[href*='/jobs/view/'], a.base-card__full-link, a");
      if (link && link.getAttribute("href")) {
        const title = el.querySelector(".base-search-card__title, h3, h4")?.innerText?.trim();
        const company = el.querySelector(".base-search-card__subtitle, .job-search-card__location, h4")?.innerText?.trim();
        addCard(el, link, link.getAttribute("href"), title, company);
      }
    }

    // 8. ATS Platforms: Greenhouse, Lever, Workday, SmartRecruiters, Jobvite
    const atsCards = document.querySelectorAll(
      ".opening, .posting, [data-automation-id*='compositeHeader'], .opening-job, [data-qa='job-opening']"
    );
    for (const el of atsCards) {
      if (isNavigationOrFooter(el)) continue;
      const link = el.querySelector("a[href*='jobs.'], a[href*='boards.'], a[href*='myworkdayjobs.com'], a[href*='greenhouse.io'], a[href*='lever.co'], a");
      if (link && link.getAttribute("href")) {
        const title = el.querySelector("h3, h4, a, .posting-title, [data-automation-id='jobTitle']")?.innerText?.trim();
        const loc = el.querySelector(".location, .workplaceTypes, [data-automation-id*='location']")?.innerText?.trim();
        addCard(el, link, link.getAttribute("href"), title, loc);
      }
    }

    // 9. Glassdoor, ZipRecruiter, Xing
    const otherCards = document.querySelectorAll(
      "[data-test='jobListing'], .react-job-listing, .job_content, article[data-qa*='job-search-result'], article[id*='job_']"
    );
    for (const el of otherCards) {
      if (isNavigationOrFooter(el)) continue;
      const link = el.querySelector("a[href*='/job/'], a[href*='/partner/jobListing'], a[href*='/jobs/'], a");
      if (link && link.getAttribute("href")) {
        const title = el.querySelector("h2, h3, a")?.innerText?.trim();
        const company = el.querySelector("[class*='Employer'], [class*='company']")?.innerText?.trim();
        addCard(el, link, link.getAttribute("href"), title, company);
      }
    }

    // 8. Generic Career Board Job Cards (Strictly Non-Navigation)
    const genericCards = document.querySelectorAll(
      "article, [class*='job-card'], [class*='JobCard'], [class*='jobCard'], [class*='job-item'], [class*='job-listing']"
    );
    for (const el of genericCards) {
      if (isNavigationOrFooter(el)) continue;
      const link = el.querySelector("a[href*='/job'], a[href*='/career'], a[href*='/position'], a[href*='/detail'], a[href*='/stellenangebot'], a");
      if (link && link.getAttribute("href")) {
        const title = el.querySelector("h1, h2, h3, h4, a")?.innerText?.trim();
        const company = el.querySelector("[class*='company'], [class*='employer'], [class*='organization']")?.innerText?.trim();
        addCard(el, link, link.getAttribute("href"), title, company);
      }
    }

    // 9. Broad fallback: Scan links matching job keywords strictly outside header/menu/navigation
    if (cards.length === 0) {
      const mainContainers = document.querySelectorAll("main, [role='main'], #main, .main, [data-locator-id*='joblisting'], #jobsearch-Main, body");
      const targetContainer = mainContainers.length > 0 ? mainContainers[0] : document.body;
      const allLinks = targetContainer.querySelectorAll("a[href]");
      const jobUrlPatterns = [
        "/job/", "/jobs/", "/stellenangebot", "/stellenangebote",
        "/career/", "/careers/", "/position/", "/positions/",
        "/detail/", "/opening/", "/posting/", "/viewjob", "jk="
      ];
      for (const a of allLinks) {
        if (isNavigationOrFooter(a)) continue;

        const href = a.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;

        // Skip root search URLs
        if (href === "/jobs/" || href === "/jobs" || href === "/career" || href === "/careers") continue;

        const isMatch = jobUrlPatterns.some(p => href.toLowerCase().includes(p));
        if (isMatch) {
          const title = (a.innerText || a.textContent || "").trim();
          if (title && title.length > 3 && title.length < 150) {
            addCard(a.closest("li, tr, div, article") || a, a, href, title, null);
          }
        }
      }
    }

    return cards;
  }

  function extractTextFromElement(el) {
    if (!el) return "";
    return el.innerText || el.textContent || "";
  }

  /**
   * Universal In-Page Job Scanner:
   * Inspects job roles across ANY job portal one by one:
   * "go inside the job posting, search emails, if not there come out,
   * go to another job post, same process, don't change the pages".
   */
  async function startInPageScan(options = {}) {
    const delayMs = Number(options.delayMs) || 1200;
    const maxJobs = Number(options.maxJobs) || 50;

    window.__hrInPageScanState = {
      status: "running",
      currentIndex: 0,
      totalJobs: 0,
      savedCount: 0,
      currentJobTitle: "",
      currentCompany: ""
    };

    const cards = detectJobCards();
    const total = Math.min(cards.length, maxJobs);
    window.__hrInPageScanState.totalJobs = total;

    const hud = getOrCreateHud();
    const titleEl = hud.querySelector("#__hr_hud_title");
    const statusEl = hud.querySelector("#__hr_hud_status");
    const progressEl = hud.querySelector("#__hr_hud_progress");
    const countsEl = hud.querySelector("#__hr_hud_counts");
    const savedEl = hud.querySelector("#__hr_hud_saved");

    if (total === 0) {
      statusEl.textContent = "No job cards detected on this page. Navigate to any job search or listing page on StepStone, Naukri, Monster, Indeed, etc., and try again!";
      return { ok: false, message: "No job cards found" };
    }

    statusEl.innerHTML = `Found <b>${total}</b> job roles on this portal. Checking each inside without leaving this page...`;

    for (let i = 0; i < total; i++) {
      if (window.__hrInPageScanState.status === "stopped") {
        statusEl.textContent = `Inspection stopped after ${i} jobs.`;
        break;
      }

      while (window.__hrInPageScanState.status === "paused") {
        await new Promise(r => setTimeout(r, 400));
        if (window.__hrInPageScanState.status === "stopped") break;
      }
      if (window.__hrInPageScanState.status === "stopped") break;

      const card = cards[i];
      window.__hrInPageScanState.currentIndex = i + 1;

      // Progress bar and counts
      const pct = Math.round(((i + 1) / total) * 100);
      progressEl.style.width = `${pct}%`;
      countsEl.textContent = `Inspected: ${i + 1} / ${total}`;

      // Highlight active card on the user's screen
      try {
        card.element.scrollIntoView({ behavior: "smooth", block: "center" });
        card.element.style.transition = "outline 0.3s ease";
        card.element.style.outline = "3px solid #2563eb";
      } catch (e) {}

      let preliminaryTitle = card.titleHint || "Job Role";
      statusEl.innerHTML = `[${i + 1}/${total}] Opening & analyzing: <b>"${escapeHtml(preliminaryTitle.slice(0, 32))}"</b><br><span style="color:#38bdf8; font-size:11px;">🔍 Reading job requirements & checking for direct application email...</span>`;

      let emails = [];
      let jobTitle = card.titleHint || "Job Posting";
      let companyName = card.companyHint || null;
      let contactName = null;
      let jobReqSnippet = null;

      // 1. Check if the portal has an in-page pane (like Indeed split-pane)
      const detailPane = document.querySelector(
        "#jobsearch-ViewjobPaneWrapper, #vjs-container, .jobsearch-RightPane, [data-testid='jobsearch-ViewjobPaneWrapper'], .job-detail-preview"
      );

      if (detailPane) {
        try {
          card.clickable.click();
        } catch (e) {}
        await new Promise(r => setTimeout(r, delayMs));
        await expandHiddenContent();

        jobReqSnippet = extractJobRequirements(detailPane);
        const directFromPane = extractDirectApplyEmails(jobReqSnippet, detailPane.innerHTML);
        if (directFromPane.length > 0) emails = [...directFromPane];

        const paneEmails = extractEmailsFromElement(detailPane);
        if (paneEmails.length > 0) emails = [...emails, ...paneEmails];

        const paneContact = extractContactName();
        if (paneContact) contactName = paneContact;

        const pTitle = detailPane.querySelector('[data-testid="jobsearch-JobInfoHeader-title"], h1')?.innerText?.trim();
        if (pTitle) jobTitle = pTitle;

        const pComp = detailPane.querySelector('[data-testid="inlineHeader-companyName"], [data-company-name="true"], .companyName')?.innerText?.trim();
        if (pComp) companyName = pComp;
      }

      // 2. Universal Headless Inspection:
      // Fetches the full job page HTML in the background without navigating the active tab!
      if (emails.length === 0 && card.url) {
        try {
          const fetchRes = await fetch(card.url, { credentials: "include" });
          if (fetchRes.ok) {
            const html = await fetchRes.text();
            const doc = new DOMParser().parseFromString(html, "text/html");

            // Extract job requirements and direct applying emails
            jobReqSnippet = extractJobRequirements(doc);
            const directEmails = extractDirectApplyEmails(jobReqSnippet, html);
            if (directEmails.length > 0) {
              emails = [...directEmails];
            }

            // A. Check JSON-LD metadata for JobPosting
            const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
            for (const script of scripts) {
              try {
                const data = JSON.parse(script.innerText);
                const items = Array.isArray(data) ? data : [data];
                for (const item of items) {
                  if (item["@type"] === "JobPosting") {
                    if (item.title && (!jobTitle || jobTitle === "Job Role")) jobTitle = item.title;
                    if (item.hiringOrganization) {
                      companyName = typeof item.hiringOrganization === "object" ? item.hiringOrganization.name : item.hiringOrganization;
                    }
                    if (item.description) {
                      const descEmails = extractEmailsFromText(item.description);
                      if (descEmails.length > 0) emails = [...emails, ...descEmails];
                      const descContact = extractContactNameFromRaw(item.description);
                      if (descContact && !contactName) contactName = descContact;
                    }
                  }
                }
              } catch (e) {}
            }

            // A2. Check Next.js / embedded framework state (Randstad, Modern Portals)
            try {
              const consultantEmailM = html.match(/(?:\\"|"|')emailAddress(?:\\"|"|')\s*:\s*(?:\\"|"|')([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,7})(?:\\"|"|')/i);
              if (consultantEmailM && consultantEmailM[1] && isValidScrapedEmail(consultantEmailM[1])) {
                emails.unshift({ email: consultantEmailM[1].toLowerCase(), type: "direct_apply" });
              }

              const consultantNameM = html.match(/(?:\\"|"|')fullName(?:\\"|"|')\s*:\s*(?:\\"|"|')([A-Za-z\s.]{3,40})(?:\\"|"|')/i);
              if (consultantNameM && consultantNameM[1] && consultantNameM[1] !== "null" && !contactName) {
                contactName = consultantNameM[1].trim();
              }

              const clientM = html.match(/(?:\\"|"|')clientDetail(?:\\"|"|')\s*:\s*\{[^}]*(?:\\"|"|')name(?:\\"|"|')\s*:\s*(?:\\"|"|')([^\\"]+)(?:\\"|"|')/i) ||
                              html.match(/(?:\\"|"|')clientName(?:\\"|"|')\s*:\s*(?:\\"|"|')([^\\"]+)(?:\\"|"|')/i);
              if (clientM && clientM[1] && clientM[1] !== "null" && (!companyName || companyName.startsWith("Randstad"))) {
                companyName = clientM[1].trim();
              }

              const jobTitleM = html.match(/(?:\\"|"|')jobTitle(?:\\"|"|')\s*:\s*(?:\\"|"|')([^\\"]+)(?:\\"|"|')/i);
              if (jobTitleM && jobTitleM[1] && (!jobTitle || jobTitle === "Job Role" || jobTitle === "Job Posting")) {
                jobTitle = jobTitleM[1].trim();
              }
            } catch (e) {}

            // B. Check all mailto links and visible body text in the parsed document
            const docEmails = extractEmailsFromElement(doc.body);
            if (docEmails.length > 0) {
              emails = [...emails, ...docEmails];
            }

            // C. Check contact person in document text
            if (!contactName && doc.body) {
              contactName = extractContactNameFromRaw(doc.body.innerText);
            }

            // D. Fallback title and company from document
            const randstadTitle = doc.querySelector("[data-locator-id='jobdetails_applyjobs_jobtitle'], [data-locator-id*='jobtitle']");
            if (randstadTitle && randstadTitle.innerText.trim() && (!jobTitle || jobTitle === "Job Role" || jobTitle === "Job Posting")) {
              jobTitle = randstadTitle.innerText.trim().split("\n")[0];
            } else if (!jobTitle || jobTitle === "Job Role") {
              const h1 = doc.querySelector("h1, [class*='job-title'], [class*='jobTitle']");
              if (h1 && h1.innerText.trim()) jobTitle = h1.innerText.trim().split("\n")[0];
            }

            const randstadCompany = doc.querySelector("[data-locator-id='jobdetails_summary_clientname'], [data-locator-id*='clientname']");
            if (randstadCompany && randstadCompany.innerText.trim() && (!companyName || companyName.startsWith("Randstad"))) {
              companyName = randstadCompany.innerText.trim().split("\n")[0];
            } else if (!companyName) {
              const compEl = doc.querySelector("[class*='company'], [class*='employer'], [class*='organization']");
              if (compEl && compEl.innerText.trim()) companyName = compEl.innerText.trim().split("\n")[0];
            }
          }
        } catch (fetchErr) {
          // If background fetch failed due to portal firewall, continue
        }
      }

      // Deduplicate discovered emails and prioritize application/recruiter emails over generic legal notices
      const rawUniqueEmails = [];
      const seenSet = new Set();
      for (const em of emails) {
        const address = (typeof em === "string" ? em : em.email).toLowerCase().trim();
        if (address && !seenSet.has(address)) {
          seenSet.add(address);
          rawUniqueEmails.push({
            email: address,
            type: typeof em === "object" && em.type ? em.type : classifyEmail(address)
          });
        }
      }

      // Filter out legal/compliance notice emails if application/HR emails exist
      const filteredEmails = rawUniqueEmails.filter(e => {
        const addr = e.email;
        if (addr.includes("dpis.india") || addr.includes("dataprotection") || addr.includes("privacy@") || addr.includes("dpo@")) {
          return false;
        }
        return true;
      });
      const uniqueEmails = filteredEmails.length > 0 ? filteredEmails : rawUniqueEmails;

      // 3. "If you get it save it"
      if (uniqueEmails.length > 0) {
        const firstEmail = uniqueEmails[0];
        const isDirect = firstEmail.type === "direct_apply";
        const contactsToSave = [{
          company_name: companyName,
          contact_name: contactName,
          job_title: jobTitle,
          email: firstEmail.email,
          email_type: isDirect ? "direct_apply" : firstEmail.type,
          source_url: card.url,
          source_domain: window.location.hostname.replace(/^www\./, ""),
          verification_status: "unverified",
          reviewed: false,
          notes: jobReqSnippet ? `Direct apply email in requirements: ${jobReqSnippet.slice(0, 100)}...` : `Extracted via In-Page Scanner on ${window.location.hostname}`
        }];

        try {
          await fetch("http://127.0.0.1:8000/api/contacts/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contacts: contactsToSave })
          });

          window.__hrInPageScanState.savedCount++;
          savedEl.textContent = `Saved: ${window.__hrInPageScanState.savedCount} HR emails`;
          statusEl.innerHTML = `<span style="color:#4ade80; font-weight:bold;">✓ Direct Apply Email Found:</span> <b>${escapeHtml(firstEmail.email)}</b> (${escapeHtml(companyName || 'Company')})<br><span style="color:#94a3b8; font-size:11px;">Proceeding to next job post...</span>`;
          card.element.style.outline = "3px solid #22c55e";

          // Add visual badge directly on the job card
          let badge = card.element.querySelector(".__hr_saved_badge");
          if (!badge) {
            badge = document.createElement("span");
            badge.className = "__hr_saved_badge";
            badge.style = "background:#dcfce7; color:#15803d; font-size:11px; font-weight:bold; padding:2px 8px; border-radius:4px; margin-top:6px; display:inline-block;";
            badge.textContent = `✓ Direct Apply: ${firstEmail.email}`;
            card.element.appendChild(badge);
          }
        } catch (err) {
          statusEl.textContent = `Found: ${firstEmail.email} (failed syncing API: ${err.message})`;
        }
      } else {
        // "if not there come outside , then go to another job role"
        statusEl.innerHTML = `<span style="color:#94a3b8;">No direct email in requirements for "${escapeHtml(jobTitle.slice(0, 25))}" — moving to next job...</span>`;
        card.element.style.outline = "1px dashed #64748b";
      }

      // Small pause between jobs
      await new Promise(r => setTimeout(r, 500));
    }

    window.__hrInPageScanState.status = "completed";
    progressEl.style.width = "100%";
    statusEl.innerHTML = `<b>✓ Finished inspecting page!</b> Saved <b>${window.__hrInPageScanState.savedCount}</b> HR contact(s) across all inspected roles without leaving this page.`;
    titleEl.textContent = "Scan Complete";
    return { ok: true, saved: window.__hrInPageScanState.savedCount };
  }

  function extractEmailsFromText(rawText) {
    if (!rawText) return [];
    const found = new Set();
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,7}\b/gi;
    const matches = rawText.match(emailRegex);
    if (matches) {
      for (const m of matches) {
        const cl = cleanRawEmail(m);
        if (isValidScrapedEmail(cl)) found.add(cl);
      }
    }
    return Array.from(found).map(e => ({ email: e, type: classifyEmail(e) }));
  }

  function extractContactNameFromRaw(text) {
    if (!text) return null;
    const labelPatterns = [
      /(?:posted\s+by(?:\s+recruiter)?|hiring\s+manager|job\s+poster|recruiter|hr\s+executive|talent\s+acquisition|hr\s+manager)\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i,
      /(?:contact\s*(?:person)?|reach\s+out\s+to|queries\s+to|send\s+(?:your\s+)?(?:resume|cv)\s+to)\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i,
      /(?:ihr(?:e)?\s+)?ansprechpartner(?:in)?\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i,
      /(?:ihr(?:e)?\s+)?kontakt(?:person)?\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i,
      /bewerbung(?:en)?\s+an\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i,
      /zuständig(?:er|e)?\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i
    ];
    for (const pat of labelPatterns) {
      const match = text.match(pat);
      if (match && match[1]) {
        let name = match[1].trim().split("\n")[0].split(",")[0].trim();
        name = name.replace(/^(Mr\.|Mrs\.|Ms\.|Frau|Herr|Dr\.|Prof\.)\s*/i, "$1 ");
        if (isValidContactPersonName(name)) {
          return name;
        }
      }
    }
    return null;
  }

  function extractEmailsFromElement(containerEl) {
    if (!containerEl) return [];
    const found = new Set();
    const emailRegex = /\b[A-Za-z0-9._%+-]+(?:@|\[at\]|\(at\))[A-Za-z0-9.-]+\.[A-Za-z]{2,7}\b/gi;

    // Scan mailto
    const mailtos = containerEl.querySelectorAll('a[href^="mailto:"]');
    for (const a of mailtos) {
      const cl = cleanRawEmail(a.getAttribute("href"));
      if (isValidScrapedEmail(cl)) found.add(cl);
    }

    // Scan text
    const text = containerEl.innerText || containerEl.textContent || "";
    const matches = text.match(emailRegex);
    if (matches) {
      for (const m of matches) {
        const cl = cleanRawEmail(m);
        if (isValidScrapedEmail(cl)) found.add(cl);
      }
    }

    return Array.from(found).map(e => ({ email: e, type: classifyEmail(e) }));
  }

  // Listen for messages from popup or background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "EXTRACT_PAGE" || request.action === "ANALYZE_PAGE") {
      analyzeCurrentPage().then(result => sendResponse(result));
      return true;
    }

    if (request.action === "DETECT_JOB_CARDS") {
      try {
        const rawCards = detectJobCards();
        const cleanCards = rawCards.map(c => ({
          url: c.url,
          title: c.titleHint || "",
          company: c.companyHint || ""
        }));
        sendResponse({ ok: true, cards: cleanCards, count: cleanCards.length });
      } catch (err) {
        sendResponse({ ok: false, error: err.message, cards: [] });
      }
      return true;
    }

    if (request.action === "START_INPAGE_SCAN") {
      startInPageScan(request.options || {}).then(res => sendResponse(res));
      return true;
    }

    if (request.action === "PAUSE_INPAGE_SCAN") {
      if (window.__hrInPageScanState) window.__hrInPageScanState.status = "paused";
      sendResponse({ ok: true, state: window.__hrInPageScanState });
      return true;
    }

    if (request.action === "RESUME_INPAGE_SCAN") {
      if (window.__hrInPageScanState) window.__hrInPageScanState.status = "running";
      sendResponse({ ok: true, state: window.__hrInPageScanState });
      return true;
    }

    if (request.action === "STOP_INPAGE_SCAN") {
      if (window.__hrInPageScanState) window.__hrInPageScanState.status = "stopped";
      sendResponse({ ok: true, state: window.__hrInPageScanState });
      return true;
    }

    if (request.action === "GET_INPAGE_STATUS") {
      sendResponse({ ok: true, state: window.__hrInPageScanState });
      return true;
    }

    return true;
  });

  // Expose on window for direct script execution via scripting API
  window.__hrContactAgentAnalyze = analyzeCurrentPage;
  window.__hrContactAgentScanPage = startInPageScan;
})();
