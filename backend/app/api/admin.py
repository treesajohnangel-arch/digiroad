import logging
import re
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel, Field
from app.services.supabase_client import supabase
from app.schemas.complaint import ComplaintStatus
from app.api.complaints import IN_MEMORY_COMPLAINTS
from app.api.home import MOCK_ROAD_SEGMENTS
from app.services.decay_model import get_health_color_hex
from app.core.authentication import require_admin

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Admin Operations"], dependencies=[Depends(require_admin)])


def normalize_segment_id(seg_id: str) -> str:
    """Normalizes segment identifiers to standard format (e.g. MDR47 S01 -> MDR47-S01)."""
    if not seg_id:
        return ""
    clean = seg_id.strip().upper().replace("_", "-")
    clean = re.sub(r"\s+", "-", clean)
    clean = re.sub(r"-+", "-", clean)
    if clean.startswith("MDR-47"):
        clean = "MDR47" + clean[6:]
    return clean


def classify_repair_health(pci: float) -> str:
    """
    Health Status according to repair specifications:
      PCI >= 85 -> Good
      60 <= PCI < 85 -> Fair
      40 <= PCI < 60 -> Poor
      PCI < 40 -> Very Poor
    """
    pci_val = float(pci)
    if pci_val >= 85.0:
        return "Good"
    elif pci_val >= 60.0:
        return "Fair"
    elif pci_val >= 40.0:
        return "Poor"
    else:
        return "Very Poor"


def get_repair_color(health: str) -> str:
    colors = {
        "Good": "#10B981",       # Green
        "Fair": "#F59E0B",       # Yellow / Amber
        "Poor": "#EF4444",       # Red
        "Very Poor": "#991B1B",  # Maroon
    }
    return colors.get(health, "#991B1B")


class AdminRepairInput(BaseModel):
    complaint_id: str = Field(..., description="ID of the complaint being resolved")
    repair_type: str = Field(..., description="Action type: 'PATCHING' or 'FULL_RESURFACING'")
    segment_id: Optional[str] = Field(
        None, description="Optional target segment ID (e.g. MDR47 S01 or MDR47-S01). Inferred from complaint if omitted."
    )
    patch_length_m: Optional[float] = Field(
        None, description="Length of patch in meters (required if repair_type == 'PATCHING')"
    )
    patch_width_m: Optional[float] = Field(
        None, description="Width of patch in meters (required if repair_type == 'PATCHING')"
    )
    notes: Optional[str] = Field(None, description="Optional maintenance completion notes")


class SegmentRepairMetrics(BaseModel):
    segment_id: str
    pci_score: float
    iri_m_km: float
    cracking_pct: float
    rut_depth_mm: float
    raveling_pct: float
    patching_pct: float
    pothole_pct: float = 0.0
    road_health: str
    color_hex: str


class AdminRepairResponse(BaseModel):
    message: str
    complaint_id: str
    repair_type: str
    complaint_status: str
    segment_id: str
    segment_metrics: SegmentRepairMetrics
    updated_at: str


class RepairFinishedInput(BaseModel):
    complaint_id: str = Field(..., description="ID of the complaint being resolved")
    segment_id: Optional[str] = Field(
        None, description="Optional road segment ID (e.g. MDR47 S01 or MDR47-S01). If omitted, looked up from the complaint."
    )
    notes: Optional[str] = Field(None, description="Optional maintenance completion notes")


class RepairFinishedResponse(BaseModel):
    message: str
    complaint_id: str
    complaint_status: str
    segment_metrics: SegmentRepairMetrics
    updated_at: str


