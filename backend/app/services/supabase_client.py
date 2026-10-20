import logging
from typing import Optional, Any

logger = logging.getLogger(__name__)

try:
    from app.database import supabase, get_db
    Client = Any
except Exception as e:
    logger.warning("Could not initialize Supabase from app.database: %s", e)
    supabase = None

    def get_db():
        raise RuntimeError("Supabase client is not configured.")


def get_supabase_client() -> Any:
    """Dependency or helper to retrieve the Supabase client."""
    if supabase is None:
        raise RuntimeError(
            "Supabase client is not configured. Please ensure valid SUPABASE_URL and SUPABASE_KEY in your .env file."
        )
    return supabase


__all__ = ["supabase", "get_supabase_client", "get_db"]

