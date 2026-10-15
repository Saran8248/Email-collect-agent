from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, func
from .database import Base

class Contact(Base):
    """
    Contact model representing stored company & HR contacts extracted from job portals.
    Matches Section 4 'Database Fields' specification.
    """
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    company_name = Column(String(255), nullable=True)
    contact_name = Column(String(255), nullable=True)
    job_title = Column(String(255), nullable=True)
    email = Column(String(255), nullable=False)
    email_normalized = Column(String(255), nullable=False, unique=True, index=True)
    source_url = Column(Text, nullable=False)
    source_domain = Column(String(255), nullable=False, index=True)
    verification_status = Column(String(50), nullable=False, default="unverified")  # unverified, verified, not_found, invalid
    email_type = Column(String(50), nullable=False, default="person_or_other")      # generic, person_or_other
    reviewed = Column(Boolean, nullable=False, default=False, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<Contact(id={self.id}, email='{self.email_normalized}', company='{self.company_name}')>"
