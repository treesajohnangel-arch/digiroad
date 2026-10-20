import logging
from typing import Optional
from app.config import settings

logger = logging.getLogger(__name__)

TOMTOM_FLOW_URL = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json"


async def get_traffic_speed_multiplier(point_lat: float, point_lon: float) -> float:
    """
    Query TomTom Flow Segment Data API to evaluate local traffic congestion
    and return an empirical traffic speed multiplier between 1.0 and 1.5.

    Multiplier formula:
        multiplier = 1.0 + (1.0 - (current_speed / max(free_flow_speed, 1.0))) * 0.5
    Clamped strictly to [1.0, 1.5].

    Falls back safely to 1.0 if the API key is unconfigured, on network errors,
    or on invalid responses.
    """
    api_key = settings.TOMTOM_API_KEY

    # Safe fallback if API key is not provided or is placeholder
    if not api_key or "your-tomtom-api-key" in api_key.lower():
        logger.debug("TomTom API key not configured. Using default traffic speed multiplier 1.0.")
        return 1.0

    try:
        import httpx

        params = {
            "point": f"{point_lat},{point_lon}",
            "unit": "KMPH",
            "key": api_key,
        }

        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(TOMTOM_FLOW_URL, params=params)

            if response.status_code != 200:
                logger.warning(
                    f"TomTom Flow API returned status {response.status_code}: {response.text[:200]}"
                )
                return 1.0

            data = response.json()
            flow_data = data.get("flowSegmentData", {})

            current_speed = float(flow_data.get("currentSpeed", 60.0))
            free_flow_speed = float(flow_data.get("freeFlowSpeed", 60.0))

            # Calculate congestion multiplier
            speed_ratio = current_speed / max(free_flow_speed, 1.0)
            multiplier = 1.0 + (1.0 - speed_ratio) * 0.5

            # Clamp between 1.0 and 1.5
            clamped_multiplier = max(1.0, min(1.5, round(multiplier, 4)))
            return clamped_multiplier

    except Exception as exc:
        logger.warning(f"Error querying TomTom Flow Segment API: {exc}. Defaulting to 1.0.")
        return 1.0
