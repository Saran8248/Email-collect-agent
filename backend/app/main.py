import io
import csv
import logging
from typing import Optional, List
from fastapi import FastAPI, Depends, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, desc, asc

from .database import get_db, init_db
from .models import Contact
from .schemas import (
    ContactCreate,
    ContactUpdate,
    ContactResponse,
    ContactBatchCreate,
    BatchResponse,
    StatsResponse,
    ContactListResponse,
    HealthResponse
)
from .collector import (
    normalize_email,
    validate_email_syntax,
    classify_email_type,
    extract_domain,
    clean_contact_name
)

from contextlib import asynccontextmanager

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("hr_contact_agent.api")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database tables on service startup."""
    try:
        init_db()
        logger.info("Database schema verified and ready.")
    except Exception as e:
        logger.error(f"Error during database initialization: {e}")
    yield

app = FastAPI(
    title="HR Contact Collection Agent API",
    description="FastAPI service for collecting, deduplicating, reviewing, and exporting HR contacts.",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for Chrome Extension, Dashboard (port 8080), and local origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health", response_model=HealthResponse, tags=["Health"])
def health_check():
    """
    Health check endpoint.
    Expected response: {"status": "ok", "service": "hr-contact-agent"}
    """
    return HealthResponse(status="ok", service="hr-contact-agent")

@app.post("/api/contacts", response_model=ContactResponse, status_code=status.HTTP_201_CREATED, tags=["Contacts"])
def create_or_upsert_contact(contact_in: ContactCreate, db: Session = Depends(get_db)):
    """
    Creates or updates an HR contact.
    Deduplication key is normalized lowercase email.
    """
    email_norm = normalize_email(contact_in.email)
    if not validate_email_syntax(email_norm):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid email syntax: {contact_in.email}"
        )
    
    domain = contact_in.source_domain or extract_domain(contact_in.source_url)
    email_type = contact_in.email_type or classify_email_type(email_norm)
    cleaned_name = clean_contact_name(contact_in.contact_name)

    existing = db.query(Contact).filter(Contact.email_normalized == email_norm).first()
    if existing:
        # Update existing contact with richer data if provided
        if contact_in.company_name and not existing.company_name:
            existing.company_name = contact_in.company_name
        elif contact_in.company_name:
            existing.company_name = contact_in.company_name

        if cleaned_name and not existing.contact_name:
            existing.contact_name = cleaned_name

        if contact_in.job_title and not existing.job_title:
            existing.job_title = contact_in.job_title

        if contact_in.notes:
            existing.notes = (existing.notes + "\n" + contact_in.notes) if existing.notes else contact_in.notes

        existing.source_url = contact_in.source_url
        existing.source_domain = domain
        existing.email = contact_in.email.strip()
        existing.email_type = email_type
        
        db.commit()
        db.refresh(existing)
        return existing

    new_contact = Contact(
        company_name=contact_in.company_name,
        contact_name=cleaned_name,
        job_title=contact_in.job_title,
        email=contact_in.email.strip(),
        email_normalized=email_norm,
        source_url=contact_in.source_url.strip(),
        source_domain=domain,
        verification_status=contact_in.verification_status or "unverified",
        email_type=email_type,
        reviewed=contact_in.reviewed or False,
        notes=contact_in.notes
    )
    db.add(new_contact)
    db.commit()
    db.refresh(new_contact)
    return new_contact

@app.post("/api/contacts/batch", response_model=BatchResponse, tags=["Contacts"])
def batch_upsert_contacts(batch_in: ContactBatchCreate, db: Session = Depends(get_db)):
    """
    Batch inserts or updates contacts from a crawler or bulk extraction.
    """
    inserted = 0
    updated = 0
    skipped = 0
    processed_contacts = []

    for item in batch_in.contacts:
        email_norm = normalize_email(item.email)
        if not validate_email_syntax(email_norm):
            skipped += 1
            continue

        domain = item.source_domain or extract_domain(item.source_url)
        email_type = item.email_type or classify_email_type(email_norm)
        cleaned_name = clean_contact_name(item.contact_name)

        existing = db.query(Contact).filter(Contact.email_normalized == email_norm).first()
        if existing:
            if item.company_name:
                existing.company_name = item.company_name
            if cleaned_name and not existing.contact_name:
                existing.contact_name = cleaned_name
            if item.job_title and not existing.job_title:
                existing.job_title = item.job_title
            existing.source_url = item.source_url
            existing.source_domain = domain
            updated += 1
            processed_contacts.append(existing)
        else:
            new_contact = Contact(
                company_name=item.company_name,
                contact_name=cleaned_name,
                job_title=item.job_title,
                email=item.email.strip(),
                email_normalized=email_norm,
                source_url=item.source_url.strip(),
                source_domain=domain,
                verification_status=item.verification_status or "unverified",
                email_type=email_type,
                reviewed=item.reviewed or False,
                notes=item.notes
            )
            db.add(new_contact)
            inserted += 1
            processed_contacts.append(new_contact)

    db.commit()
    for c in processed_contacts:
        db.refresh(c)

    return BatchResponse(
        total_submitted=len(batch_in.contacts),
        inserted=inserted,
        updated=updated,
        skipped=skipped,
        contacts=processed_contacts
    )

@app.get("/api/contacts", response_model=ContactListResponse, tags=["Contacts"])
def list_contacts(
    q: Optional[str] = Query(None, description="Search query across company, contact, job title, email, notes"),
    verification_status: Optional[str] = Query(None, description="Filter by status: unverified, verified, not_found, invalid"),
    email_type: Optional[str] = Query(None, description="Filter by email type: generic, person_or_other"),
    reviewed: Optional[bool] = Query(None, description="Filter by human reviewed flag"),
    source_domain: Optional[str] = Query(None, description="Filter by website domain"),
    sort_by: str = Query("created_at", description="Field to sort by: created_at, company_name, email, verification_status"),
    sort_order: str = Query("desc", description="asc or desc"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db)
):
    """
    List and filter contacts for the dashboard review interface.
    """
    query = db.query(Contact)

    if q:
        search_pattern = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Contact.company_name.ilike(search_pattern),
                Contact.contact_name.ilike(search_pattern),
                Contact.job_title.ilike(search_pattern),
                Contact.email.ilike(search_pattern),
                Contact.email_normalized.ilike(search_pattern),
                Contact.notes.ilike(search_pattern),
                Contact.source_domain.ilike(search_pattern),
            )
        )

    if verification_status:
        query = query.filter(Contact.verification_status == verification_status)

    if email_type:
        query = query.filter(Contact.email_type == email_type)

    if reviewed is not None:
        query = query.filter(Contact.reviewed == reviewed)

    if source_domain:
        query = query.filter(Contact.source_domain == source_domain)

    total = query.count()

    sort_column = getattr(Contact, sort_by, Contact.created_at)
    if sort_order.lower() == "asc":
        query = query.order_by(asc(sort_column))
    else:
        query = query.order_by(desc(sort_column))

    items = query.offset(offset).limit(limit).all()

    return ContactListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset
    )

@app.get("/api/contacts/{contact_id}", response_model=ContactResponse, tags=["Contacts"])
def get_contact(contact_id: int, db: Session = Depends(get_db)):
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact

@app.put("/api/contacts/{contact_id}", response_model=ContactResponse, tags=["Contacts"])
@app.patch("/api/contacts/{contact_id}", response_model=ContactResponse, tags=["Contacts"])
def update_contact(contact_id: int, update_in: ContactUpdate, db: Session = Depends(get_db)):
    """
    Update human review notes, verification status, contact details.
    """
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    update_data = update_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(contact, field, value)

    db.commit()
    db.refresh(contact)
    return contact

@app.delete("/api/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Contacts"])
def delete_contact(contact_id: int, db: Session = Depends(get_db)):
    """
    Delete a contact by ID.
    """
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.delete(contact)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@app.get("/api/stats", response_model=StatsResponse, tags=["Stats"])
def get_stats(db: Session = Depends(get_db)):
    """
    Get contact statistics for the dashboard cards.
    """
    total = db.query(Contact).count()
    verified = db.query(Contact).filter(Contact.verification_status == "verified").count()
    unverified = db.query(Contact).filter(Contact.verification_status == "unverified").count()
    invalid = db.query(Contact).filter(Contact.verification_status == "invalid").count()
    generic = db.query(Contact).filter(Contact.email_type == "generic").count()
    person = db.query(Contact).filter(Contact.email_type == "person_or_other").count()
    reviewed = db.query(Contact).filter(Contact.reviewed == True).count()
    domains_count = db.query(func.count(func.distinct(Contact.source_domain))).scalar() or 0

    return StatsResponse(
        total_contacts=total,
        verified_contacts=verified,
        unverified_contacts=unverified,
        invalid_contacts=invalid,
        generic_inboxes=generic,
        person_inboxes=person,
        reviewed_count=reviewed,
        unique_domains=domains_count
    )

@app.get("/api/domains", response_model=List[str], tags=["Stats"])
def list_domains(db: Session = Depends(get_db)):
    """
    List all unique source domains found in collected contacts.
    """
    domains = db.query(Contact.source_domain).distinct().order_by(Contact.source_domain).all()
    return [d[0] for d in domains if d[0]]

@app.get("/api/export.csv", tags=["Export"])
def export_contacts_csv(db: Session = Depends(get_db)):
    """
    Export all stored contact records into an RFC-4180 CSV file.
    URL matches Section 8: http://127.0.0.1:8000/api/export.csv
    """
    contacts = db.query(Contact).order_by(desc(Contact.created_at)).all()

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

    # Header
    writer.writerow([
        "ID",
        "Company Name",
        "Contact Person",
        "Job Title",
        "Email",
        "Normalized Email",
        "Source URL",
        "Source Domain",
        "Verification Status",
        "Email Type",
        "Reviewed",
        "Notes",
        "Created At",
        "Updated At"
    ])

    for c in contacts:
        writer.writerow([
            c.id,
            c.company_name or "",
            c.contact_name or "",
            c.job_title or "",
            c.email,
            c.email_normalized,
            c.source_url,
            c.source_domain,
            c.verification_status,
            c.email_type,
            "Yes" if c.reviewed else "No",
            c.notes or "",
            c.created_at.isoformat() if c.created_at else "",
            c.updated_at.isoformat() if c.updated_at else ""
        ])

    csv_content = output.getvalue()
    output.close()

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=hr_contacts_export.csv",
            "Cache-Control": "no-cache"
        }
    )
