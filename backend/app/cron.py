import asyncio
import logging
from zoneinfo import ZoneInfo
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.services.simulations import execute_all_segments_simulation

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("weekly_simulation_cron")

IST = ZoneInfo("Asia/Kolkata")

async def run_weekly_simulation_job():
    """
    Scheduled task that runs every 7 days in IST:
    1. Fetches segment midpoint coordinates.
    2. Retrieves live weather via OpenWeather API.
    3. Executes a 7-day pavement decay step.
    4. Persists new evaluation records into both historic_road_evaluations 
       and dynamic_road_evaluations in Supabase.
    """
    logger.info("Executing scheduled 7-day pavement degradation simulation (IST)...")
    try:
        await execute_all_segments_simulation()
        logger.info("Weekly pavement degradation simulation completed successfully.")
    except Exception as e:
        logger.error(f"Error during weekly scheduled simulation: {e}")

if __name__ == "__main__":
    scheduler = AsyncIOScheduler(timezone=IST)
    
    # Schedule execution every 7 days
    scheduler.add_job(run_weekly_simulation_job, 'interval', days=7)
    
    # Trigger one immediate execution on worker start
    asyncio.run(run_weekly_simulation_job())
    
    logger.info("Weekly simulation cron worker active. Listening for 7-day intervals...")
    
    # Ensure event loop is active for AsyncIOScheduler across Python versions (Python 3.10-3.12+)
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    scheduler._eventloop = loop
    scheduler.start()

    try:
        asyncio.get_event_loop().run_forever()
    except (KeyboardInterrupt, SystemExit):
        pass
