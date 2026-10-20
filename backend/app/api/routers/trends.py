import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Query, HTTPException, status
from pydantic import BaseModel
from app.services.supabase_client import supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/trends", tags=["Historical Trends"])


from app.schemas.trends import PCIDatapoint, MetricBoxSummary, TrendResponse


@router.get("/line-graph", response_model=TrendResponse)
async def get_historical_line_graph(
    segment_id: Optional[str] = Query(None, description="Road segment ID/Name. Optional to prevent 422 errors on initial load."),
    target_date: Optional[str] = Query(None, description="Format YYYY-MM-DD. Defaults to the segment's latest available evaluation when omitted."),
    window_days: int = Query(30, ge=7, le=3650, description="Look-back window in days for the PCI line graph (default 30)."),
):
    """
    Historical Pavement Trends Endpoint:
    1. Returns a 200 OK empty response state if segment_id is omitted or empty.
    2. If target_date is omitted, resolves to the segment's LATEST stored evaluation
       (so the graph always shows the most recent trend instead of an empty 'today').
    3. If target_date is given, resolves to the evaluation on or immediately after it.
    4. Builds a look-back window of `window_days` ending at the resolved date.
    5. Samples records at >= 7-day intervals for the PCI Score vs Date line graph.
    6. Extracts a snapshot metric summary from the resolved date.
    """
    # 1. Validate target_date format if provided.
    target_date_provided = bool(target_date and target_date.strip())
    if target_date_provided:
        target_date = target_date.strip()
        try:
            datetime.strptime(target_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid target_date format: '{target_date}'. Expected YYYY-MM-DD.",
            )
    else:
        target_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # 2. Guard Clause: Missing / None / Empty segment_id -> Return 200 OK empty state
    if not segment_id or not segment_id.strip():
        return TrendResponse(
            segment_id=None,
            target_date=target_date,
            effective_target_date=None,
            start_date=None,
            interval_days=7,
            datapoints_count=0,
            summary=None,
            data=[],
        )

    segment_id = segment_id.strip()

    if supabase is None:
        logger.error("Supabase client is not initialized.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database service is unavailable.",
        )

    empty_state = TrendResponse(
        segment_id=segment_id,
        target_date=target_date,
        effective_target_date=None,
        start_date=None,
        interval_days=7,
        datapoints_count=0,
        summary=None,
        data=[],
    )

    # 3. Resolve the effective evaluation row.
    try:
        if target_date_provided:
            # First evaluation on or after the requested date.
            candidate_res = (
                supabase.table("historic_road_evaluations")
                .select("*")
                .eq("segment_id", segment_id)
                .gte("evaluation_timestamp", target_date)
                .order("evaluation_timestamp", desc=False)
                .limit(1)
                .execute()
            )
        else:
            # Latest available evaluation for the segment.
            candidate_res = (
                supabase.table("historic_road_evaluations")
                .select("*")
                .eq("segment_id", segment_id)
                .order("evaluation_timestamp", desc=True)
                .limit(1)
                .execute()
            )

        if not candidate_res.data or len(candidate_res.data) == 0:
            return empty_state

        resolved_row = candidate_res.data[0]
        raw_ts = str(resolved_row.get("evaluation_timestamp", ""))
        effective_target_date = raw_ts[:10]

        # 4. Look-back window: effective_target_date - window_days.
        eff_dt = datetime.strptime(effective_target_date, "%Y-%m-%d").date()
        start_dt = eff_dt - timedelta(days=window_days)
        start_date = start_dt.strftime("%Y-%m-%d")

        start_timestamp = f"{start_date}T00:00:00"
        end_timestamp = f"{effective_target_date}T23:59:59.999999"

        window_res = (
            supabase.table("historic_road_evaluations")
            .select("*")
            .eq("segment_id", segment_id)
            .gte("evaluation_timestamp", start_timestamp)
            .lte("evaluation_timestamp", end_timestamp)
            .order("evaluation_timestamp", desc=False)
            .execute()
        )
        window_records: List[Dict[str, Any]] = window_res.data or []

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Supabase query error in get_historical_line_graph: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to query historic road evaluations: {str(e)}",
        )

    # 5. Metric Box Summary (latest snapshot from the resolved effective date)
    records_on_resolved_date = [
        r for r in window_records
        if str(r.get("evaluation_timestamp", ""))[:10] == effective_target_date
    ]
    latest_snapshot = records_on_resolved_date[-1] if records_on_resolved_date else resolved_row

    summary = MetricBoxSummary(
        segment_id=segment_id,
        selected_date=effective_target_date,
        pci_score=round(float(latest_snapshot.get("pci_score", 0.0)), 2),
        iri_m_km=round(float(latest_snapshot.get("iri_m_km", 0.0)), 4),
        cracking_pct=round(float(latest_snapshot.get("cracking_pct", 0.0)), 4),
        raveling_pct=round(float(latest_snapshot.get("raveling_pct", 0.0)), 4),
        patching_pct=round(float(latest_snapshot.get("patching_pct", 0.0)), 4),
    )

    # 6. Line Graph Sampling: Filter dataset strictly at 7-day intervals
    daily_records: Dict[str, Dict[str, Any]] = {}
    for r in window_records:
        d_str = str(r.get("evaluation_timestamp", ""))[:10]
        if d_str:
            daily_records[d_str] = r

    if effective_target_date not in daily_records and resolved_row:
        daily_records[effective_target_date] = resolved_row

    unique_dates = sorted(daily_records.keys())

    # Sample maintaining strict 7-day intervals backwards from effective_target_date
    sampled_points: List[PCIDatapoint] = []
    last_selected_date: Optional[datetime.date] = None

    for d_str in reversed(unique_dates):
        d_dt = datetime.strptime(d_str, "%Y-%m-%d").date()
        if last_selected_date is None or (last_selected_date - d_dt).days >= 7:
            rec = daily_records[d_str]
            sampled_points.append(
                PCIDatapoint(
                    date=d_str,
                    pci_score=round(float(rec.get("pci_score", 0.0)), 2),
                )
            )
            last_selected_date = d_dt

    sampled_points.reverse()

    return TrendResponse(
        segment_id=segment_id,
        target_date=target_date,
        effective_target_date=effective_target_date,
        start_date=start_date,
        interval_days=7,
        datapoints_count=len(sampled_points),
        summary=summary,
        data=sampled_points,
    )
