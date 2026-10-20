import math
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Union
from app.schemas.simulation import SimulationDayMetric, SimulationResult

logger = logging.getLogger(__name__)

# =====================================================================
# 1. Calibration Parameter Constants
# =====================================================================
DESIGN_HORIZON_YEARS: float = 15.0  # Design Horizon (Years): y = 15
TRAFFIC_GROWTH_RATE: float = 0.03   # Traffic Growth Rate: r = 0.03
CALIBRATION_KC: float = 0.00005  # Adjusted daily Cracking Calibration Factor (k_c)
CALIBRATION_KR: float = 0.00008  # Adjusted daily Raveling Calibration Factor (k_r)
CALIBRATION_KP: float = 0.00002  # Adjusted daily Patching Calibration Factor (k_p)
CALIBRATION_KRUT: float = 0.00003  # Adjusted daily Rutting Calibration Factor (k_rut)

# IRI Transfer Coefficients
IRI_A0: float = 0.0005   # Reduced daily traffic load IRI coefficient
IRI_A1: float = 0.005    # Cracking IRI coefficient
IRI_A2: float = 0.002    # Patching IRI coefficient
IRI_A3: float = 0.00005  # Reduced daily rainfall IRI coefficient
IRI_A4: float = 0.003    # Rutting IRI coefficient


# =====================================================================
# 2. Road Health Classification & Color Mapping
# =====================================================================
def round_pci(pci_score: float) -> float:
    """
    PCI score rounded to 2 decimal places as float (stored as float8 in database).
    """
    return round(float(pci_score), 2)


def calculate_road_health(pci_score: float) -> str:
    """
    Classify road condition health status based on float PCI:
      85.0 - 100.0 -> Good
      70.0 - 84.99 -> Fair
      55.0 - 69.99 -> Poor
      < 55.0       -> Very Poor
    """
    pci = float(pci_score)
    if pci >= 85.0:
        return "Good"
    elif pci >= 70.0:
        return "Fair"
    elif pci >= 55.0:
        return "Poor"
    else:
        return "Very Poor"


def get_health_color_hex(road_health: str) -> str:
    """
    Return map indicator color hex based on road health classification:
      - 85-100: 'Good' (#10B981)
      - 70-84: 'Fair' (#F59E0B)
      - 55-69: 'Poor' (#EF4444)
      - <55: 'Very Poor' (#991B1B)
    """
    colors = {
        "Good": "#10B981",       # Green
        "Fair": "#F59E0B",       # Amber / Yellow
        "Poor": "#EF4444",       # Red
        "Very Poor": "#991B1B",  # Dark Red
    }
    return colors.get(road_health, "#991B1B")


# =====================================================================
# 3. Dynamic Time Step (delta_t) Calculation
# =====================================================================
def parse_timestamp_to_seconds(ts: Union[datetime, str, int, float]) -> float:
    """Convert various timestamp formats into UNIX epoch seconds."""
    if isinstance(ts, (int, float)):
        return float(ts)
    if isinstance(ts, datetime):
        return ts.timestamp()
    if isinstance(ts, str):
        cleaned = ts.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(cleaned).timestamp()
        except Exception:
            try:
                from dateutil import parser
                return parser.parse(ts).timestamp()
            except Exception:
                pass
    return datetime.now(timezone.utc).timestamp()


def calculate_delta_t(
    timestamp_current: Union[datetime, str, int, float],
    timestamp_last: Union[datetime, str, int, float],
) -> float:
    """
    Calculate delta_t dynamically in fractional days for scheduled background runs
    and manual on-demand triggers:
      delta_t = (Timestamp_current - Timestamp_last) / 86400.0
    """
    t_curr = parse_timestamp_to_seconds(timestamp_current)
    t_last = parse_timestamp_to_seconds(timestamp_last)
    return (t_curr - t_last) / 86400.0


