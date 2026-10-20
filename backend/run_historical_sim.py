"""
ONE-TIME historical backfill / regeneration for DigiRoad.

Rebuilds the 2022-10-01 -> 2026-10-12 history for the 3 MDR-47 segments using REAL
historical weather from the Open-Meteo Archive API at each segment's midpoint exactly
as stored in public.road_segments (midpoint_lat / midpoint_lon), the mechanistic decay
model, and the segment's real engineering properties.

Writes one snapshot per step into public.historic_road_evaluations and leaves
public.dynamic_road_evaluations at each segment's final state. Steps are 7 days; when
the range is not a whole number of weeks, the last step is shorter and is simulated
with its real length.

Safe by design:
  - Everything is read and computed first (segment data, weather for every single day,
    all records). If anything is missing or fails, it stops before deleting anything.
  - It refuses to run if the weekly job has already added rows after END_DATE.
  - The rows it replaces are saved to backend/backups/ first, and a segment whose new
    rows cannot be stored gets its old rows put back.

Run it only in an environment with network access to Supabase and Open-Meteo:

    cd backend && .venv/bin/python run_historical_sim.py --dry-run      # compute and compare, writes nothing
    cd backend && .venv/bin/python run_historical_sim.py --regenerate   # DESTRUCTIVE: replace the history
"""

import sys
import json
import asyncio
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.services.supabase_client import supabase
from app.services.simulations import SegmentDataError, static_props_from_row
from app.services.decay_model import calculate_road_health, compute_mechanistic_step, round_pci
from app.services.weather_service import (
    WeatherDataError,
    aggregate_weather_for_step,
    fetch_historical_weather_series,
)

START_DATE = datetime(2022, 10, 1, 0, 0, 0, tzinfo=timezone.utc)
END_DATE = datetime(2026, 10, 12, 0, 0, 0, tzinfo=timezone.utc)
SEGMENTS = ["MDR47-S01", "MDR47-S02", "MDR47-S03"]
STEP_DAYS = 7
BACKUP_DIR = Path(__file__).resolve().parent / "backups"

# Static engineering properties that must be reapplied on every step.
STATIC_KEYS = ("segment_id", "aadt", "ldf", "cbr", "base_daily_esal")

# Columns compared when reporting what a regeneration changes.
COMPARE_KEYS = (
    "pci_score", "road_health", "cumulative_esal_msa", "cracking_pct", "raveling_pct",
    "patching_pct", "iri_m_km", "rainfall_mm", "temperature_c",
)


class RegenerationError(RuntimeError):
    """The regeneration cannot continue safely."""


def _ts(value: Any) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _fetch_all(table: str) -> List[Dict[str, Any]]:
    """Every row of `table` for SEGMENTS, paged past PostgREST's per-request row limit."""
    rows: List[Dict[str, Any]] = []
    page = 1000
    while True:
        batch = (
            supabase.table(table)
            .select("*")
            .in_("segment_id", SEGMENTS)
            .order("evaluation_id")
            .range(len(rows), len(rows) + page - 1)
            .execute()
        ).data or []
        rows.extend(batch)
        if len(batch) < page:
            return rows


