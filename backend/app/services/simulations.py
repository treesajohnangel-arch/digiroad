"""
End-to-End Pavement Degradation Simulation Service for Digital Twin Backend.
Integrates with Supabase PostgreSQL:
  - public.road_segments: Static road engineering properties (CBR, AADT, LDF, etc.)
  - public.dynamic_road_evaluations: Current live pavement state (PCI, IRI, cracking, updated_at)
  - public.historic_road_evaluations: Time-series historical audit and plotting records
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple
from app.services.supabase_client import supabase
from app.services.decay_model import (
    calculate_delta_t,
    compute_mechanistic_step,
    calculate_road_health,
    get_health_color_hex,
    round_pci,
)
from app.services.weather_service import fetch_live_weather, calculate_segment_midpoint

logger = logging.getLogger(__name__)


class SegmentDataError(RuntimeError):
    """
    A segment's stored data could not be read or written, or is incomplete. Raised instead
    of falling back to defaults, so a failed read can never silently 'reset' a road to new.
    """


class SegmentNotFoundError(SegmentDataError):
    """The segment_id does not exist in public.road_segments."""


def _get_mock_segments() -> List[Dict[str, Any]]:
    """Lazy loader for mock road segments to prevent circular imports with api modules."""
    try:
        from app.api.home import MOCK_ROAD_SEGMENTS
        return MOCK_ROAD_SEGMENTS
    except Exception:
        return []


def _required_float(row: Dict[str, Any], keys: Tuple[str, ...], table: str, segment_id: Any) -> float:
    """First non-NULL value among `keys` as a float; SegmentDataError if there is none."""
    for key in keys:
        value = row.get(key)
        if value is None:
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            raise SegmentDataError(f"{table}.{key} for segment {segment_id} is not a number: {value!r}")
    raise SegmentDataError(f"{table}.{'/'.join(keys)} is missing for segment {segment_id}")


def static_props_from_row(seg_row: Dict[str, Any]) -> Dict[str, Any]:
    """
    Static engineering properties and location from a public.road_segments row.
    CBR, AADT, LDF and a location (midpoint, or start and end points) are required;
    a missing value raises SegmentDataError rather than being replaced by a default.
    """
    segment_id = seg_row.get("segment_id")
    table = "road_segments"
    props: Dict[str, Any] = {
        "segment_id": segment_id,
        "road_name": seg_row.get("road_name") or f"Road {segment_id}",
        "cbr": _required_float(seg_row, ("cbr_percentage", "cbr"), table, segment_id),
        "aadt": _required_float(seg_row, ("aadt",), table, segment_id),
        "ldf": _required_float(seg_row, ("ldf",), table, segment_id),
        "coordinates": seg_row.get("coordinates"),
    }
    if seg_row.get("base_daily_esal") is not None:
        props["base_daily_esal"] = float(seg_row["base_daily_esal"])

    for key in ("start_lat", "start_lon", "end_lat", "end_lon", "midpoint_lat", "midpoint_lon"):
        props[key] = float(seg_row[key]) if seg_row.get(key) is not None else None

    if props["midpoint_lat"] is None or props["midpoint_lon"] is None:
        if None in (props["start_lat"], props["start_lon"], props["end_lat"], props["end_lon"]):
            raise SegmentDataError(f"{table} has no midpoint or start/end coordinates for segment {segment_id}")
        props["midpoint_lat"] = (props["start_lat"] + props["end_lat"]) / 2.0
        props["midpoint_lon"] = (props["start_lon"] + props["end_lon"]) / 2.0

    return props


def normalize_segment_id(seg_id: str) -> str:
    """Normalizes road segment identifiers: e.g. 'MDR47 S01', 'mdr47-s01' -> 'MDR47-S01'."""
    if not seg_id:
        return ""
    import re
    clean = seg_id.strip().upper().replace("_", "-")
    clean = re.sub(r"\s+", "-", clean)
    clean = re.sub(r"-+", "-", clean)
    if clean.startswith("MDR-47"):
        clean = "MDR47" + clean[6:]
    return clean


def _mock_static_props(segment_id: str) -> Dict[str, Any]:
    """Offline development only (no Supabase client configured): in-memory MOCK_ROAD_SEGMENTS."""
    norm_id = normalize_segment_id(segment_id)
    for seg in _get_mock_segments():
        if seg.get("segment_id") == segment_id or normalize_segment_id(seg.get("segment_id", "")) == norm_id:
            return {
                "segment_id": seg.get("segment_id", norm_id),
                "road_name": seg.get("road_name", f"Road {norm_id}"),
                "cbr": float(seg.get("cbr", 5.0)),
                "aadt": float(seg.get("aadt", 5000.0)),
                "ldf": float(seg.get("ldf", 0.5)),
                "base_daily_esal": float(seg.get("base_daily_esal", 1500.0)),
                "coordinates": seg.get("coordinates"),
            }
    raise SegmentNotFoundError(f"Segment {segment_id} not found (offline mode: mock segments only)")


def _mock_dynamic_state(segment_id: str) -> Dict[str, Any]:
    """Offline development only (no Supabase client configured): in-memory MOCK_ROAD_SEGMENTS."""
    norm_id = normalize_segment_id(segment_id)
    for seg in _get_mock_segments():
        if seg.get("segment_id") == segment_id or normalize_segment_id(seg.get("segment_id", "")) == norm_id:
            pci = float(seg.get("pci_score", 100.0))
            return {
                "segment_id": seg.get("segment_id", norm_id),
                "cumulative_esal_msa": float(seg.get("cumulative_esal_msa", 0.0)),
                "cracking_pct": float(seg.get("cracking_pct", 0.0)),
                "rut_depth_mm": float(seg.get("rut_depth_mm", 0.0)),
                "raveling_pct": float(seg.get("raveling_pct", 0.0)),
                "patching_pct": float(seg.get("patching_pct", 0.0)),
                "iri_m_km": float(seg.get("iri_m_km", 1.2)),
                "pothole_pct": float(seg.get("pothole_pct", 0.0)),
                "pci_score": pci,
                "road_health": seg.get("road_health") or calculate_road_health(pci),
                "updated_at": seg.get("updated_at") or (datetime.now(timezone.utc) - timedelta(days=7)).isoformat(),
            }
    raise SegmentNotFoundError(f"Segment {segment_id} not found (offline mode: mock segments only)")


async def fetch_segment_static_props(segment_id: str) -> Dict[str, Any]:
    """
    Static properties (CBR, AADT, LDF, coordinates) from public.road_segments.
    Raises SegmentNotFoundError for an unknown segment and SegmentDataError if the row
    cannot be read or is incomplete.
    """
    segment_id = normalize_segment_id(segment_id)
    if supabase is None:
        return _mock_static_props(segment_id)

    try:
        res = supabase.table("road_segments").select("*").eq("segment_id", segment_id).limit(1).execute()
    except Exception as e:
        raise SegmentDataError(f"Could not read road_segments for segment {segment_id}: {e}") from e
    if not res.data:
        raise SegmentNotFoundError(f"Segment {segment_id} not found in road_segments")
    return static_props_from_row(res.data[0])


async def fetch_segment_dynamic_state(segment_id: str) -> Dict[str, Any]:
    """
    Current pavement state from public.dynamic_road_evaluations.
    Raises SegmentDataError if the row cannot be read, does not exist, or has a NULL
    metric, instead of continuing from a pristine (PCI 100, zero ESAL) state.
    """
    segment_id = normalize_segment_id(segment_id)
    if supabase is None:
        return _mock_dynamic_state(segment_id)

    try:
        res = supabase.table("dynamic_road_evaluations").select("*").eq("segment_id", segment_id).limit(1).execute()
    except Exception as e:
        raise SegmentDataError(f"Could not read dynamic_road_evaluations for segment {segment_id}: {e}") from e
    if not res.data:
        raise SegmentDataError(
            f"No dynamic_road_evaluations row for segment {segment_id}; "
            "initialise it with run_historical_sim.py before simulating"
        )

    row = res.data[0]
    table = "dynamic_road_evaluations"
    state: Dict[str, Any] = {"segment_id": segment_id}
    for key in ("cumulative_esal_msa", "cracking_pct", "raveling_pct", "patching_pct", "iri_m_km", "pci_score"):
        state[key] = _required_float(row, (key,), table, segment_id)
    state["pothole_pct"] = float(row.get("pothole_pct") or 0.0)
    state["rut_depth_mm"] = float(row.get("rut_depth_mm") or row.get("rutting_mm") or 0.0)
    # PCI score is dynamically taken from dynamic_road_evaluations and road_health is dynamically calculated from it
    state["road_health"] = calculate_road_health(state["pci_score"])
    state["updated_at"] = (
        row.get("execution_timestamp")
        or row.get("updated_at")
        or row.get("observation_timestamp")
    )
    return state


async def fetch_segment_static_and_dynamic_state(
    segment_id: str,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Step A: FETCH STATE
    1. Read static properties (cbr, aadt, ldf, coordinates) from public.road_segments.
    2. Read current state (cumulative_esal_msa, cracking_pct, raveling_pct, patching_pct,
       iri_m_km, pci_score, updated_at) from public.dynamic_road_evaluations.
    When Supabase is configured, a read error, a missing row or a NULL metric raises
    SegmentDataError (SegmentNotFoundError for an unknown segment) instead of continuing
    from default values. In-memory MOCK_ROAD_SEGMENTS are used only when no Supabase
    client is configured at all (offline development).
    """
    static_props = await fetch_segment_static_props(segment_id)
    dynamic_state = await fetch_segment_dynamic_state(segment_id)
    return static_props, dynamic_state


