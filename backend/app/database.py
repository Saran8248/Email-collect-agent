import os
import logging
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker
from dotenv import load_dotenv

logger = logging.getLogger("hr_contact_agent.database")

# Load environment variables
load_dotenv()

DEFAULT_DB_URL = "postgresql+psycopg2://postgres:postgres@127.0.0.1:5432/hr_contacts"
SQLITE_FALLBACK_URL = "sqlite:///./hr_contacts.db"

DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DB_URL).strip()
# Ensure dialect driver compatibility for SQLAlchemy 2.0
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

def create_db_engine(url: str):
    connect_args = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        return create_engine(url, connect_args=connect_args)
    return create_engine(url, pool_pre_ping=True)

# Attempt to connect to the configured database, fallback to SQLite if PostgreSQL is unreachable
try:
    engine = create_db_engine(DATABASE_URL)
    # Test connection
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    logger.info(f"Connected to primary database: {DATABASE_URL.split('@')[-1] if '@' in DATABASE_URL else DATABASE_URL}")
except Exception as e:
    logger.warning(
        f"Could not connect to primary database ({DATABASE_URL}): {e}. "
        f"Falling back to local SQLite database: {SQLITE_FALLBACK_URL}"
    )
    DATABASE_URL = SQLITE_FALLBACK_URL
    engine = create_db_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    """Dependency that provides an active database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """Create all database tables."""
    Base.metadata.create_all(bind=engine)