def load_inputs() -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Read-only: the segment rows, plus the current history and live rows for SEGMENTS."""
    try:
        res = supabase.table("road_segments").select("*").in_("segment_id", SEGMENTS).execute()
        segment_rows = {r["segment_id"]: r for r in (res.data or [])}
        old_history = _fetch_all("historic_road_evaluations")
        old_live = _fetch_all("dynamic_road_evaluations")
    except Exception as e:
        raise RegenerationError(f"Could not read the current data from Supabase: {e}") from e

    missing = [sid for sid in SEGMENTS if sid not in segment_rows]
    if missing:
        raise RegenerationError(f"Not found in road_segments: {', '.join(missing)}")
    for sid in SEGMENTS:
        if segment_rows[sid].get("midpoint_lat") is None or segment_rows[sid].get("midpoint_lon") is None:
            raise RegenerationError(f"{sid} has no midpoint_lat / midpoint_lon in road_segments")

    later = [r for r in old_history if _ts(r["evaluation_timestamp"]) > END_DATE]
    if later:
        raise RegenerationError(
            f"{len(later)} historic row(s) are dated after {END_DATE:%Y-%m-%d} (added by the weekly job). "
            "Rebuilding the history underneath them would leave them inconsistent."
        )
    return segment_rows, old_history, old_live


async def build_segment(seg_row: Dict[str, Any]) -> Dict[str, Any]:
    """Fetch the weather and simulate one segment, entirely in memory."""
    segment_id = seg_row["segment_id"]
    try:
        static_props = static_props_from_row(seg_row)
    except SegmentDataError as e:
        raise RegenerationError(str(e)) from e

    # Real daily weather at the midpoint stored in road_segments, for every day in [START_DATE, END_DATE).
    mid_lat, mid_lon = float(seg_row["midpoint_lat"]), float(seg_row["midpoint_lon"])
    grid: Dict[str, Any] = {}
    try:
        weather_series = await fetch_historical_weather_series(
            mid_lat,
            mid_lon,
            START_DATE.strftime("%Y-%m-%d"),
            (END_DATE - timedelta(days=1)).strftime("%Y-%m-%d"),
            meta=grid,
        )
    except WeatherDataError as e:
        raise RegenerationError(f"{segment_id}: {e}") from e

    static_fixed = {k: static_props[k] for k in STATIC_KEYS if static_props.get(k) is not None}
    state: Dict[str, Any] = {
        "segment_id": segment_id,
        "pci_score": 100.0,
        "cracking_pct": 0.0,
        "raveling_pct": 0.0,
        "patching_pct": 0.0,
        "pothole_pct": 0.0,
        "iri_m_km": 1.2,
        "cumulative_esal_msa": 0.0,
    }

    records: List[Dict[str, Any]] = []
    step_days: List[float] = []
    step_end = START_DATE
    while step_end < END_DATE:
        step_start = step_end
        step_end = min(step_start + timedelta(days=STEP_DAYS), END_DATE)
        # A short final step is simulated with its real length, not as a full week.
        delta_t = (step_end - step_start).total_seconds() / 86400.0
        try:
            step_weather = aggregate_weather_for_step(weather_series, step_start, step_end, strict=True)
        except WeatherDataError as e:
            raise RegenerationError(f"{segment_id}: {e}") from e

        state = compute_mechanistic_step(
            static_props=static_fixed,
            current_state=state,
            weather_data=step_weather,
            delta_t=delta_t,
            traffic_multiplier=1.0,
        )
        pci_int = round_pci(state["pci_score"])
        if calculate_road_health(pci_int) != state["road_health"]:
            raise RegenerationError(f"{segment_id}: PCI {pci_int} would be stored as '{state['road_health']}'")

        step_days.append(delta_t)
        records.append({
            "segment_id": segment_id,
            "evaluation_timestamp": step_end.isoformat(),
            "pci_score": pci_int,
            "iri_m_km": float(state["iri_m_km"]),
            "cracking_pct": float(state["cracking_pct"]),
            "raveling_pct": float(state["raveling_pct"]),
            "patching_pct": float(state["patching_pct"]),
            "road_health": state["road_health"],
            "cumulative_esal_msa": float(state["cumulative_esal_msa"]),
            "rainfall_mm": float(state["rainfall_mm"]),
            "temperature_c": float(state["max_temp"]),
        })

    live = {
        "segment_id": segment_id,
        "pci_score": round_pci(state["pci_score"]),
        "iri_m_km": float(state["iri_m_km"]),
        "cracking_pct": float(state["cracking_pct"]),
        "raveling_pct": float(state["raveling_pct"]),
        "patching_pct": float(state["patching_pct"]),
        "pothole_pct": float(state.get("pothole_pct", 0.0)),
        "road_health": state["road_health"],
        "cumulative_esal_msa": float(state["cumulative_esal_msa"]),
        "rainfall_mm": float(state["rainfall_mm"]),
        "max_temperature_c": float(state["max_temp"]),
        "execution_timestamp": END_DATE.isoformat(),
    }
    return {
        "segment_id": segment_id,
        "road_name": static_props.get("road_name"),
        "midpoint": (mid_lat, mid_lon),
        "grid": grid,
        "weather_days": len(weather_series),
        "step_days": step_days,
        "records": records,
        "live": live,
    }


def _differs(old: Any, new: Any) -> bool:
    if isinstance(old, (int, float)) and isinstance(new, (int, float)):
        return abs(float(old) - float(new)) > 1e-9
    return old != new


def print_summary(built: Dict[str, Any], old_rows: List[Dict[str, Any]], old_live: Optional[Dict[str, Any]]) -> None:
    """What was computed for one segment, and how it differs from the rows in the database now."""
    last = built["records"][-1]
    grid = built["grid"]
    steps = Counter(built["step_days"])
    print(f"\n🛣️  {built['segment_id']} ({built['road_name']})")
    print(
        f"   Midpoint from road_segments: ({built['midpoint'][0]}, {built['midpoint'][1]}) "
        f"-> Open-Meteo grid cell ({grid.get('latitude')}, {grid.get('longitude')})"
    )
    print(f"   Weather: {built['weather_days']} days from Open-Meteo, none missing")
    print("   Steps:   " + ", ".join(f"{n} x {d:g} days" for d, n in sorted(steps.items(), reverse=True)))
    print(
        f"   Final {END_DATE:%Y-%m-%d}: PCI {last['pci_score']} ({last['road_health']}), "
        f"cracking {last['cracking_pct']}%, raveling {last['raveling_pct']}%, "
        f"IRI {last['iri_m_km']}, ESAL {last['cumulative_esal_msa']} msa"
    )

    old_by_ts = {_ts(r["evaluation_timestamp"]): r for r in old_rows}
    new_ts = {_ts(r["evaluation_timestamp"]) for r in built["records"]}
    mislabelled = sum(1 for r in old_rows if calculate_road_health(r["pci_score"]) != r["road_health"])
    changes = []
    for rec in built["records"]:
        old = old_by_ts.get(_ts(rec["evaluation_timestamp"]))
        if old is None:
            changes.append(f"+ {rec['evaluation_timestamp'][:10]} (new row)")
            continue
        diffs = [f"{k} {old.get(k)} -> {rec[k]}" for k in COMPARE_KEYS if _differs(old.get(k), rec[k])]
        if diffs:
            changes.append(f"~ {rec['evaluation_timestamp'][:10]}: " + "; ".join(diffs))
    dropped = len(set(old_by_ts) - new_ts)

    print(
        f"   Versus the database now: {len(old_rows)} rows ({mislabelled} with a PCI/label mismatch); "
        f"{len(changes)} row(s) change, {dropped} old row(s) have no regenerated counterpart"
    )
    for line in changes[:15]:
        print(f"     {line}")
    if len(changes) > 15:
        print(f"     ... and {len(changes) - 15} more")
    if old_live:
        print(
            f"   Live row: PCI {old_live.get('pci_score')} -> {built['live']['pci_score']}, "
            f"ESAL {old_live.get('cumulative_esal_msa')} -> {built['live']['cumulative_esal_msa']}, "
            f"as of {old_live.get('execution_timestamp')} -> {built['live']['execution_timestamp']}"
        )


def write_backup(old_history: List[Dict[str, Any]], old_live: List[Dict[str, Any]]) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    path = BACKUP_DIR / f"history_backup_{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json"
    path.write_text(json.dumps(
        {"historic_road_evaluations": old_history, "dynamic_road_evaluations": old_live},
        indent=1,
        default=str,
    ))
    return path


def replace_segment(built: Dict[str, Any], old_rows: List[Dict[str, Any]]) -> None:
    """Swap one segment's history for the regenerated rows, then update its live row."""
    segment_id = built["segment_id"]
    try:
        supabase.table("historic_road_evaluations").delete().eq("segment_id", segment_id).execute()
        # One request is one transaction: either every new row is stored or none is.
        supabase.table("historic_road_evaluations").insert(built["records"]).execute()
    except Exception as e:
        # Whatever state the segment was left in, put the old rows back.
        restore = [{k: v for k, v in r.items() if k != "evaluation_id"} for r in old_rows]
        try:
            supabase.table("historic_road_evaluations").delete().eq("segment_id", segment_id).execute()
            if restore:
                supabase.table("historic_road_evaluations").insert(restore).execute()
        except Exception as e2:
            raise RegenerationError(
                f"{segment_id}: replacing the history failed ({e}) and putting the old rows back "
                f"also failed ({e2}). Restore them from the backup file."
            ) from e2
        raise RegenerationError(f"{segment_id}: replacing the history failed, old rows put back: {e}") from e

    try:
        res = (
            supabase.table("dynamic_road_evaluations")
            .update(built["live"])
            .eq("segment_id", segment_id)
            .execute()
        )
        if not res.data:
            supabase.table("dynamic_road_evaluations").insert(built["live"]).execute()
    except Exception as e:
        raise RegenerationError(
            f"{segment_id}: history replaced, but updating dynamic_road_evaluations failed: {e}. "
            "Re-run with --regenerate to finish."
        ) from e


