import base64
import binascii
import uuid
import re
import time
import logging
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from app.core.authentication import get_current_user, require_admin
from app.services.supabase_client import supabase
from app.schemas.complaint import (
    ComplaintStatus,
    ComplaintCreate,
    ComplaintFeedback,
    ComplaintPriority,
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


# In-memory fallback store, used only when Supabase is unavailable. Starts empty.
IN_MEMORY_COMPLAINTS: List[Dict[str, Any]] = []

# shortcut: per-process memory, resets on restart and is not shared between backends; move to Redis/DB if spam gets past it.
RATE_LIMIT_PER_HOUR = 5
_recent_submissions: Dict[str, deque] = defaultdict(deque)
CONTACT_RETENTION_DAYS = 180
PHOTO_BUCKET = "complaint-photos"
MAX_PHOTO_BYTES = 1_000_000


def _decode_photo(raw: str) -> tuple[bytes, str]:
    """Validate a base64 photo (plain or data URL). Returns (bytes, extension). Trust boundary: check size and magic bytes."""
    try:
        data = base64.b64decode(raw.split(",", 1)[-1], validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Photo is not valid base64.")
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Photo must be 1 MB or smaller.")
    if data.startswith(b"\xff\xd8\xff"):
        return data, "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return data, "png"
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Photo must be a JPEG or PNG image.")


def _upload_photo(raw: str) -> str:
    data, ext = _decode_photo(raw)
    if supabase is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Photo storage is not configured.")
    path = f"{uuid.uuid4().hex}.{ext}"  # random name: public bucket, so the URL must not be guessable
    try:
        supabase.storage.from_(PHOTO_BUCKET).upload(path, data, {"content-type": f"image/{'jpeg' if ext == 'jpg' else 'png'}"})
        return supabase.storage.from_(PHOTO_BUCKET).get_public_url(path)
    except Exception as e:
        logger.warning(f"Photo upload failed: {e}")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Photo could not be saved. Try again, or submit without a photo.") from e


SEVERITY_POINTS = {"low": 1, "medium": 2, "high": 3, "critical": 4}


def auto_priority(severity: Optional[str], heading: Optional[str], pci: Optional[float]) -> str:
    """P1 (urgent) to P4 (low) from reported severity, damage type and the road's current PCI."""
    score = SEVERITY_POINTS.get((severity or "").strip().lower(), 2)
    if pci is not None:
        score += 2 if pci < 40 else 1 if pci < 70 else 0
    if (heading or "").strip().lower() == "pothole":
        score += 1
    return "P1" if score >= 5 else "P2" if score == 4 else "P3" if score == 3 else "P4"


def _segment_pci(segment_id: str) -> Optional[float]:
    """Latest PCI for a segment (live evaluation first, survey baseline second); None if unknown."""
    if supabase is None:
        return None
    try:
        for table in ("dynamic_road_evaluations", "road_segments"):
            res = supabase.table(table).select("pci_score").eq("segment_id", segment_id).limit(1).execute()
            if res.data and res.data[0].get("pci_score") is not None:
                return float(res.data[0]["pci_score"])
    except Exception as e:
        logger.warning(f"PCI lookup failed for {segment_id}: {e}")
    return None


def _check_rate_limit(user_id: str) -> None:
    now = time.time()
    hits = _recent_submissions[user_id]
    while hits and now - hits[0] > 3600:
        hits.popleft()
    if len(hits) >= RATE_LIMIT_PER_HOUR:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many complaints in the last hour. Please try again later.")
    hits.append(now)


def redact_old_contacts(days: int = CONTACT_RETENTION_DAYS) -> int:
    """Retention rule: remove citizen name and contact from complaints repaired more than `days` ago."""
    if supabase is None:
        return 0
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    res = (
        supabase.table("user_complaints")
        .update({"citizen_name": None, "contact": None})
        .eq("status", "repaired")
        .lt("repaired_at", cutoff)
        .not_.is_("contact", "null")
        .execute()
    )
    return len(res.data or [])



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
async def generate_complaint(complaint_in: ComplaintCreate, current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Generate/Submit a new citizen or engineer road complaint.
    - Accepts segment_id (e.g. 'MDR47 S01' or 'MDR47-S01'), description, and optional complaint_heading.
    - Validates that description word count <= 100 words.
    - Normalizes segment ID to match database road_segments table.
    - Inserts record into Supabase table user_complaints with status as 'nil'.
    - Returns 201 Created with the inserted record.
    """
    if complaint_in.website:  # honeypot: hidden field only bots fill in
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Complaint rejected.")
    if (complaint_in.citizen_name or complaint_in.contact) and not complaint_in.consent:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please accept the privacy notice to share your name and contact.")
    _check_rate_limit(str(current_user.get("id")))

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
    photo_url = _upload_photo(complaint_in.photo_base64) if complaint_in.photo_base64 else None
    now = datetime.now(timezone.utc).isoformat()
    generated_cmp_id = f"cmp-{uuid.uuid4().hex[:8]}"
    priority = auto_priority(complaint_in.severity, heading, _segment_pci(target_segment))

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
        "priority": priority,
        "priority_source": "auto",
        "latitude": complaint_in.latitude,
        "longitude": complaint_in.longitude,
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
                "priority": priority,
                "priority_source": "auto",
            }
            if photo_url:  # only send the column when used, so old databases without it keep working
                db_payload["photo_url"] = photo_url
            if complaint_in.latitude is not None and complaint_in.longitude is not None:
                db_payload["latitude"] = complaint_in.latitude
                db_payload["longitude"] = complaint_in.longitude
            optional_cols = ("priority", "priority_source", "latitude", "longitude")
            try:
                res = supabase.table("user_complaints").insert(db_payload).execute()
            except Exception as e:
                if not any(c in str(e) for c in optional_cols):
                    raise
                # Database not migrated yet: save the complaint without the new columns rather than lose it.
                logger.warning(f"optional complaint columns missing, run the latest migrations: {e}")
                for c in optional_cols:
                    db_payload.pop(c, None)
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


@router.patch("/{complaint_id}/priority", response_model=ComplaintResponse)
async def set_complaint_priority(complaint_id: str, payload: ComplaintPriority, _admin: Dict[str, Any] = Depends(require_admin)):
    """Admin overrides the automatic priority."""
    if supabase is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database is not configured.")
    if not complaint_id.isdigit():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid complaint ID.")
    try:
        res = (
            supabase.table("user_complaints")
            .update({"priority": payload.priority, "priority_source": "admin"})
            .eq("complaint_id", int(complaint_id))
            .execute()
        )
    except Exception as e:
        logger.error("Priority update failed for %s: %s", complaint_id, e)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Priority could not be saved. The database needs the priority columns.") from e
    if not res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No complaint with ID {complaint_id}.")
    row = res.data[0]
    row["complaint_id"] = str(row.get("complaint_id"))
    return row


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


@router.get("/track/{complaint_id}")
async def track_complaint(complaint_id: str, _user: Dict[str, Any] = Depends(get_current_user)):
    """Status of one complaint, for the citizen following it up. No name or contact is returned."""
    if supabase is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database is not configured.")
    if not complaint_id.isdigit():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Complaint ID is a number, for example 27.")
    res = supabase.table("user_complaints").select("*").eq("complaint_id", int(complaint_id)).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No complaint with ID {complaint_id}.")
    row = res.data[0]
    keep = ("complaint_id", "segment_id", "complaint_heading", "description", "status", "severity",
            "created_at", "repaired_at", "repair_type", "citizen_feedback", "feedback_at")
    out = {k: row.get(k) for k in keep}
    out["complaint_id"] = str(out["complaint_id"])
    return out


@router.post("/{complaint_id}/feedback")
async def complaint_feedback(complaint_id: str, payload: ComplaintFeedback, _user: Dict[str, Any] = Depends(get_current_user)):
    """After a repair, the citizen says whether the road is really fixed."""
    if supabase is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database is not configured.")
    if not complaint_id.isdigit():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid complaint ID.")
    comment = (payload.comment or "").strip()
    answer = ("fixed" if payload.fixed else "not fixed") + (f": {comment}" if comment else "")
    try:
        res = (
            supabase.table("user_complaints")
            .update({"citizen_feedback": answer, "feedback_at": datetime.now(timezone.utc).isoformat()})
            .eq("complaint_id", int(complaint_id))
            .eq("status", "repaired")
            .execute()
        )
    except Exception as e:
        logger.error("Feedback save failed for %s: %s", complaint_id, e)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Feedback could not be saved. The database needs the citizen_feedback and feedback_at columns.") from e
    if not res.data:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Feedback is only possible after the complaint is repaired.")
    return {"complaint_id": complaint_id, "citizen_feedback": answer}