# =====================================================================
# 4. Mechanistic Deterioration Step Calculation
# =====================================================================
def compute_mechanistic_step(
    static_props: Dict[str, Any],
    current_state: Dict[str, Any],
    weather_data: Dict[str, Any],
    delta_t: float,
    traffic_multiplier: float = 1.0,
) -> Dict[str, Any]:
    """
    Computes a single simulation step based on the exact mechanistic equations:

    (i) Cumulative Traffic Load (ESAL):
        ESAL_step = (AADT * 365 * LDF * ((1 + r)^y - 1)) / (r * 10^6)
        Cumulative_ESAL_{n+1} = Cumulative_ESAL_n + (ESAL_step * (delta_t / 365.0))

    (ii) Cracking Percentage (%):
        Delta_Cracking = k_c * ((Cumulative_ESAL_{n+1} / CBR)^1.2) * (1 + 0.1 * Rainfall_mm) * delta_t
        Cracking_{n+1} = min(100.0, Cracking_n + Delta_Cracking)

    (iii) Raveling Percentage (%):
        Delta_Raveling = k_r * ((MaxTemp / 25.0)^2) * (1 + Rainfall_mm) * delta_t
        Raveling_{n+1} = min(100.0, Raveling_n + Delta_Raveling)

    (iv) Patching Percentage (%):
        Delta_Patching = k_p * (Cracking_{n+1}^1.1) * delta_t
        Patching_{n+1} = min(100.0, Patching_n + Delta_Patching)

    (v) International Roughness Index (IRI):
        Delta_IRI = (a0 * Delta_ESAL) + (a1 * Delta_Cracking) + (a2 * Delta_Patching) + (a3 * Rainfall_mm)
        IRI_{n+1} = IRI_n + Delta_IRI

    (vi) Deduct Value Mapping & PCI:
        DV_cracking = 1.5 * Cracking_{n+1}
        DV_raveling = 0.8 * Raveling_{n+1}
        DV_patching = 1.2 * Patching_{n+1}
        DV_iri = 15.0 * max(0.0, IRI_{n+1} - 1.20)
        PCI_{n+1} = max(0.0, 100.0 - (DV_cracking + DV_raveling + DV_patching + DV_iri))
    """
    if delta_t <= 0:
        raise ValueError(f"delta_t must be positive (> 0), got {delta_t:.6f} days. Aborting calculation.")

    # 1. Traffic Load & Cumulative ESAL Increment
    aadt_base = float(
        static_props.get("aadt")
        or current_state.get("aadt")
        or static_props.get("base_daily_esal")
        or current_state.get("base_daily_esal", 5000.0)
    )
    aadt = aadt_base * traffic_multiplier
    ldf = float(static_props.get("ldf") or current_state.get("ldf", 0.5))

    y = DESIGN_HORIZON_YEARS
    r = TRAFFIC_GROWTH_RATE

    if abs(r) > 1e-7:
        growth_compounding = ((1.0 + r) ** y - 1.0) / r
    else:
        growth_compounding = y

    # ESAL_step = (AADT * 365 * LDF * ((1 + r)^y - 1)) / (r * 10^6)
    esal_step = (aadt * 365.0 * ldf * growth_compounding) / 1_000_000.0

    # Delta_ESAL = ESAL_step * (delta_t / 365.0)
    delta_esal = esal_step * (delta_t / 365.0)

    # Cumulative_ESAL_{n+1} = Cumulative_ESAL_n + (ESAL_step * (delta_t / 365.0))
    cumulative_esal_old = float(
        current_state.get("cumulative_esal_msa", current_state.get("cumulative_esal", 0.0))
    )
    cumulative_esal_next = cumulative_esal_old + delta_esal

    # 2. Weather Inputs
    rainfall_mm = float(
        weather_data.get("rainfall_mm")
        if weather_data.get("rainfall_mm") is not None
        else weather_data.get("daily_precipitation_mm", 0.0)
    )
    max_temp = float(
        weather_data.get("max_temp")
        if weather_data.get("max_temp") is not None
        else weather_data.get("temperature_c", 30.0)
    )

    # 3. Cracking Percentage (%)
    # Delta_Cracking = k_c * ((Cumulative_ESAL_{n+1} / CBR)^1.2) * (1 + 0.1 * Rainfall_mm) * delta_t
    cbr = float(static_props.get("cbr") or current_state.get("cbr", 5.0))
    cbr_safe = max(0.1, cbr)
    esal_cbr_ratio = max(0.0, cumulative_esal_next) / cbr_safe
    delta_cracking = CALIBRATION_KC * (esal_cbr_ratio ** 1.2) * (1.0 + 0.1 * rainfall_mm) * delta_t
    cracking_old = float(current_state.get("cracking_pct", 0.0))
    cracking_next = min(100.0, cracking_old + delta_cracking)
    actual_delta_cracking = cracking_next - cracking_old

    # 4. Raveling Percentage (%)
    # Delta_Raveling = k_r * ((MaxTemp / 25.0)^2) * (1 + Rainfall_mm) * delta_t
    temp_factor = (max_temp / 25.0) ** 2
    delta_raveling = CALIBRATION_KR * temp_factor * (1.0 + rainfall_mm) * delta_t
    raveling_old = float(current_state.get("raveling_pct", 0.0))
    raveling_next = min(100.0, raveling_old + delta_raveling)

    # 5. Rutting Depth (mm)
    # Delta_Rutting = k_rut * ((Cumulative_ESAL_{n+1} / CBR)^1.1) * (MaxTemp / 25.0) * delta_t
    delta_rut = CALIBRATION_KRUT * (esal_cbr_ratio ** 1.1) * (max_temp / 25.0) * delta_t
    rut_old = float(current_state.get("rut_depth_mm", current_state.get("rutting_mm", current_state.get("rut_mm", 0.0))))
    rut_next = max(0.0, rut_old + delta_rut)
    actual_delta_rut = rut_next - rut_old

    # 6. Patching Percentage (%)
    # Delta_Patching = k_p * (Cracking_{n+1}^1.1) * delta_t
    delta_patching = CALIBRATION_KP * (max(0.0, cracking_next) ** 1.1) * delta_t
    patching_old = float(current_state.get("patching_pct", 0.0))
    patching_next = min(100.0, patching_old + delta_patching)
    actual_delta_patching = patching_next - patching_old

    # 7. International Roughness Index (IRI in m/km)
    # Delta_IRI = (a0 * Delta_ESAL) + (a1 * Delta_Cracking) + (a2 * Delta_Patching) + (a4 * Delta_Rut) + (a3 * Rainfall_mm)
    iri_old = float(current_state.get("iri_m_km", 1.2))
    delta_iri = (
        (IRI_A0 * delta_esal)
        + (IRI_A1 * actual_delta_cracking)
        + (IRI_A2 * actual_delta_patching)
        + (IRI_A4 * actual_delta_rut)
        + (IRI_A3 * rainfall_mm)
    )
    iri_next = max(1.2, iri_old + delta_iri)

    # 8. Deduct Value Mapping & Dynamic PCI Calculation
    # PCI is dynamically calculated from cracking, rutting, raveling, patching, and IRI
    dv_cracking = 1.5 * max(0.0, cracking_next)
    dv_rutting = 1.0 * max(0.0, rut_next)
    dv_raveling = 0.8 * max(0.0, raveling_next)
    dv_patching = 1.2 * max(0.0, patching_next)
    dv_iri = min(35.0, 15.0 * max(0.0, iri_next - 1.20))

    total_dv = dv_cracking + dv_rutting + dv_raveling + dv_patching + dv_iri
    # PCI score dynamically changing with daily distress accumulation (never hardcoded)
    pci_next = round(max(0.0, min(100.0, 100.0 - total_dv)), 2)

    # Road health is dynamically computed strictly from the newly calculated pci_score
    road_health = calculate_road_health(pci_next)
    color = get_health_color_hex(road_health)

    pothole_pct_val = float(current_state.get("pothole_pct", 0.0))

    segment_id = current_state.get("segment_id") or static_props.get("segment_id")

    output_dict: Dict[str, Any] = {}
    if segment_id:
        output_dict["segment_id"] = segment_id

    output_dict["cumulative_esal_msa"] = round(cumulative_esal_next, 6)
    output_dict["delta_esal_msa"] = round(delta_esal, 6)
    output_dict["cracking_pct"] = round(cracking_next, 4)
    output_dict["delta_cracking"] = round(delta_cracking, 6)
    output_dict["rut_depth_mm"] = round(rut_next, 4)
    output_dict["delta_rut"] = round(delta_rut, 6)
    output_dict["raveling_pct"] = round(raveling_next, 4)
    output_dict["delta_raveling"] = round(delta_raveling, 6)
    output_dict["patching_pct"] = round(patching_next, 4)
    output_dict["delta_patching"] = round(delta_patching, 6)
    output_dict["iri_m_km"] = round(iri_next, 4)
    output_dict["delta_iri"] = round(delta_iri, 6)
    output_dict["pothole_pct"] = round(pothole_pct_val, 4)
    output_dict["pci_score"] = pci_next
    output_dict["road_health"] = road_health
    output_dict["color"] = color
    output_dict["color_hex"] = color
    output_dict["delta_t_days"] = round(delta_t, 4)
    output_dict["rainfall_mm"] = round(rainfall_mm, 2)
    output_dict["max_temp"] = round(max_temp, 2)
    output_dict["temperature_c"] = round(max_temp, 2)
    output_dict["deduct_values"] = {
        "cracking": round(dv_cracking, 2),
        "rutting": round(dv_rutting, 2),
        "raveling": round(dv_raveling, 2),
        "patching": round(dv_patching, 2),
        "iri": round(dv_iri, 2),
        "total": round(total_dv, 2),
    }

    return output_dict


