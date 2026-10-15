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
   * Check compliance limitations (e.g., LinkedIn automated scraping is disabled).
   */
  function checkComplianceRestrictions() {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname.includes("linkedin.com")) {
      return {
        blocked: true,
        reason: "LinkedIn automated collection is intentionally disabled per compliance and terms of service rules."
      };
    }
    return { blocked: false };
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
   * Infer Job Title using DOM selectors, meta tags, and heuristics
   */
  function extractJobTitle(jsonLd) {
    if (jsonLd.title && jsonLd.title.trim()) {
      return jsonLd.title.trim();
    }

    const titleSelectors = [
      '[data-qa="job-title"]',
      '.jobsearch-JobInfoHeader-title',
      '.job-title',
      '[class*="job-title"]',
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
      '[data-qa="company-name"]',
      '.jobsearch-InlineCompanyRating div',
      '.company-name',
      '[class*="company-name"]',
      '[data-company-name="true"]',
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

  /**
   * Detect Contact Person Name using German & English recruiting labels
   */
  function extractContactName() {
    const labelPatterns = [
      /(?:ihr(?:e)?\s+)?ansprechpartner(?:in)?\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i,
      /(?:ihr(?:e)?\s+)?kontakt(?:person)?\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i,
      /bewerbung(?:en)?\s+an\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i,
      /zuständig(?:er|e)?\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i,
      /recruiter\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i,
      /contact\s*(?:person)?\s*[:\-]?\s*([A-Za-zÄÖÜäöüß.\s]{3,40})/i
    ];

    // German honorific pattern
    const honorificPattern = /(?:Frau|Herr|Dr\.|Prof\.)\s+[A-ZÄÖÜ][a-zäöüß]+\s+[A-ZÄÖÜ][a-zäöüß]+/g;

    const bodyText = document.body ? document.body.innerText : "";

    for (const pat of labelPatterns) {
      const match = bodyText.match(pat);
      if (match && match[1]) {
        let name = match[1].trim().split("\n")[0].split(",")[0].trim();
        name = name.replace(/^(Frau|Herr|Dr\.|Prof\.)\s*/, "$1 ");
        if (name.length > 3 && name.length < 50 && !name.toLowerCase().includes("email")) {
          return name;
        }
      }
    }

    // Try honorific matching in visible text
    const honorificMatches = bodyText.match(honorificPattern);
    if (honorificMatches && honorificMatches.length > 0) {
      const candidate = honorificMatches[0].trim();
      if (candidate.length > 4 && candidate.length < 40) {
        return candidate;
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

    return Array.from(found);
  }

  function isValidScrapedEmail(email) {
    if (!email || email.length < 5 || email.length > 100 || !email.includes("@")) {
      return false;
    }
    for (const ext of INVALID_EXTENSIONS) {
      if (email.endsWith(ext)) return false;
    }
    // Simple structural regex
    const validPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,7}$/;
    if (!validPattern.test(email)) return false;

    // Skip generic placeholder emails
    const placeholders = ["yourname@domain.com", "email@example.com", "name@domain.de", "test@test.de"];
    if (placeholders.includes(email.toLowerCase())) return false;

    return true;
  }

  /**
   * Classify email type as 'generic' or 'person_or_other'
   */
  function classifyEmail(email) {
    const local = email.split("@")[0].toLowerCase();
    for (const prefix of GENERIC_PREFIXES) {
      if (local === prefix || local.startsWith(prefix + ".") || local.startsWith(prefix + "-") || local.startsWith(prefix + "_")) {
        return "generic";
      }
    }
    return "person_or_other";
  }

  /**
   * Find matching same-origin links relevant to job / career listings
   */
  function extractSameOriginLinks() {
    const currentOrigin = window.location.origin;
    const linksSet = new Set();
    const allAnchors = document.querySelectorAll("a[href]");

    const jobKeywords = [
      "job", "stellenangebot", "karriere", "career", "position",
      "detail", "angebot", "kontakt", "recruiting", "work-with-us"
    ];

    for (const a of allAnchors) {
      try {
        const href = a.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) {
          continue;
        }

        const fullUrl = new URL(href, window.location.href);
        if (fullUrl.origin === currentOrigin) {
          const cleanUrl = fullUrl.origin + fullUrl.pathname + fullUrl.search;
          const pathLower = cleanUrl.toLowerCase();

          // Prioritize relevant job paths
          const isRelevant = jobKeywords.some(kw => pathLower.includes(kw));
          if (isRelevant && cleanUrl !== window.location.href) {
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
   */
  function analyzeCurrentPage() {
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

    const jsonLd = extractJsonLd();
    const jobTitle = extractJobTitle(jsonLd);
    const companyName = extractCompanyName(jsonLd);
    const contactName = extractContactName();
    const rawEmails = extractEmails();
    const sameOriginLinks = extractSameOriginLinks();

    const emails = rawEmails.map(email => ({
      email: email,
      type: classifyEmail(email)
    }));

    return {
      success: true,
      blocked: false,
      data: {
        page_title: document.title,
        job_title: jobTitle,
        company_name: companyName,
        contact_name: contactName,
        emails: emails,
        source_url: window.location.href,
        source_domain: window.location.hostname.replace(/^www\./, ""),
        same_origin_links: sameOriginLinks
      }
    };
  }

  // Listen for messages from popup or background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "EXTRACT_PAGE" || request.action === "ANALYZE_PAGE") {
      const result = analyzeCurrentPage();
      sendResponse(result);
    }
    return true; // Keep message channel open for async response
  });

  // Expose on window for direct script execution via scripting API
  window.__hrContactAgentAnalyze = analyzeCurrentPage;
})();
