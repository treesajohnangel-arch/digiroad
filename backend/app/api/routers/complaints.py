import uuid
import re
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from app.core.authentication import get_current_user, require_admin
from app.services.supabase_client import supabase
from app.schemas.complaint import (
    ComplaintStatus,
    ComplaintCreate,
    ComplaintResponse,
    ComplaintSchema,
    Complaint,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/complaints", tags=["Complaints"])


def normalize_segment_id(seg_id: str) -> str:
    """
    Normalizes road segment identifiers:
    e.g. 'MDR47 S01', 'MDR47_S01', 'mdr47-s01', 'MDR 47 S01' -> 'MDR47-S01'.
    Matches the primary key format in public.road_segments.
    """
    if not seg_id:
        return ""
    clean = seg_id.strip().upper().replace("_", "-")
    clean = re.sub(r"\s+", "-", clean)
    clean = re.sub(r"-+", "-", clean)
    if clean.startswith("MDR-47"):
        clean = "MDR47" + clean[6:]
    return clean


# Development-only demo data. Production requests read and write Supabase.
_now = datetime.now(timezone.utc)
IN_MEMORY_COMPLAINTS: List[Dict[str, Any]] = [
    {
        "complaint_id": "CMP-2418", "segment_id": "MDR47-S01", "complaint_heading": "Pothole",
        "description": "Deep pothole near the bus stop is forcing two-wheelers into traffic.",
        "status": "nil", "created_at": _now.isoformat(), "citizen_name": "Anjali Nair",
        "contact": "••••• 4821", "severity": "High", "repaired_at": None,
    },
    {
        "complaint_id": "CMP-2416", "segment_id": "MDR47-S02", "complaint_heading": "Surface damage",
        "description": "Loose aggregate and surface wear at the junction approach.",
        "status": "under process", "created_at": (_now - timedelta(days=1)).isoformat(),
        "citizen_name": "R. Suresh", "contact": "••••• 7104", "severity": "Medium", "repaired_at": None,
    },
    {
        "complaint_id": "CMP-2397", "segment_id": "MDR47-S03", "complaint_heading": "Drainage",
        "description": "Water collects along the curb after heavy rain.",
        "status": "repaired", "created_at": (_now - timedelta(days=9)).isoformat(),
        "citizen_name": "Meera Das", "contact": "••••• 2360", "severity": "Low",
        "repair_type": "FULL_RESURFACING", "repaired_at": (_now - timedelta(days=9)).isoformat(),
    },
]



@router.get("", response_model=List[ComplaintResponse])
async def get_all_complaints(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Retrieve all complaints across all statuses (nil, under process, repaired).
    Used by the Admin dashboard and Repaired history.
    """
    if supabase is not None:
        try:
            res = (
                supabase.table("user_complaints")
                .select("*")
                .order("created_at", desc=True)
                .execute()
            )
            records = res.data if res.data is not None else []
            for row in records:
                row["complaint_id"] = str(row.get("complaint_id"))
            return _redact_complaint_contacts(records, current_user)
        except Exception as e:
            logger.warning(f"Supabase query failed in get_all_complaints: {e}")
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not load complaints.") from e

    records = sorted(IN_MEMORY_COMPLAINTS, key=lambda x: str(x.get("created_at", "")), reverse=True)
    return _redact_complaint_contacts(records, current_user)


def _redact_complaint_contacts(records: List[Dict[str, Any]], current_user: Dict[str, Any]) -> List[Dict[str, Any]]:
    if current_user.get("role") == "admin":
        return records
    return [{**row, "citizen_name": None, "contact": None} for row in records]


@router.post("/generate", response_model=ComplaintResponse, status_code=status.HTTP_201_CREATED)
async def generate_complaint(complaint_in: ComplaintCreate):
    """
    Generate/Submit a new citizen or engineer road complaint.
    - Accepts segment_id (e.g. 'MDR47 S01' or 'MDR47-S01'), description, and optional complaint_heading.
    - Validates that description word count <= 100 words.
    - Normalizes segment ID to match database road_segments table.
    - Inserts record into Supabase table user_complaints with status as 'nil'.
    - Returns 201 Created with the inserted record.
    """
    target_segment = normalize_segment_id(complaint_in.segment_id)
    if not target_segment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="segment_id cannot be empty.",
        )

    words = complaint_in.description.strip().split()
    if len(words) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Description cannot be empty.",
        )
    if len(words) > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Description must not exceed 100 words. Provided: {len(words)} words.",
        )

    heading = complaint_in.complaint_heading.strip() if complaint_in.complaint_heading else "Road Complaint"
    now = datetime.now(timezone.utc).isoformat()
    generated_cmp_id = f"cmp-{uuid.uuid4().hex[:8]}"

    # Fallback in-memory record structure
    fallback_record: Dict[str, Any] = {
        "complaint_id": generated_cmp_id,
        "segment_id": target_segment,
        "complaint_heading": heading,
        "description": complaint_in.description.strip(),
        "status": "nil",
        "created_at": now,
        "repaired_at": None,
        "citizen_name": complaint_in.citizen_name,
        "contact": complaint_in.contact,
        "severity": complaint_in.severity,
    }

    if supabase is not None:
        try:
            db_payload = {
                "segment_id": target_segment,
                "complaint_heading": heading,
                "description": complaint_in.description.strip(),
                "status": "nil",
                "created_at": now,
                "repaired_at": None,
                "citizen_name": complaint_in.citizen_name,
                "contact": complaint_in.contact,
                "severity": complaint_in.severity,
            }
            res = supabase.table("user_complaints").insert(db_payload).execute()
            if res.data and len(res.data) > 0:
                created = res.data[0]
                created["complaint_id"] = str(created.get("complaint_id"))
                if complaint_in.citizen_name:
                    created["citizen_name"] = complaint_in.citizen_name
                if complaint_in.contact:
                    created["contact"] = complaint_in.contact
                if complaint_in.severity:
                    created["severity"] = complaint_in.severity
                IN_MEMORY_COMPLAINTS.insert(0, created)
                return created
        except Exception as e:
            err_msg = str(e)
            logger.warning(f"Supabase insert failed into user_complaints: {err_msg}")
            if "violates foreign key constraint" in err_msg or "is not present in table \"road_segments\"" in err_msg:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Road segment '{complaint_in.segment_id}' is not registered in the system.",
                )
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Complaint could not be saved to the database.") from e

        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="The database did not return the saved complaint.")

    IN_MEMORY_COMPLAINTS.insert(0, fallback_record)
    return fallback_record


@router.get("/under-process", response_model=List[ComplaintResponse])
async def get_under_process_complaints(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Retrieve all complaints currently under process/investigation.
    Queries Supabase table user_complaints for status = 'under process' or 'UNDER_PROCESS'.
    Complaints with status 'nil' are strictly EXCLUDED until admin assigns them.
    """
    if supabase is not None:
        try:
            res = (
                supabase.table("user_complaints")
                .select("*")
                .in_("status", ["under process", "UNDER_PROCESS"])
                .order("created_at", desc=True)
                .execute()
            )
            records = res.data if res.data is not None else []
            for row in records:
                row["complaint_id"] = str(row.get("complaint_id"))
            return _redact_complaint_contacts(records, current_user)
        except Exception as e:
            logger.warning(f"Supabase query failed in get_under_process_complaints: {e}")
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not load complaints in process.") from e

    under_process = [
        c for c in IN_MEMORY_COMPLAINTS
        if str(c.get("status", "")).lower() in ("under process", "under_process", "pending")
    ]
    records = sorted(under_process, key=lambda x: str(x.get("created_at", "")), reverse=True)
    return _redact_complaint_contacts(records, current_user)


@router.patch("/{complaint_id}/under-process", response_model=ComplaintResponse)
async def mark_complaint_under_process(complaint_id: str, _admin: Dict[str, Any] = Depends(require_admin)):
    """
    Admin updates a complaint from status 'nil' to 'under process'.
    Once marked as under process, it appears on the Home page under the 'under process' section.
    """
    updated_record: Optional[Dict[str, Any]] = None

    if supabase is not None:
        try:
            db_id = int(complaint_id) if complaint_id.isdigit() else complaint_id
            res = (
                supabase.table("user_complaints")
                .update({"status": "under process"})
                .eq("complaint_id", db_id)
                .eq("status", "nil")
                .execute()
            )
            if res.data and len(res.data) > 0:
                updated_record = res.data[0]
                updated_record["complaint_id"] = str(updated_record.get("complaint_id"))
            else:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only a new complaint can be moved to under process.")
        except Exception as e:
            if isinstance(e, HTTPException):
                raise
            logger.warning(f"Supabase update error for complaint under-process {complaint_id}: {e}")
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not update complaint status in the database.") from e

    if supabase is not None:
        if updated_record is not None:
            return updated_record
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Complaint with ID '{complaint_id}' not found.")

    # Synchronize in-memory development data
    for comp in IN_MEMORY_COMPLAINTS:
        if str(comp.get("complaint_id")) == complaint_id or str(comp.get("id")) == complaint_id:
            comp["status"] = "under process"
            if updated_record is None:
                updated_record = comp
            break

    if updated_record is not None:
        return updated_record

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Complaint with ID '{complaint_id}' not found.",
    )


@router.get("/repaired", response_model=List[ComplaintResponse])
async def get_repaired_complaints(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Retrieve all resolved / repaired complaints.
    Queries Supabase table user_complaints for status = 'REPAIRED' ordered by repaired_at desc.
    When 0 complaints are repaired, returns clean empty list [].
    Does NOT fall back to fake mock complaints.
    """
    if supabase is not None:
        try:
            res = (
                supabase.table("user_complaints")
                .select("*")
                .in_("status", ["repaired", "REPAIRED"])
                .order("repaired_at", desc=True)
                .execute()
            )
            records = res.data if res.data is not None else []
            for row in records:
                row["complaint_id"] = str(row.get("complaint_id"))
            return _redact_complaint_contacts(records, current_user)
        except Exception as e:
            logger.warning(f"Supabase query failed in get_repaired_complaints: {e}")
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not load repaired complaints.") from e

    repaired = [
        c for c in IN_MEMORY_COMPLAINTS
        if str(c.get("status", "")).lower() == "repaired"
    ]
    records = sorted(repaired, key=lambda x: str(x.get("repaired_at") or x.get("created_at") or ""), reverse=True)
    return _redact_complaint_contacts(records, current_user)


def _repaired_age_bucket(records: List[Dict[str, Any]], *, archived: bool) -> List[Dict[str, Any]]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    selected: List[Dict[str, Any]] = []
    for row in records:
        value = row.get("repaired_at")
        if not value:
            continue
        try:
            repaired_at = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if repaired_at.tzinfo is None:
                repaired_at = repaired_at.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            continue
        if (repaired_at < cutoff) == archived:
            row["complaint_id"] = str(row.get("complaint_id"))
            selected.append(row)
    return sorted(selected, key=lambda row: str(row.get("repaired_at") or ""), reverse=True)


async def _load_repaired_complaints() -> List[Dict[str, Any]]:
    if supabase is not None:
        try:
            res = (
                supabase.table("user_complaints")
                .select("*")
                .in_("status", ["repaired", "REPAIRED"])
                .order("repaired_at", desc=True)
                .execute()
            )
            return res.data or []
        except Exception as e:
            logger.warning(f"Supabase query failed loading repaired complaints: {e}")
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not load repaired complaints.") from e
    return [c for c in IN_MEMORY_COMPLAINTS if str(c.get("status", "")).lower() == "repaired"]


@router.get("/repaired/recent", response_model=List[ComplaintResponse])
async def get_recent_repaired_complaints(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Repaired complaints completed within the last seven days, for Home."""
    return _redact_complaint_contacts(_repaired_age_bucket(await _load_repaired_complaints(), archived=False), current_user)


@router.get("/repaired/history", response_model=List[ComplaintResponse])
async def get_repaired_complaint_history(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Repaired complaints completed more than seven days ago, for the archive."""
    return _redact_complaint_contacts(_repaired_age_bucket(await _load_repaired_complaints(), archived=True), current_user)


@router.patch(
    "/{complaint_id}/complete",
    response_model=ComplaintResponse,
    dependencies=[Depends(require_admin)],
)
async def complete_complaint(complaint_id: str):
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="A complaint cannot be marked repaired without recording its repair. Use the admin repair action with PATCHING or FULL_RESURFACING.",
    )
