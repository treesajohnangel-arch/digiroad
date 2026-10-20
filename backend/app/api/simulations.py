import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from app.core.authentication import require_admin
from app.schemas.simulation import (
    SimulationRunInput,
    SimulationResult,
    SimulationDayMetric,
    SimulationStepTriggerInput,
    BatchSimulationTriggerInput,
)
from app.services.decay_model import (
    compute_mechanistic_step,
    calculate_road_health,
    get_health_color_hex,
)
from app.services.simulations import (
    SegmentDataError,
    SegmentNotFoundError,
    fetch_segment_static_and_dynamic_state,
    execute_segment_simulation_step,
    execute_all_segments_simulation,
)
from app.services.weather_service import fetch_live_weather, calculate_segment_midpoint
from app.services.tomtom_client import get_traffic_speed_multiplier

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Pavement Decay Simulations"])


def _segment_http_error(e: SegmentDataError) -> HTTPException:
    """404 for an unknown segment; 503 when a segment's stored data cannot be read or saved."""
    if isinstance(e, SegmentNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))


@router.post("/run", response_model=SimulationResult, status_code=status.HTTP_200_OK)
async def run_simulation(payload: SimulationRunInput):
    """
    USER-TRIGGERED what-if simulation for a road segment over `days` days.

    - Starts from the segment's CURRENT real state (road_segments + dynamic_road_evaluations).
    - Pulls LIVE weather (OpenWeather) at the segment midpoint and LIVE traffic (TomTom).
    - Projects day-by-day using the mechanistic decay model with the segment's real
      engineering properties (CBR/AADT/LDF) held fixed across every day.
    - IMPORTANT: results are returned only. Nothing is written to Supabase or any store.
    """
    # 1. Fetch the segment's real static properties and current dynamic state.
    try:
        static_props, current_state = await fetch_segment_static_and_dynamic_state(payload.segment_id)
    except SegmentDataError as e:
        raise _segment_http_error(e)

    # 2. Resolve coordinates (midpoint) for live weather + traffic lookups.
    mid_lat, mid_lon = calculate_segment_midpoint(static_props)
    tomtom_lat = payload.point_lat if payload.point_lat is not None else mid_lat
    tomtom_lon = payload.point_lon if payload.point_lon is not None else mid_lon

    # 3. LIVE weather from OpenWeather (base), with optional what-if overrides.
    live_weather = await fetch_live_weather(lat=mid_lat, lon=mid_lon)
    base_rain = float(live_weather.get("rainfall_mm", 0.0))
    base_temp = float(live_weather.get("max_temp", 30.0))

    severity = payload.weather_severity if payload.weather_severity is not None else 1.0
    if payload.daily_precipitation_mm is not None:
        rainfall_mm = float(payload.daily_precipitation_mm)
    else:
        # severity scales live rainfall (1.0 = live as-is, >1.0 = heavier what-if monsoon)
        rainfall_mm = base_rain * severity
    max_temp = base_temp + max(0.0, (severity - 1.0) * 5.0)

    weather_data = {
        "rainfall_mm": rainfall_mm,
        "daily_precipitation_mm": rainfall_mm,
        "max_temp": max_temp,
        "temperature_c": max_temp,
    }

    # 4. LIVE traffic multiplier from TomTom.
    tomtom_speed_mult = await get_traffic_speed_multiplier(point_lat=tomtom_lat, point_lon=tomtom_lon)
    base_traffic = payload.traffic_multiplier if payload.traffic_multiplier is not None else 1.0
    effective_traffic = base_traffic * tomtom_speed_mult
    if payload.maintenance_applied:
        effective_traffic *= 0.6  # Maintenance reduces stress impact

    # 5. Day-by-day forecast. static_props is held fixed and reapplied every day so the
    #    segment's real CBR/AADT/LDF are honored for the whole horizon (not just day 1).
    today = datetime.now(timezone.utc).date()
    forecast_timeline: List[SimulationDayMetric] = []

    state = dict(current_state)
    if "cumulative_esal_msa" not in state:
        state["cumulative_esal_msa"] = 0.0

    init_pci = float(state.get("pci_score", 100.0))
    init_health = calculate_road_health(init_pci)
    init_color = get_health_color_hex(init_health)

    forecast_timeline.append(
        SimulationDayMetric(
            day=0,
            date=today.isoformat(),
            cumulative_esal_msa=float(state.get("cumulative_esal_msa", 0.0)),
            cracking_pct=float(state.get("cracking_pct", 0.0)),
            raveling_pct=float(state.get("raveling_pct", 0.0)),
            patching_pct=float(state.get("patching_pct", 0.0)),
            iri_m_km=float(state.get("iri_m_km", 1.2)),
            pothole_pct=float(state.get("pothole_pct", 0.0)),
            rut_depth_mm=float(state.get("rut_depth_mm", 0.0)),
            pci_score=init_pci,
            road_health=init_health,
            color=init_color,
            color_hex=init_color,
        )
    )

    for day in range(1, payload.days + 1):
        state = compute_mechanistic_step(
            static_props=static_props,
            current_state=state,
            weather_data=weather_data,
            delta_t=1.0,
            traffic_multiplier=effective_traffic,
        )
        step_date = today + timedelta(days=day)
        forecast_timeline.append(
            SimulationDayMetric(
                day=day,
                date=step_date.isoformat(),
                cumulative_esal_msa=state["cumulative_esal_msa"],
                cracking_pct=state["cracking_pct"],
                raveling_pct=state["raveling_pct"],
                patching_pct=state["patching_pct"],
                iri_m_km=state["iri_m_km"],
                pothole_pct=state["pothole_pct"],
                rut_depth_mm=float(state.get("rut_depth_mm", 0.0)),
                pci_score=state["pci_score"],
                road_health=state["road_health"],
                color=state["color"],
                color_hex=state["color_hex"],
            )
        )

    final_state = state
    return SimulationResult(
        segment_id=payload.segment_id,
        days=payload.days,
        initial_pci=init_pci,
        final_pci=final_state["pci_score"],
        initial_health=init_health,
        final_health=final_state["road_health"],
        traffic_multiplier_applied=round(effective_traffic, 4),
        final_state=final_state,
        forecast=forecast_timeline,
        projected_decay_timeline=forecast_timeline,
    )