async def save_segment_evaluation(
    segment_id: str,
    evaluated_state: Dict[str, Any],
    evaluation_time: datetime,
) -> None:
    segment_id = normalize_segment_id(segment_id)
    now_iso = evaluation_time.isoformat()

    # 1. Update in-memory mock records
    norm_id = normalize_segment_id(segment_id)
    for seg in _get_mock_segments():
        if seg.get("segment_id") == segment_id or normalize_segment_id(seg.get("segment_id", "")) == norm_id:
            seg["pci_score"] = evaluated_state["pci_score"]
            seg["iri_m_km"] = evaluated_state["iri_m_km"]
            seg["cracking_pct"] = evaluated_state["cracking_pct"]
            seg["raveling_pct"] = evaluated_state["raveling_pct"]
            seg["patching_pct"] = evaluated_state["patching_pct"]
            seg["pothole_pct"] = evaluated_state["pothole_pct"]
            seg["road_health"] = evaluated_state["road_health"]
            seg["color_hex"] = evaluated_state["color_hex"]
            seg["cumulative_esal_msa"] = evaluated_state["cumulative_esal_msa"]
            seg["updated_at"] = now_iso
            break

    # 2. Persist to Supabase if connected
    if supabase is not None:
        pci_val = float(evaluated_state["pci_score"])

        # C.1: Update dynamic road evaluations
        dynamic_payload = {
            "segment_id": segment_id,
            "pci_score": pci_val,
            "iri_m_km": float(evaluated_state["iri_m_km"]),
            "cracking_pct": float(evaluated_state["cracking_pct"]),
            "raveling_pct": float(evaluated_state["raveling_pct"]),
            "patching_pct": float(evaluated_state["patching_pct"]),
            "pothole_pct": float(evaluated_state.get("pothole_pct", 0.0)),
            "road_health": evaluated_state["road_health"],
            "cumulative_esal_msa": float(evaluated_state["cumulative_esal_msa"]),
            "execution_timestamp": now_iso,
        }
        if "rainfall_mm" in evaluated_state:
            dynamic_payload["rainfall_mm"] = float(evaluated_state["rainfall_mm"])
        if "max_temp" in evaluated_state:
            dynamic_payload["max_temperature_c"] = float(evaluated_state["max_temp"])

        try:
            res_up = (
                supabase.table("dynamic_road_evaluations")
                .update(dynamic_payload)
                .eq("segment_id", segment_id)
                .execute()
            )
            if not res_up.data:
                supabase.table("dynamic_road_evaluations").insert(dynamic_payload).execute()
        except Exception as e:
            raise SegmentDataError(
                f"Could not update dynamic_road_evaluations for segment {segment_id}: {e}"
            ) from e
        logger.info(f"Updated dynamic_road_evaluations for segment {segment_id}")

        # C.2: Insert historic record
        historic_payload = {
            "segment_id": segment_id,
            "evaluation_timestamp": now_iso,
            "pci_score": pci_val,
            "iri_m_km": float(evaluated_state["iri_m_km"]),
            "cracking_pct": float(evaluated_state["cracking_pct"]),
            "raveling_pct": float(evaluated_state["raveling_pct"]),
            "patching_pct": float(evaluated_state["patching_pct"]),
            "road_health": evaluated_state["road_health"],
            "cumulative_esal_msa": float(evaluated_state["cumulative_esal_msa"]),
        }
        if "rainfall_mm" in evaluated_state:
            historic_payload["rainfall_mm"] = float(evaluated_state["rainfall_mm"])
        if "max_temp" in evaluated_state:
            historic_payload["temperature_c"] = float(evaluated_state["max_temp"])

        try:
            supabase.table("historic_road_evaluations").insert(historic_payload).execute()
        except Exception as e:
            if "invalid input syntax for type integer" in str(e).lower():
                historic_payload["pci_score"] = int(round(pci_val))
                supabase.table("historic_road_evaluations").insert(historic_payload).execute()
            else:
                raise SegmentDataError(
                    f"Updated the live state of segment {segment_id} but could not record its "
                    f"historic evaluation at {now_iso}: {e}"
                ) from e
        logger.info(f"Recorded historic evaluation for segment {segment_id} at {now_iso}")