@router.post("/repair", response_model=AdminRepairResponse, status_code=status.HTTP_200_OK)
async def execute_repair(payload: AdminRepairInput):
    """
    Dual-action administrative repair workflow:
    - PATCHING: Calculates patch area, added patching %, reduced cracking/rutting/raveling,
      IRI improvement, deduct and newly computed PCI & road health band.
    - FULL_RESURFACING: Resets all distresses to pristine baseline (cracking=0, rut=0, raveling=0,
      patching=0, iri=1.2, pci=100.0, health="Good").
    - Updates user_complaints, dynamic_road_evaluations, and inserts into historic_road_evaluations.
    """
    repair_type = payload.repair_type.strip().upper()
    if repair_type not in ["PATCHING", "FULL_RESURFACING"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid repair_type. Must be 'PATCHING' or 'FULL_RESURFACING'.",
        )

    now = datetime.now(timezone.utc).isoformat()
    raw_segment = payload.segment_id or ""
    target_segment_id = normalize_segment_id(raw_segment) if raw_segment else ""

    # 1. Resolve target segment from complaint if not explicitly provided
    if not target_segment_id:
        for comp in IN_MEMORY_COMPLAINTS:
            if str(comp.get("complaint_id")) == payload.complaint_id or str(comp.get("id")) == payload.complaint_id:
                target_segment_id = normalize_segment_id(comp.get("segment_id", ""))
                break

    if not target_segment_id and supabase:
        try:
            cid_val = int(payload.complaint_id) if payload.complaint_id.isdigit() else payload.complaint_id
            for tbl, id_col in [("user_complaints", "complaint_id"), ("complaints", "id")]:
                try:
                    res_c = supabase.table(tbl).select("segment_id").eq(id_col, cid_val).limit(1).execute()
                    if res_c.data and len(res_c.data) > 0:
                        target_segment_id = normalize_segment_id(res_c.data[0].get("segment_id", ""))
                        if target_segment_id:
                            break
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"Error fetching segment for complaint {payload.complaint_id}: {e}")

    if not target_segment_id:
        target_segment_id = "MDR47-S01"

    # 2. Fetch segment geometry & current distress state
    seg_length_m = 1000.0
    seg_width_m = 7.0
    cracking_old = 0.0
    raveling_old = 0.0
    rutting_old = 0.0
    patching_old = 0.0
    iri_old = 1.2
    esal_msa = 0.0

    # In-memory baseline lookup
    for seg in MOCK_ROAD_SEGMENTS:
        if seg.get("segment_id") == target_segment_id or seg.get("segment_id", "").replace("-", " ") == target_segment_id.replace("-", " "):
            cracking_old = float(seg.get("cracking_pct", 0.0))
            raveling_old = float(seg.get("raveling_pct", 0.0))
            rutting_old = float(seg.get("rut_depth_mm", 0.0))
            patching_old = float(seg.get("patching_pct", 0.0))
            iri_old = float(seg.get("iri_m_km", 1.2))
            break

    # Database live state lookup
    if supabase:
        try:
            res_static = supabase.table("road_segments").select("*").eq("segment_id", target_segment_id).limit(1).execute()
            if res_static.data and len(res_static.data) > 0:
                srow = res_static.data[0]
                if srow.get("segment_length_km"):
                    seg_length_m = float(srow["segment_length_km"]) * 1000.0
                if srow.get("carriageway_width_m"):
                    seg_width_m = float(srow["carriageway_width_m"])

            res_dyn = supabase.table("dynamic_road_evaluations").select("*").eq("segment_id", target_segment_id).limit(1).execute()
            if res_dyn.data and len(res_dyn.data) > 0:
                drow = res_dyn.data[0]
                if drow.get("cracking_pct") is not None:
                    cracking_old = float(drow["cracking_pct"])
                if drow.get("raveling_pct") is not None:
                    raveling_old = float(drow["raveling_pct"])
                if drow.get("rut_depth_mm") is not None:
                    rutting_old = float(drow["rut_depth_mm"])
                elif drow.get("rutting_mm") is not None:
                    rutting_old = float(drow["rutting_mm"])
                if drow.get("patching_pct") is not None:
                    patching_old = float(drow["patching_pct"])
                if drow.get("iri_m_km") is not None:
                    iri_old = float(drow["iri_m_km"])
                if drow.get("cumulative_esal_msa") is not None:
                    esal_msa = float(drow["cumulative_esal_msa"])
        except Exception as e:
            logger.warning(f"Failed to query live properties from Supabase for {target_segment_id}: {e}")

    # 3. Perform repair calculations
    if repair_type == "PATCHING":
        if payload.patch_length_m is None or payload.patch_length_m <= 0 or payload.patch_width_m is None or payload.patch_width_m <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="patch_length_m and patch_width_m must be provided and greater than 0 for PATCHING repair.",
            )
        p_len = float(payload.patch_length_m)
        p_wid = float(payload.patch_width_m)

        # Delta_Area_patch = Length * Width
        delta_area_patch = p_len * p_wid
        # Segment Total Area = Segment Length * Segment Width
        seg_total_area = max(1.0, seg_length_m * seg_width_m)

        # Delta_Patching % = (Delta_Area_patch / (Segment Length * Segment Width)) * 100
        delta_patching_pct = (delta_area_patch / seg_total_area) * 100.0
        # Patching Distress Reduction (damaged patches & potholes restored by new repair):
        patching_new = max(0.0, patching_old * (1.0 - (delta_patching_pct / 100.0)))

        # Cracking Reduction:
        # Delta_Cracking % = Delta_Patching % / 1.3
        delta_cracking_pct = delta_patching_pct / 1.3
        # Cracking_new = max(0.0, Cracking_old - Delta_Cracking %)
        cracking_new = max(0.0, cracking_old - delta_cracking_pct)

        # Raveling Reduction:
        # Raveling_new = max(0.0, Raveling_old * (1.0 - (Delta_Patching % / 100)))
        raveling_new = max(0.0, raveling_old * (1.0 - (delta_patching_pct / 100.0)))

        # Rutting Reduction:
        # Delta_Rutting = Rutting_old * (0.8 * (Delta_Patching % / 100))
        delta_rutting = rutting_old * (0.8 * (delta_patching_pct / 100.0))
        # Rutting_new = max(0.0, Rutting_old - Delta_Rutting)
        rutting_new = max(0.0, rutting_old - delta_rutting)

        # IRI Improvement (Reduced roughness):
        a1 = 0.005  # IRI_A1
        a4 = 0.003  # IRI_A4
        a2 = 0.002  # IRI_A2
        delta_iri = -(a1 * delta_cracking_pct + a4 * delta_rutting + a2 * (patching_old - patching_new))
        # IRI_new = max(1.2, iri_old + delta_iri)
        iri_new = max(1.2, iri_old + delta_iri)

        # Recalculate PCI & Road Health Band:
        # Deduct = (Cracking_new * 0.4) + (Raveling_new * 0.3) + (Rutting_new * 1.5) + (Patching_new * 0.2) + ((IRI_new - 1.2) * 8.0)
        deduct = (
            (cracking_new * 0.4)
            + (raveling_new * 0.3)
            + (rutting_new * 1.5)
            + (patching_new * 0.2)
            + ((iri_new - 1.2) * 8.0)
        )
        # PCI_new = max(0.0, min(100.0, 100.0 - Deduct))
        pci_new = round(max(0.0, min(100.0, 100.0 - deduct)), 2)
        health_status = classify_repair_health(pci_new)
        color_hex = get_repair_color(health_status)

    else:
        # Case 2: FULL_RESURFACING
        cracking_new = 0.0
        raveling_new = 0.0
        rutting_new = 0.0
        patching_new = 0.0
        iri_new = 1.2
        pci_new = 100.0
        health_status = "Good"
        color_hex = "#10B981"

    # 4. State Synchronization: In-Memory
    for comp in IN_MEMORY_COMPLAINTS:
        if str(comp.get("complaint_id")) == payload.complaint_id or str(comp.get("id")) == payload.complaint_id:
            comp["status"] = ComplaintStatus.REPAIRED.value
            comp["repaired_at"] = now
            comp["updated_at"] = now
            comp["repair_type"] = repair_type
            break

    segment_metrics = SegmentRepairMetrics(
        segment_id=target_segment_id,
        pci_score=pci_new,
        iri_m_km=round(iri_new, 4),
        cracking_pct=round(cracking_new, 4),
        rut_depth_mm=round(rutting_new, 4),
        raveling_pct=round(raveling_new, 4),
        patching_pct=round(patching_new, 4),
        pothole_pct=0.0,
        road_health=health_status,
        color_hex=color_hex,
    )

    for seg in MOCK_ROAD_SEGMENTS:
        if seg.get("segment_id") == target_segment_id or seg.get("segment_id", "").replace("-", " ") == target_segment_id.replace("-", " "):
            seg.update(segment_metrics.model_dump())
            break

    # 5. Database Synchronization
    if supabase:
        try:
            cid_val = int(payload.complaint_id) if payload.complaint_id.isdigit() else payload.complaint_id
            for tbl, id_col in [("user_complaints", "complaint_id"), ("complaints", "id")]:
                try:
                    supabase.table(tbl).update({
                        "status": ComplaintStatus.REPAIRED.value,
                        "repaired_at": now,
                    }).eq(id_col, cid_val).execute()
                except Exception:
                    pass

            db_pci = float(pci_new)
            dynamic_payload = {
                "segment_id": target_segment_id,
                "pci_score": db_pci,
                "iri_m_km": round(iri_new, 4),
                "cracking_pct": round(cracking_new, 4),
                "raveling_pct": round(raveling_new, 4),
                "patching_pct": round(patching_new, 4),
                "pothole_pct": 0.0,
                "road_health": health_status,
                "execution_timestamp": now,
            }
            # Overwrite current row in dynamic_road_evaluations (live state table)
            supabase.table("dynamic_road_evaluations").update(dynamic_payload).eq("segment_id", target_segment_id).execute()

            # Optional synchronization to pavement_segments if table exists
            try:
                supabase.table("pavement_segments").update(dynamic_payload).eq("segment_id", target_segment_id).execute()
            except Exception:
                pass

            # Insert time-series row in historic_road_evaluations
            historic_payload = {
                "segment_id": target_segment_id,
                "evaluation_timestamp": now,
                "pci_score": db_pci,
                "iri_m_km": round(iri_new, 4),
                "cracking_pct": round(cracking_new, 4),
                "raveling_pct": round(raveling_new, 4),
                "patching_pct": round(patching_new, 4),
                "road_health": health_status,
                "cumulative_esal_msa": esal_msa,
            }
            try:
                supabase.table("historic_road_evaluations").insert(historic_payload).execute()
            except Exception as e_hist:
                if "invalid input syntax for type integer" in str(e_hist).lower():
                    # Fallback if historic_road_evaluations.pci_score column hasn't been migrated to float8 yet
                    historic_payload["pci_score"] = int(round(db_pci))
                    supabase.table("historic_road_evaluations").insert(historic_payload).execute()
                else:
                    raise e_hist

            # Optional insert into pavement_history if table exists
            try:
                supabase.table("pavement_history").insert({
                    **historic_payload,
                    "repair_type": repair_type,
                }).execute()
            except Exception:
                pass
        except Exception as e:
            logger.error(f"Error executing database synchronization for repair: {e}")

    action_label = "Patching completed" if repair_type == "PATCHING" else "Full Resurfacing completed"
    return AdminRepairResponse(
        message=f"{action_label} for complaint {payload.complaint_id} (marked as REPAIRED). Segment {target_segment_id} updated (PCI: {pci_new}, Health: {health_status}).",
        complaint_id=payload.complaint_id,
        repair_type=repair_type,
        complaint_status=ComplaintStatus.REPAIRED.value,
        segment_id=target_segment_id,
        segment_metrics=segment_metrics,
        updated_at=now,
    )