def run_daily_degradation_step(
    current_state: Dict[str, Any],
    weather_data: Dict[str, Any],
    traffic_multiplier: float = 1.0,
    static_props: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Executes a single degradation step for daily simulation loops.
    Wrapper around compute_mechanistic_step with delta_t defaulting to 1.0 day.

    `static_props` (AADT, CBR, LDF, ...) MUST be passed explicitly for multi-day loops;
    otherwise the previous step's output — which does not carry static engineering
    properties — is reused and the model silently falls back to default AADT/CBR/LDF
    from the second day onward.
    """
    delta_t = float(current_state.get("delta_t", current_state.get("dt", 1.0)))
    return compute_mechanistic_step(
        static_props=static_props if static_props is not None else current_state,
        current_state=current_state,
        weather_data=weather_data,
        delta_t=delta_t,
        traffic_multiplier=traffic_multiplier,
    )


def simulate_segment_decay(
    segment_id: str,
    days: int,
    initial_metrics: Dict[str, Any],
    traffic_multiplier: float = 1.0,
    weather_severity: float = 1.0,
    maintenance_applied: bool = False,
) -> SimulationResult:
    """
    Simulates pavement deterioration across the specified number of days
    applying the mechanistic degradation formulas day-by-day.
    """
    state = dict(initial_metrics)
    state["segment_id"] = segment_id
    if "cumulative_esal_msa" not in state:
        state["cumulative_esal_msa"] = 0.0

    # Preserve the static engineering properties so they are reapplied on EVERY day.
    # (compute_mechanistic_step's output does not carry aadt/cbr/ldf, so without this
    # the loop would revert to default traffic/subgrade from day 2 onward.)
    static_props: Dict[str, Any] = {
        "segment_id": segment_id,
        "aadt": initial_metrics.get("aadt"),
        "ldf": initial_metrics.get("ldf"),
        "cbr": initial_metrics.get("cbr"),
        "base_daily_esal": initial_metrics.get("base_daily_esal"),
    }
    # Drop keys that were not provided so compute_mechanistic_step uses its own defaults.
    static_props = {k: v for k, v in static_props.items() if v is not None}

    init_pci = float(state.get("pci_score", 100.0))
    init_health = calculate_road_health(init_pci)

    # Translate weather_severity into precipitation & temperature
    effective_precip_mm = max(0.0, (weather_severity - 1.0) * 15.0)
    effective_max_temp = 30.0 + max(0.0, (weather_severity - 1.0) * 5.0)
    weather_data = {
        "daily_precipitation_mm": effective_precip_mm,
        "rainfall_mm": effective_precip_mm,
        "max_temp": effective_max_temp,
        "temperature_c": effective_max_temp,
    }

    effective_traffic = traffic_multiplier * (0.6 if maintenance_applied else 1.0)

    timeline: List[SimulationDayMetric] = []

    # Record day 0 baseline
    timeline.append(
        SimulationDayMetric(
            day=0,
            cumulative_esal_msa=state.get("cumulative_esal_msa", 0.0),
            cracking_pct=float(state.get("cracking_pct", 0.0)),
            raveling_pct=float(state.get("raveling_pct", 0.0)),
            patching_pct=float(state.get("patching_pct", 0.0)),
            iri_m_km=float(state.get("iri_m_km", 1.2)),
            pothole_pct=float(state.get("pothole_pct", 0.0)),
            rut_depth_mm=float(state.get("rut_depth_mm", 0.0)),
            pci_score=init_pci,
            road_health=init_health,
            color=get_health_color_hex(init_health),
            color_hex=get_health_color_hex(init_health),
        )
    )

    for day in range(1, days + 1):
        state = run_daily_degradation_step(
            current_state=state,
            weather_data=weather_data,
            traffic_multiplier=effective_traffic,
            static_props=static_props,
        )
        timeline.append(
            SimulationDayMetric(
                day=day,
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
    final_pci = final_state["pci_score"]
    final_health = final_state["road_health"]

    return SimulationResult(
        segment_id=segment_id,
        days=days,
        initial_pci=init_pci,
        final_pci=final_pci,
        initial_health=init_health,
        final_health=final_health,
        traffic_multiplier_applied=round(effective_traffic, 4),
        final_state=final_state,
        forecast=timeline,
        projected_decay_timeline=timeline,
    )
