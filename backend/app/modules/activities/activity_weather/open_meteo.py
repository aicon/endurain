"""Open-Meteo hour lookup for an activity start, matching Dreeve's weather card."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
HOURLY = "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m"
USER_AGENT = "aicon-endurain-fork (https://github.com/aicon/endurain)"
TIMEOUT_S = 15
ARCHIVE_AFTER_DAYS = 5

_COMPASS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def wind_dir_from_degrees(degrees: float | int | None) -> str | None:
    """Map wind degrees to an eight-point compass label.

    Args:
        degrees: Meteorological wind direction in degrees.

    Returns:
        One of N/NE/E/SE/S/SW/W/NW, or None when the value is missing.
    """
    if degrees is None:
        return None
    try:
        heading = float(degrees) % 360
    except (TypeError, ValueError):
        return None
    return _COMPASS[int((heading + 22.5) // 45) % 8]


def pick_hour_index(times: list[str], local_start: datetime) -> int | None:
    """Return the hourly slot that contains ``local_start``.

    Args:
        times: Open-Meteo ``hourly.time`` values (``YYYY-MM-DDTHH:MM``).
        local_start: Activity start in the recording timezone.

    Returns:
        The matching index, or None.
    """
    hour_key = local_start.replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:00")
    try:
        return times.index(hour_key)
    except ValueError:
        prefix = hour_key[:13]
        for index, stamp in enumerate(times):
            if stamp.startswith(prefix):
                return index
        return None


def parse_hour(payload: dict[str, Any], local_start: datetime) -> dict[str, Any] | None:
    """Build the stored weather dict from one Open-Meteo JSON body.

    Args:
        payload: Decoded Open-Meteo response.
        local_start: Activity start in the recording timezone.

    Returns:
        Stored weather fields, or None when that hour is missing.
    """
    hourly = payload.get("hourly")
    if not isinstance(hourly, dict):
        return None
    times = hourly.get("time")
    if not isinstance(times, list) or not times:
        return None
    index = pick_hour_index([str(item) for item in times], local_start)
    if index is None:
        return None

    def number(primary: str, *aliases: str) -> float | None:
        for key in (primary, *aliases):
            series = hourly.get(key)
            if not isinstance(series, list) or index >= len(series):
                continue
            value = series[index]
            if value is None:
                return None
            try:
                return float(value)
            except (TypeError, ValueError):
                return None
        return None

    temperature = number("temperature_2m")
    if temperature is None:
        return None
    humidity = number("relative_humidity_2m", "relativehumidity_2m")
    wind = number("wind_speed_10m", "windspeed_10m")
    direction = number("wind_direction_10m", "winddirection_10m")
    code = number("weather_code", "weathercode")
    return {
        "temperature_c": round(temperature, 1),
        "humidity": None if humidity is None else int(round(humidity)),
        "wind_kmh": None if wind is None else round(wind, 1),
        "wind_dir": wind_dir_from_degrees(direction),
        "code": None if code is None else int(code),
        "unavailable": False,
    }


def local_start(start_time: datetime, timezone_name: str | None) -> datetime:
    """Convert the activity start into the recording timezone.

    Args:
        start_time: Activity start (aware or naive UTC).
        timezone_name: IANA zone, or None for UTC.

    Returns:
        The start instant in that zone.
    """
    aware = start_time if start_time.tzinfo is not None else start_time.replace(tzinfo=UTC)
    try:
        zone = ZoneInfo(timezone_name) if timezone_name else UTC
    except Exception:
        zone = UTC
    return aware.astimezone(zone)


def weather_url(local_start_at: datetime, latitude: float, longitude: float) -> str:
    """Choose forecast vs archive Open-Meteo URL for the activity day.

    Args:
        local_start_at: Activity start in the recording timezone.
        latitude: Start latitude.
        longitude: Start longitude.

    Returns:
        The request URL.
    """
    day = local_start_at.date().isoformat()
    use_archive = local_start_at.date() < datetime.now(tz=local_start_at.tzinfo).date() - timedelta(
        days=ARCHIVE_AFTER_DAYS
    )
    base = ARCHIVE_URL if use_archive else FORECAST_URL
    query = urllib.parse.urlencode(
        {
            "latitude": f"{latitude:.5f}",
            "longitude": f"{longitude:.5f}",
            "start_date": day,
            "end_date": day,
            "hourly": HOURLY,
            "wind_speed_unit": "kmh",
            "timezone": "auto",
        }
    )
    return f"{base}?{query}"


def fetch_weather_hour(
    latitude: float,
    longitude: float,
    start_time: datetime,
    timezone_name: str | None,
    *,
    opener: Any = None,
) -> dict[str, Any] | None:
    """Fetch the Open-Meteo hour for an activity start.

    Args:
        latitude: Start latitude.
        longitude: Start longitude.
        start_time: Activity start.
        timezone_name: IANA zone stored on the activity.
        opener: Optional ``urlopen`` for tests.

    Returns:
        Stored weather fields, or None when the request or hour fails.
    """
    started = local_start(start_time, timezone_name)
    url = weather_url(started, latitude, longitude)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    open_url = opener or urllib.request.urlopen
    try:
        with open_url(request, timeout=TIMEOUT_S) as response:
            body = response.read()
    except (urllib.error.URLError, TimeoutError, OSError):
        return None
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
        return None
    if not isinstance(payload, dict):
        return None
    return parse_hour(payload, started)
