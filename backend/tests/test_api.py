import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import Base, get_db
from app.models import Contact
from sqlalchemy.pool import StaticPool

# Use an in-memory SQLite database with StaticPool for testing
TEST_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "hr-contact-agent"}

def test_create_and_deduplicate_contact():
    payload = {
        "company_name": "Tech Corp GmbH",
        "contact_name": "Herr Markus Berg",
        "job_title": "Senior Python Developer",
        "email": "karriere@techcorp.de",
        "source_url": "https://de.indeed.com/viewjob?jk=123",
        "notes": "Found on Indeed DE"
    }
    
    # 1. Create contact
    res = client.post("/api/contacts", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["email_normalized"] == "karriere@techcorp.de"
    assert data["email_type"] == "generic"
    assert data["source_domain"] == "de.indeed.com"
    assert data["contact_name"] == "Herr Markus Berg"

    # 2. Upsert with same normalized email but richer info
    payload_update = {
        "company_name": "Tech Corp GmbH & Co. KG",
        "contact_name": "Markus Berg",
        "job_title": "Lead Software Engineer",
        "email": "KARRIERE@techcorp.de",
        "source_url": "https://techcorp.de/careers",
        "notes": "Updated from direct career site"
    }
    res2 = client.post("/api/contacts", json=payload_update)
    assert res2.status_code == 201
    data2 = res2.json()
    assert data2["id"] == data["id"]
    assert data2["company_name"] == "Tech Corp GmbH & Co. KG"

def test_list_and_filter_contacts():
    res = client.get("/api/contacts?q=Tech")
    assert res.status_code == 200
    json_data = res.json()
    assert json_data["total"] >= 1
    assert any(c["company_name"].startswith("Tech") for c in json_data["items"])

def test_update_contact_review_and_status():
    # Fetch first contact
    list_res = client.get("/api/contacts")
    contact_id = list_res.json()["items"][0]["id"]

    # Update review and status
    patch_res = client.patch(
        f"/api/contacts/{contact_id}",
        json={"reviewed": True, "verification_status": "verified", "notes": "Manually verified"}
    )
    assert patch_res.status_code == 200
    updated = patch_res.json()
    assert updated["reviewed"] is True
    assert updated["verification_status"] == "verified"
    assert updated["notes"] == "Manually verified"

def test_stats_endpoint():
    res = client.get("/api/stats")
    assert res.status_code == 200
    stats = res.json()
    assert stats["total_contacts"] >= 1
    assert stats["verified_contacts"] >= 1
    assert stats["generic_inboxes"] >= 1

def test_export_csv():
    res = client.get("/api/export.csv")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert "hr_contacts_export.csv" in res.headers["content-disposition"]
    content = res.text
    assert "ID,Company Name,Contact Person,Job Title,Email" in content
    assert "karriere@techcorp.de" in content
