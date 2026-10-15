from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime

class ContactBase(BaseModel):
    company_name: Optional[str] = Field(None, description="Company name inferred from visible page labels or metadata")
    contact_name: Optional[str] = Field(None, description="Contact person name when recognizable explicit label is present")
    job_title: Optional[str] = Field(None, description="Job posting title or page title")
    email: str = Field(..., description="Published email address")
    source_url: str = Field(..., description="Page URL where the record was discovered")
    source_domain: Optional[str] = Field(None, description="Normalized website domain")
    verification_status: Optional[str] = Field("unverified", description="unverified, verified, not_found, or invalid")
    email_type: Optional[str] = Field(None, description="generic or person_or_other")
    reviewed: Optional[bool] = Field(False, description="Human review status flag")
    notes: Optional[str] = Field(None, description="User notes or review remarks")

class ContactCreate(ContactBase):
    pass

class ContactUpdate(BaseModel):
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    job_title: Optional[str] = None
    verification_status: Optional[str] = None
    email_type: Optional[str] = None
    reviewed: Optional[bool] = None
    notes: Optional[str] = None

class ContactResponse(ContactBase):
    id: int
    email_normalized: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class ContactBatchCreate(BaseModel):
    contacts: List[ContactCreate]

class BatchResponse(BaseModel):
    total_submitted: int
    inserted: int
    updated: int
    skipped: int
    contacts: List[ContactResponse]

class StatsResponse(BaseModel):
    total_contacts: int
    verified_contacts: int
    unverified_contacts: int
    invalid_contacts: int
    generic_inboxes: int
    person_inboxes: int
    reviewed_count: int
    unique_domains: int

class ContactListResponse(BaseModel):
    items: List[ContactResponse]
    total: int
    limit: int
    offset: int

class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "hr-contact-agent"
