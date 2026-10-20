"""
Background scheduler for DigiRoad.

Runs the pavement-degradation simulation for all registered road segments once a
week (every Monday). Each run pulls live weather at each segment midpoint, computes
the new road health, updates `dynamic_road_evaluations`, and appends a weekly snapshot
to `historic_road_evaluations`.

The scheduler is started/stopped from the FastAPI lifespan handler in app.main, so it
runs in-process with the API (no separate worker needed).
"""

import logging
from zoneinfo import ZoneInfo
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.services.simulations import execute_all_segments_simulation

logger = logging.getLogger("digiroad.scheduler")

# Indian Standard Time (IST)
IST = ZoneInfo("Asia/Kolkata")

# A fixed 7-day step keeps every weekly point a consistent interval, matching the
# historical cadence, even if a run is delayed or missed.
WEEKLY_STEP_DAYS = 7.0

_scheduler: AsyncIOScheduler | None = None


async def run_weekly_simulation_job() -> None:
    """Weekly job body: simulate every segment with a 7-day step using live weather."""
    logger.info("Starting weekly pavement degradation simulation (all segments)...")
    try:
        results = await execute_all_segments_simulation(force_delta_t_days=WEEKLY_STEP_DAYS)
        ok = sum(1 for r in results if r.get("status") == "success")
        logger.info("Weekly simulation complete: %d/%d segments updated.", ok, len(results))
    except Exception as e:
        logger.error("Weekly simulation job failed: %s", e, exc_info=True)


async def check_and_run_startup_catchup() -> None:
    """
    On application startup (e.g. after deployment to Railway), check if any segment's
    last simulation was >= 7 days ago. If so, automatically run the weekly simulation
    so the historical timeline never lags behind.
    """
    try:
        from app.services.supabase_client import supabase
        if supabase is not None:
            res = (
                supabase.table("dynamic_road_evaluations")
                .select("execution_timestamp")
                .order("execution_timestamp", desc=True)
                .limit(1)
                .execute()
            )
            if res.data and len(res.data) > 0:
                last_ts_str = res.data[0].get("execution_timestamp")
                if last_ts_str:
                    from datetime import datetime, timezone
                    last_ts = datetime.fromisoformat(last_ts_str.replace("Z", "+00:00"))
                    now = datetime.now(timezone.utc)
                    elapsed_days = (now - last_ts).total_seconds() / 86400.0
                    if elapsed_days >= 7.0:
                        logger.info(
                            f"Database last evaluated {elapsed_days:.1f} days ago (>= 7 days). "
                            "Triggering startup catch-up simulation..."
                        )
                        await run_weekly_simulation_job()
    except Exception as e:
        logger.warning(f"Startup simulation catch-up check skipped: {e}")


def start_scheduler() -> AsyncIOScheduler:
    """Create and start the AsyncIO scheduler with the Monday weekly trigger in IST (Asia/Kolkata)."""
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    scheduler = AsyncIOScheduler(timezone=IST)
    # Every Monday at 03:17 IST (Indian Standard Time).
    scheduler.add_job(
        run_weekly_simulation_job,
        trigger=CronTrigger(day_of_week="mon", hour=3, minute=17, timezone=IST),
        id="weekly_pavement_simulation",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.start()
    _scheduler = scheduler
    logger.info("Weekly simulation scheduler started (Mondays 03:17 IST).")

    # Schedule a non-blocking startup catch-up check if event loop is running
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(check_and_run_startup_catchup())
    except RuntimeError:
        pass

    return scheduler


def shutdown_scheduler() -> None:
    """Stop the scheduler cleanly on application shutdown."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("Weekly simulation scheduler stopped.")
