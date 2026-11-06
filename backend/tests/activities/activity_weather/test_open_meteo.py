"""Unit tests for Open-Meteo hour parsing."""

from datetime import datetime
from zoneinfo import ZoneInfo

import modules.activities.activity_weather.open_meteo as open_meteo


def test_wind_dir_from_degrees():
    assert open_meteo.wind_dir_from_degrees(0) == "N"
    assert open_meteo.wind_dir_from_degrees(45) == "NE"
    assert open_meteo.wind_dir_from_degrees(90) == "E"
    assert open_meteo.wind_dir_from_degrees(None) is None


def test_parse_hour_picks_the_start_slot():
    payload = {
        "hourly": {
            "time": ["2026-11-06T07:00", "2026-11-06T08:00"],
            "temperature_2m": [8.4, 9.1],
            "relative_humidity_2m": [81, 70],
            "weather_code": [61, 3],
            "wind_speed_10m": [14.2, 10.0],
            "wind_direction_10m": [320, 10],
        }
    }
    local = datetime(2026, 11, 6, 7, 25, tzinfo=ZoneInfo("Europe/Budapest"))
    weather = open_meteo.parse_hour(payload, local)
    assert weather == {
        "temperature_c": 8.4,
        "humidity": 81,
        "wind_kmh": 14.2,
        "wind_dir": "NW",
        "code": 61,
        "unavailable": False,
    }


def test_parse_hour_accepts_legacy_open_meteo_keys():
    payload = {
        "hourly": {
            "time": ["2026-11-06T07:00"],
            "temperature_2m": [12.0],
            "relativehumidity_2m": [50],
            "weathercode": [3],
            "windspeed_10m": [5],
            "winddirection_10m": [180],
        }
    }
    local = datetime(2026, 11, 6, 7, 0, tzinfo=ZoneInfo("UTC"))
    weather = open_meteo.parse_hour(payload, local)
    assert weather is not None
    assert weather["code"] == 3
    assert weather["wind_dir"] == "S"
