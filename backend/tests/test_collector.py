import pytest
from app.collector import (
    normalize_email,
    validate_email_syntax,
    classify_email_type,
    extract_domain,
    clean_contact_name
)

def test_normalize_email():
    assert normalize_email("  HR@Example.DE  ") == "hr@example.de"
    assert normalize_email("mailto:recruiting@firma.de?subject=Bewerbung") == "recruiting@firma.de"
    assert normalize_email("karriere[at]company.com") == "karriere@company.com"
    assert normalize_email("info(at)berlin-jobs.de") == "info@berlin-jobs.de"
    assert normalize_email("  'contact@domain.de;'  ") == "contact@domain.de"

def test_validate_email_syntax():
    assert validate_email_syntax("info@stepstone.de") is True
    assert validate_email_syntax("hans.mueller@siemens.com") is True
    assert validate_email_syntax("karriere@arbeitsagentur.de") is True
    assert validate_email_syntax("invalid-email") is False
    assert validate_email_syntax("logo@company.png") is False
    assert validate_email_syntax("test@domain.js") is False
    assert validate_email_syntax("@no-local.com") is False
    assert validate_email_syntax("no-tld@domain") is False

def test_classify_email_type():
    # Generic inboxes (German & English)
    assert classify_email_type("info@firma.de") == "generic"
    assert classify_email_type("bewerbung@tech.de") == "generic"
    assert classify_email_type("karriere@hospital.org") == "generic"
    assert classify_email_type("recruiting@startup.io") == "generic"
    assert classify_email_type("hr@corporation.com") == "generic"
    assert classify_email_type("jobs@unternehmen.de") == "generic"
    assert classify_email_type("kontakt@agentur.de") == "generic"

    # Person or specific contacts
    assert classify_email_type("stefan.schmidt@firma.de") == "person_or_other"
    assert classify_email_type("claudia.weber@siemens.com") == "person_or_other"
    assert classify_email_type("m.mustermann@web.de") == "person_or_other"

def test_extract_domain():
    assert extract_domain("https://www.stepstone.de/jobs/developer") == "stepstone.de"
    assert extract_domain("https://de.indeed.com/viewjob?jk=abc12345") == "de.indeed.com"
    assert extract_domain("https://arbeitsagentur.de/jobsuche") == "arbeitsagentur.de"
    assert extract_domain("http://localhost:8000/docs") == "localhost"

def test_clean_contact_name():
    assert clean_contact_name("Ansprechpartner: Dr. Johannes Müller") == "Dr. Johannes Müller"
    assert clean_contact_name("Ihre Ansprechpartnerin: Frau Sabine Meyer") == "Frau Sabine Meyer"
    assert clean_contact_name("Kontakt: Herr Thomas Bauer") == "Herr Thomas Bauer"
    assert clean_contact_name("Recruiter: Michael Schmidt") == "Michael Schmidt"
    assert clean_contact_name(None) is None
    assert clean_contact_name(" ") is None
