import re
from urllib.parse import urlparse
from typing import Optional, Tuple

# Regex for standard email syntax validation
EMAIL_REGEX = re.compile(
    r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$"
)

# Common generic inbox prefixes in German and English job portals
GENERIC_PREFIXES = {
    "info", "kontakt", "contact", "karriere", "career", "careers", "jobs", "job",
    "bewerbung", "bewerbungen", "bewerber", "hr", "recruiting", "talent", "team",
    "office", "mail", "support", "service", "hello", "hallo", "personal", "arbeit",
    "presse", "press", "marketing", "sales", "admin", "poststelle", "empfang",
    "zentrale", "anfragen", "inquiry", "general", "desk", "feedback", "kundenservice",
    "personalabteilung", "humanresources", "people"
}

# Invalid extensions or dummy patterns often mistakenly scraped as emails
INVALID_EMAIL_EXTENSIONS = (
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
    ".js", ".css", ".map", ".woff", ".woff2", ".ttf", ".eot",
    ".pdf", ".zip", ".tar", ".gz"
)

def normalize_email(email_raw: str) -> str:
    """
    Normalizes an email address:
    - Removes 'mailto:' prefix
    - Strips whitespace and invisible chars
    - De-obfuscates patterns like '[at]', '(at)', ' [at] '
    - Strips surrounding quotes, trailing dots, commas, semicolons, brackets
    - Converts to lowercase
    """
    if not email_raw:
        return ""
    
    cleaned = email_raw.strip()
    
    # Strip mailto:
    if cleaned.lower().startswith("mailto:"):
        cleaned = cleaned[7:].strip()
        
    # Strip query parameters (e.g. ?subject=...)
    if "?" in cleaned:
        cleaned = cleaned.split("?")[0].strip()

    # De-obfuscate common web obfuscations
    cleaned = re.sub(r"\s*\[at\]\s*", "@", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*\(at\)\s*", "@", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+at\s+", "@", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.replace("&#64;", "@")
    cleaned = cleaned.replace("%40", "@")
    cleaned = re.sub(r"\s*\[dot\]\s*", ".", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*\(dot\)\s*", ".", cleaned, flags=re.IGNORECASE)

    # Strip surrounding whitespace and quotes
    cleaned = cleaned.strip(" '\"<>(),;:")
    
    return cleaned.lower()

def validate_email_syntax(email: str) -> bool:
    """
    Validates email syntax:
    - Matches standard email regex
    - Rejects invalid asset file extensions
    - Rejects strings without proper TLD or domain parts
    """
    if not email or len(email) > 254:
        return False
    
    norm = normalize_email(email)
    
    # Check invalid extensions in local part or domain
    lower_norm = norm.lower()
    for ext in INVALID_EMAIL_EXTENSIONS:
        if lower_norm.endswith(ext):
            return False
            
    if not EMAIL_REGEX.match(norm):
        return False
    
    # Verify domain part has at least one dot and a valid TLD
    parts = norm.split("@")
    if len(parts) != 2:
        return False
        
    domain = parts[1]
    if "." not in domain:
        return False
        
    tld = domain.split(".")[-1]
    if len(tld) < 2 or not tld.isalpha():
        return False
        
    return True

def classify_email_type(email: str) -> str:
    """
    Classifies email as 'generic' or 'person_or_other'.
    Checks the local part against German and English generic inbox patterns.
    """
    if not email:
        return "person_or_other"
        
    norm = normalize_email(email)
    local_part = norm.split("@")[0] if "@" in norm else norm
    
    # Split local part by dots, hyphens, pluses or underscores
    tokens = re.split(r"[._+\-]", local_part.lower())
    
    # Check exact match or token match
    for token in tokens:
        if token in GENERIC_PREFIXES:
            return "generic"
            
    # Check if local part starts with or contains any generic prefix
    for prefix in GENERIC_PREFIXES:
        if local_part.startswith(prefix):
            return "generic"
            
    return "person_or_other"

def extract_domain(url: str) -> str:
    """
    Extracts and normalizes the website domain from a given URL.
    Example: 'https://de.indeed.com/viewjob?jk=123' -> 'de.indeed.com'
    """
    if not url:
        return ""
    
    try:
        parsed = urlparse(url.strip())
        hostname = parsed.hostname or parsed.netloc or parsed.path
        if hostname:
            hostname = hostname.lower()
            if hostname.startswith("www."):
                hostname = hostname[4:]
            return hostname
    except Exception:
        pass
        
    return ""

def clean_contact_name(name_raw: Optional[str]) -> Optional[str]:
    """
    Cleans up inferred contact person names:
    - Strips label prefixes like 'Ansprechpartner:', 'Kontakt:', 'Bewerbung an'
    - Trims honorifics or normalizes them nicely
    """
    if not name_raw:
        return None
        
    cleaned = name_raw.strip()
    
    # Remove leading label keywords
    prefixes = [
        r"^posted\s+by(?:\s+recruiter)?\s*[:\-]?\s*",
        r"^hiring\s+manager\s*[:\-]?\s*",
        r"^job\s+poster\s*[:\-]?\s*",
        r"^talent\s+acquisition\s*[:\-]?\s*",
        r"^hr\s+executive\s*[:\-]?\s*",
        r"^hr\s+manager\s*[:\-]?\s*",
        r"^recruiter\s*[:\-]?\s*",
        r"^contact\s*(?:person)?\s*[:\-]?\s*",
        r"^reach\s+out\s+to\s*[:\-]?\s*",
        r"^queries\s+to\s*[:\-]?\s*",
        r"^(?:ihr(?:e)?\s+)?ansprechpartner(?:in)?\s*[:\-]?\s*",
        r"^(?:ihr(?:e)?\s+)?kontakt(?:person)?\s*[:\-]?\s*",
        r"^zuständig(?:er|e)?\s*[:\-]?\s*",
        r"^bewerbung(?:en)?\s+an\s*[:\-]?\s*"
    ]
    for pattern in prefixes:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE).strip()
        
    # Remove excessive whitespace
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,;:-|")
    
    return cleaned if len(cleaned) >= 2 else None