async def execute_segment_simulation_step(
    segment_id: str,
    weather_inputs: Optional[Dict[str, Any]] = None,
    traffic_multiplier: float = 1.0,
    force_delta_t_days: Optional[float] = None,
    current_timestamp: Optional[datetime] = None,
) -> Dict[str, Any]:
    """
    Executes an end-to-end pavement degradation step for a given segment_id:

    A. FETCH STATE:
       - Reads static properties from public.road_segments
       - Reads current state from public.dynamic_road_evaluations

    B. COMPUTE SIMULATION STEP:
       1. Compute delta_t = (now() - updated_at) in fractional days. If delta_t <= 0, abort calculation.
       2. Fetch weather inputs for interval delta_t (average max temp, accumulated rainfall).
       3. Compute next-state distresses and deduct value mapping (PCI).
       4. Determine road health category.

    C. SAVE STATE:
       1. UPDATE public.dynamic_road_evaluations with updated metrics and execution_timestamp = now().
       2. Insert timestamped log into public.historic_road_evaluations.

    D. REPEAT NEXT RUN:
       The updated state stored in dynamic_road_evaluations acts as base state (Step n)
       for subsequent executions.

    Raises SegmentDataError (SegmentNotFoundError for an unknown segment) if the state
    cannot be read or saved; nothing is computed from default values.
    """
    # Step A: FETCH STATE
    segment_id = normalize_segment_id(segment_id)
    static_props, dynamic_state = await fetch_segment_static_and_dynamic_state(segment_id)

    # Step B: COMPUTE SIMULATION STEP
    now_dt = current_timestamp or datetime.now(timezone.utc)

    # B.1: Compute delta_t
    if force_delta_t_days is not None:
        delta_t = float(force_delta_t_days)
    else:
        last_updated = dynamic_state.get("updated_at")
        if not last_updated:
            delta_t = 7.0  # Default 1 week if no previous timestamp
        else:
            delta_t = calculate_delta_t(now_dt, last_updated)

    # If delta_t <= 0, abort calculation
    if delta_t <= 0:
        msg = f"delta_t must be positive (> 0), got {delta_t:.6f} days. Pavement state is already up to date. Aborting."
        logger.warning(f"Simulation step aborted for {segment_id}: {msg}")
        return {
            "status": "aborted",
            "segment_id": segment_id,
            "message": msg,
            "delta_t_days": delta_t,
            "current_state": dynamic_state,
        }

    # B.2: Weather inputs for interval delta_t
    if weather_inputs is None:
        lat, lon = calculate_segment_midpoint(static_props)
        logger.info(f"Fetching live weather for segment {segment_id} at midpoint ({lat:.5f}, {lon:.5f})")
        effective_weather = await fetch_live_weather(lat=lat, lon=lon)
    else:
        effective_weather = {
            "rainfall_mm": 0.0,
            "max_temp": 30.0,
        }
        if "rainfall_mm" in weather_inputs:
            effective_weather["rainfall_mm"] = float(weather_inputs["rainfall_mm"])
        elif "daily_precipitation_mm" in weather_inputs:
            effective_weather["rainfall_mm"] = float(weather_inputs["daily_precipitation_mm"])

        if "max_temp" in weather_inputs:
            effective_weather["max_temp"] = float(weather_inputs["max_temp"])
        elif "temperature_c" in weather_inputs:
            effective_weather["max_temp"] = float(weather_inputs["temperature_c"])

    # B.3 & B.4: Compute mechanistic degradation step
    next_state = compute_mechanistic_step(
        static_props=static_props,
        current_state=dynamic_state,
        weather_data=effective_weather,
        delta_t=delta_t,
        traffic_multiplier=traffic_multiplier,
    )

    # Step C: SAVE STATE
    await save_segment_evaluation(
        segment_id=segment_id,
        evaluated_state=next_state,
        evaluation_time=now_dt,
    )

    return {
        "status": "success",
        "segment_id": segment_id,
        "simulated_at": now_dt.isoformat(),
        "delta_t_days": delta_t,
        "previous_state": {
            "pci_score": dynamic_state.get("pci_score"),
            "iri_m_km": dynamic_state.get("iri_m_km"),
            "cracking_pct": dynamic_state.get("cracking_pct"),
            "raveling_pct": dynamic_state.get("raveling_pct"),
            "patching_pct": dynamic_state.get("patching_pct"),
            "cumulative_esal_msa": dynamic_state.get("cumulative_esal_msa"),
            "road_health": dynamic_state.get("road_health"),
            "updated_at": dynamic_state.get("updated_at"),
        },
        "new_state": next_state,
        "static_properties": static_props,
    }