@router.post("/repair-finished", response_model=RepairFinishedResponse, status_code=status.HTTP_200_OK)
async def mark_repair_finished(payload: RepairFinishedInput):
    """Backwards-compatible endpoint for full resurfacing repairs."""
    res = await execute_repair(AdminRepairInput(
        complaint_id=payload.complaint_id,
        repair_type="FULL_RESURFACING",
        segment_id=payload.segment_id,
        notes=payload.notes,
    ))
    return RepairFinishedResponse(
        message=res.message,
        complaint_id=res.complaint_id,
        complaint_status=res.complaint_status,
        segment_metrics=res.segment_metrics,
        updated_at=res.updated_at,
    )



class UpdateUserRoleInput(BaseModel):
    role: str = Field(..., description="Role to set in the database: 'user' or 'admin'")


class UpdateUserRoleResponse(BaseModel):
    message: str
    user_id: str
    role: str
    updated_at: str


@router.patch("/users/{user_id}/role", response_model=UpdateUserRoleResponse)
async def update_user_role(user_id: str, payload: UpdateUserRoleInput):
    """
    Admin Only: Update a user's role in public.profiles table in Supabase.
    Accepted roles: 'user' or 'admin'.
    Only an authenticated admin has access to change the role in the role section.
    """
    clean_role = payload.role.strip().lower()
    if clean_role not in ["user", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid role. Must be 'user' or 'admin'.",
        )

    now = datetime.now(timezone.utc).isoformat()
    if supabase is not None:
        try:
            res = (
                supabase.table("profiles")
                .update({"role": clean_role, "updated_at": now})
                .eq("id", user_id)
                .execute()
            )
            if not res.data:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"User with ID {user_id} not found.",
                )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error updating user role in Supabase: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to update role: {str(e)}",
            )

    return UpdateUserRoleResponse(
        message=f"User {user_id} role successfully updated to '{clean_role}'.",
        user_id=user_id,
        role=clean_role,
        updated_at=now,
    )

