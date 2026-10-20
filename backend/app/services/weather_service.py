import os
import asyncio
import httpx
import logging
from typing import Dict, Any, Tuple, List, Optional
from datetime import datetime, timedelta
from pathlib import Path
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Ensure .env is loaded
BASE_DIR = Path(__file__).resolve().parent.parent.parent
ENV_PATH = BASE_DIR / ".env"
if ENV_PATH.exists():
    load_dotenv(dotenv_path=ENV_PATH)
else:
    load_dotenv()

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")


def calculate_segment_midpoint(segment_data: Dict[str, Any]) -> Tuple[float, float]:
    """
    Calculates the exact midpoint coordinates (average of start and end lat/lon)
    for a road segment, or returns midpoint_lat/midpoint_lon if explicitly present.
    """
    # 1. Check explicit midpoint fields
    mid_lat = segment_data.get("midpoint_lat")
    mid_lon = segment_data.get("midpoint_lon")
    if mid_lat is not None and mid_lon is not None:
        return float(mid_lat), float(mid_lon)

    # 2. Calculate average from start and end coordinates
    start_lat = segment_data.get("start_lat")
    start_lon = segment_data.get("start_lon")
    end_lat = segment_data.get("end_lat")
    end_lon = segment_data.get("end_lon")

    if start_lat is not None and end_lat is not None and start_lon is not None and end_lon is not None:
        calc_lat = (float(start_lat) + float(end_lat)) / 2.0
        calc_lon = (float(start_lon) + float(end_lon)) / 2.0
        return calc_lat, calc_lon

    # 3. Check coordinates field if dict or polyline array
    coords = segment_data.get("coordinates")
    if isinstance(coords, dict):
        lat = float(coords.get("lat", coords.get("latitude", 8.6253)))
        lon = float(coords.get("lon", coords.get("lng", coords.get("longitude", 76.9201))))
        return lat, lon
    elif isinstance(coords, list) and len(coords) > 0:
        if isinstance(coords[0], (int, float)) and len(coords) >= 2:
            return float(coords[0]), float(coords[1])
        elif isinstance(coords[0], list) and len(coords[0]) >= 2:
            avg_lat = sum(c[0] for c in coords) / len(coords)
            avg_lon = sum(c[1] for c in coords) / len(coords)
            return avg_lat, avg_lon

    # Fallback to default MDR 47 corridor midpoint
    return 8.6253, 76.9201


# Open-Meteo Forecast / Recent Daily endpoint (free, no API key required).
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


async def fetch_live_weather(lat: float = 8.6253, lon: float = 76.9201, days: int = 7) -> Dict[str, Any]:
    """
    Fetches real weather for given coordinates over the recent interval (default 7 days).
    Primary: Open-Meteo API (free, highly accurate accumulated rainfall and daily max temperatures).
    Secondary: OpenWeather API (if Open-Meteo is unreachable).
    Fallback: Sane Kerala climate averages (rainfall=0.0mm, max_temp=30.0°C).
    """
    # 1. Try Open-Meteo (preferred: exact 7-day accumulated rainfall & mean max temp, no API key needed)
    try:
        params = {
            "latitude": lat,
            "longitude": lon,
            "past_days": days,
            "forecast_days": 1,
            "daily": "temperature_2m_max,precipitation_sum,rain_sum,temperature_2m_mean",
            "timezone": "auto",
        }
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(OPEN_METEO_FORECAST_URL, params=params)
            if response.status_code == 200:
                data = response.json()
                daily = data.get("daily", {})
                temps = daily.get("temperature_2m_max") or daily.get("temperature_2m_mean") or []
                rains = daily.get("precipitation_sum") or daily.get("rain_sum") or []

                # Take exact past days (up to 7 days)
                slice_temps = temps[:days]
                slice_rains = rains[:days]

                valid_rains = [float(r) for r in slice_rains if r is not None]
                valid_temps = [float(t) for t in slice_temps if t is not None]

                total_rain = round(sum(valid_rains), 2) if valid_rains else 0.0
                mean_temp = round(sum(valid_temps) / len(valid_temps), 2) if valid_temps else 30.0

                logger.info(
                    f"Fetched Open-Meteo past {days}-day weather for ({lat:.4f}, {lon:.4f}): "
                    f"accumulated rain={total_rain}mm, mean temp={mean_temp}°C"
                )
                return {
                    "rainfall_mm": total_rain,
                    "max_temp": mean_temp,
                    "total_rain_mm": total_rain,
                    "avg_temp_c": mean_temp,
                }
    except Exception as e:
        logger.warning(f"Open-Meteo recent weather fetch failed: {e}. Trying OpenWeather fallback...")

    # 2. Try OpenWeather API fallback if configured
    api_key = os.getenv("OPENWEATHER_API_KEY", OPENWEATHER_API_KEY)
    if api_key and "your-" not in api_key.lower():
        url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={api_key}&units=metric"
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    data = response.json()
                    max_temp = float(data.get("main", {}).get("temp_max", 30.0))
                    rain_data = data.get("rain", {})
                    rainfall_mm = float(rain_data.get("1h", rain_data.get("3h", 0.0)))
                    return {
                        "rainfall_mm": rainfall_mm,
                        "max_temp": max_temp,
                    }
        except Exception as e:
            logger.warning(f"OpenWeather API fallback also failed: {e}")

    # 3. Default climate fallback
    return {"rainfall_mm": 0.0, "max_temp": 30.0}