async def run_regeneration(write: bool) -> int:
    if supabase is None:
        print("❌ Supabase client is not configured. Set SUPABASE_URL / SUPABASE_KEY in backend/.env.")
        return 1

    print("==================================================")
    print(f"🚀 {'REGENERATING' if write else 'DRY RUN OF'} HISTORY {START_DATE:%Y-%m-%d} -> {END_DATE:%Y-%m-%d} "
          "WITH REAL OPEN-METEO WEATHER")
    print("==================================================")

    # 1. Read and compute everything first; nothing is deleted unless this succeeds for every segment.
    try:
        segment_rows, old_history, old_live = load_inputs()
        built = []
        for sid in SEGMENTS:
            print(f"   📡 {sid}: fetching Open-Meteo weather and simulating...")
            built.append(await build_segment(segment_rows[sid]))
    except RegenerationError as e:
        print(f"\n❌ {e}\n   Stopped before changing anything; the database is untouched.")
        return 1

    live_by_segment = {r["segment_id"]: r for r in old_live}
    for b in built:
        old_rows = [r for r in old_history if r["segment_id"] == b["segment_id"]]
        print_summary(b, old_rows, live_by_segment.get(b["segment_id"]))

    if not write:
        print("\nDry run complete: nothing was written. Re-run with --regenerate to replace the history.")
        return 0

    # 2. Back up everything that is about to be replaced.
    try:
        backup_path = write_backup(old_history, old_live)
    except Exception as e:
        print(f"\n❌ Could not write the backup file ({e}); nothing was changed.")
        return 1
    print(f"\n💾 Backed up {len(old_history)} historic and {len(old_live)} live rows to {backup_path}")

    # 3. Replace one segment at a time.
    for b in built:
        old_rows = [r for r in old_history if r["segment_id"] == b["segment_id"]]
        try:
            replace_segment(b, old_rows)
        except RegenerationError as e:
            print(f"\n❌ {e}\n   Backup of the original rows: {backup_path}")
            return 1
        print(f"   ✓ {b['segment_id']}: {len(b['records'])} historic rows written, live state as of {END_DATE:%Y-%m-%d}")

    print("\n✅ Regeneration complete.\n")
    return 0


def main() -> None:
    if "--dry-run" in sys.argv:
        sys.exit(asyncio.run(run_regeneration(write=False)))
    if "--regenerate" in sys.argv or "--reset-db" in sys.argv:
        sys.exit(asyncio.run(run_regeneration(write=True)))
    print(__doc__)
    print(">>> This is DESTRUCTIVE. Run with --dry-run first, then --regenerate to replace the history.")


if __name__ == "__main__":
    main()