@router.post("/step", status_code=status.HTTP_200_OK, dependencies=[Depends(require_admin)])
async def trigger_single_step_simulation(payload: SimulationStepTriggerInput):
    """
    ADMIN ONLY. Executes a single dynamic simulation step for a segment against Supabase PostgreSQL:
    - Reads static properties from 'road_segments'
    - Reads dynamic current state from 'dynamic_road_evaluations'
    - Computes delta_t = (now() - updated_at) / 86400.0 (or uses force_delta_t_days)
    - Aborts if delta_t <= 0
    - Calculates mechanistic degradation metrics (ESAL, cracking, raveling, patching, IRI, PCI)
    - Records history into 'historic_road_evaluations'
    - Updates latest state into 'dynamic_road_evaluations' with updated_at = now()
    """
    weather_inputs: Dict[str, Any] = {}
    if payload.rainfall_mm is not None:
        weather_inputs["rainfall_mm"] = payload.rainfall_mm
    if payload.max_temp is not None:
        weather_inputs["max_temp"] = payload.max_temp

    try:
        result = await execute_segment_simulation_step(
            segment_id=payload.segment_id,
            weather_inputs=weather_inputs if weather_inputs else None,
            traffic_multiplier=payload.traffic_multiplier or 1.0,
            force_delta_t_days=payload.force_delta_t_days,
        )
    except SegmentDataError as e:
        raise _segment_http_error(e)
    return result


@router.post("/batch-step", status_code=status.HTTP_200_OK, dependencies=[Depends(require_admin)])
async def trigger_batch_step_simulation(payload: BatchSimulationTriggerInput):
    """
    ADMIN ONLY. Triggers dynamic simulation step for all registered road segments:
    - Ideal for weekly cron background jobs or manual bulk triggers.
    - Saves historic evaluations and updates dynamic_road_evaluations for each segment.
    """
    weather_inputs: Dict[str, Any] = {}
    if payload.rainfall_mm is not None:
        weather_inputs["rainfall_mm"] = payload.rainfall_mm
    if payload.max_temp is not None:
        weather_inputs["max_temp"] = payload.max_temp

    try:
        results = await execute_all_segments_simulation(
            weather_inputs=weather_inputs if weather_inputs else None,
            traffic_multiplier=payload.traffic_multiplier or 1.0,
            force_delta_t_days=payload.force_delta_t_days,
        )
    except SegmentDataError as e:
        raise _segment_http_error(e)
    return {
        "status": "success",
        "processed_segments": len(results),
        "results": results,
    }