# Open-Meteo Historical Archive endpoint (free, no API key required).
OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"


class WeatherDataError(RuntimeError):
    """Historical weather could not be fetched, or does not cover every requested day."""


async def fetch_historical_weather_series(
    lat: float,
    lon: float,
    start_date: str,
    end_date: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Dict[str, float]]:
    """
    Fetches real historical daily weather from the Open-Meteo Archive API for the
    given coordinates and date range (inclusive). Used for backfilling the 2022->2026
    historical simulation with true per-date weather.

    Args:
        lat, lon: segment midpoint coordinates.
        start_date, end_date: 'YYYY-MM-DD' strings.
        meta: optional dict that receives the grid cell Open-Meteo actually used
              (latitude, longitude, elevation, timezone).

    Returns:
        A mapping of date string -> {"max_temp": °C, "rainfall_mm": mm}. Days Open-Meteo
        has no value for are left out (never filled with defaults), so callers can see gaps.

    Raises:
        WeatherDataError: if the archive cannot be reached or rejects the request after retries.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "daily": "temperature_2m_max,precipitation_sum",
        "timezone": "auto",
    }

    last_error = ""
    for attempt in range(1, 4):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(OPEN_METEO_ARCHIVE_URL, params=params)

            if response.status_code == 200:
                data = response.json()
                daily = data.get("daily") or {}
                times = daily.get("time") or []
                temps = daily.get("temperature_2m_max") or []
                rains = daily.get("precipitation_sum") or []

                series: Dict[str, Dict[str, float]] = {}
                skipped = 0
                for i, day_str in enumerate(times):
                    t = temps[i] if i < len(temps) else None
                    r = rains[i] if i < len(rains) else None
                    if t is None or r is None:
                        skipped += 1
                        continue
                    series[day_str] = {"max_temp": float(t), "rainfall_mm": float(r)}

                if meta is not None:
                    meta.update({k: data.get(k) for k in ("latitude", "longitude", "elevation", "timezone")})
                logger.info(
                    f"Fetched {len(series)} days of Open-Meteo history for ({lat:.4f}, {lon:.4f}) "
                    f"[{start_date} -> {end_date}], {skipped} day(s) without data"
                )
                return series

            last_error = f"HTTP {response.status_code}: {response.text[:200]}"
            if response.status_code != 429 and response.status_code < 500:
                break  # e.g. a date outside the archive: retrying will not help
        except Exception as e:
            last_error = f"{type(e).__name__}: {e}"

        logger.warning(f"Open-Meteo fetch attempt {attempt} failed: {last_error}")
        if attempt < 3:
            await asyncio.sleep(1.5 * attempt)

    raise WeatherDataError(
        f"Open-Meteo archive request for ({lat}, {lon}) {start_date} -> {end_date} failed: {last_error}"
    )


def aggregate_weather_for_step(
    series: Dict[str, Dict[str, float]],
    step_start: "datetime",
    step_end: "datetime",
    fallback: Optional[Dict[str, float]] = None,
    strict: bool = False,
) -> Dict[str, float]:
    """
    Aggregates a daily weather series into a single step covering [step_start, step_end):
      - rainfall_mm = SUM of daily precipitation across the interval (accumulated rainfall)
      - max_temp    = MEAN of daily max temperatures across the interval
    With strict=True every day in the window must be present, otherwise WeatherDataError
    names the missing dates. Without it, falls back to `fallback` (or a sane default)
    if no days are present in the window.
    """
    fallback = fallback or {"rainfall_mm": 0.0, "max_temp": 30.0}

    day = step_start
    temps: List[float] = []
    total_rain = 0.0
    missing: List[str] = []
    while day < step_end:
        key = day.strftime("%Y-%m-%d")
        rec = series.get(key)
        if rec is None:
            missing.append(key)
        else:
            total_rain += float(rec.get("rainfall_mm", 0.0))
            temps.append(float(rec.get("max_temp", fallback["max_temp"])))
        day = day + timedelta(days=1)

    if strict and (missing or not temps):
        detail = ", ".join(missing) if missing else "empty window"
        raise WeatherDataError(
            f"Weather for {step_start:%Y-%m-%d} -> {step_end:%Y-%m-%d} is incomplete ({detail})"
        )
    if not temps:
        return dict(fallback)

    mean_temp = sum(temps) / len(temps)
    return {"rainfall_mm": round(total_rain, 2), "max_temp": round(mean_temp, 2)}