async def execute_all_segments_simulation(
    weather_inputs: Optional[Dict[str, Any]] = None,
    traffic_multiplier: float = 1.0,
    force_delta_t_days: Optional[float] = None,
    current_timestamp: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """
    Triggers simulation across all registered road segments for scheduled weekly background
    runs or on-demand manual batch runs. A segment whose state cannot be read or saved is
    reported with status "error" and left untouched; the other segments still run.
    Raises SegmentDataError if the list of segments itself cannot be read.
    """
    segment_ids: List[str] = []

    if supabase is None:
        # Offline development only: simulate the in-memory mock segments.
        segment_ids = [seg["segment_id"] for seg in _get_mock_segments() if "segment_id" in seg]
    else:
        try:
            res = supabase.table("road_segments").select("segment_id").execute()
        except Exception as e:
            raise SegmentDataError(f"Could not list road segments: {e}") from e
        segment_ids = [r["segment_id"] for r in (res.data or []) if r.get("segment_id")]
        if not segment_ids:
            logger.warning("road_segments has no segments; nothing to simulate.")

    results: List[Dict[str, Any]] = []
    for sid in segment_ids:
        try:
            res = await execute_segment_simulation_step(
                segment_id=sid,
                weather_inputs=weather_inputs,
                traffic_multiplier=traffic_multiplier,
                force_delta_t_days=force_delta_t_days,
                current_timestamp=current_timestamp,
            )
            results.append(res)
        except Exception as e:
            logger.error(f"Error simulating segment {sid}: {e}")
            results.append({
                "status": "error",
                "segment_id": sid,
                "error": str(e),
            })

    return results
