"""Unit tests for GPX rebuilt from activity streams."""

from types import SimpleNamespace
from unittest.mock import patch

import modules.activities.activity.gpx_export as gpx_export
from modules.activities.activity.schema import ActivityRead


def _activity(**kw) -> ActivityRead:
    data = dict(
        id=1,
        user_id=1,
        distance=1000,
        name="Afternoon Walk",
        activity_type=11,
        calories=723,
        tracker_manufacturer="Fitbit",
        tracker_model="Fitbit Versa 4",
    )
    data.update(kw)
    return ActivityRead(**data)


def _stream(waypoints: list[dict]):
    return SimpleNamespace(stream_waypoints=waypoints)


def test_gpx_includes_track_points_hr_and_calories():
    gps = _stream(
        [
            {"time": "2026-11-05T13:20:00Z", "lat": 46.8, "lon": 17.4},
            {"time": "2026-11-05T13:20:05Z", "lat": 46.81, "lon": 17.41},
        ]
    )
    ele = _stream(
        [
            {"time": "2026-11-05T13:20:00Z", "ele": 170.2},
            {"time": "2026-11-05T13:20:05Z", "ele": 171.0},
        ]
    )
    hr = _stream(
        [
            {"time": "2026-11-05T13:20:00Z", "hr": 100},
            {"time": "2026-11-05T13:20:05Z", "hr": 113},
        ]
    )

    def _by_type(_activity_id, stream_type, _db):
        return {7: gps, 4: ele, 1: hr}.get(stream_type)

    with patch.object(gpx_export.activity_streams_integration, "get_stream_for_derivation", side_effect=_by_type):
        payload = gpx_export.gpx_bytes_from_streams(_activity(), db=None)

    assert payload is not None
    text = payload.decode("utf-8")
    assert "Afternoon Walk" in text
    assert 'lat="46.8"' in text
    assert "<ele>170.2</ele>" in text
    assert "<gpxtpx:hr>100</gpxtpx:hr>" in text or ">100</" in text
    assert "723" in text
    assert "Fitbit Versa 4" in text


def test_gpx_returns_none_without_gps():
    with patch.object(gpx_export.activity_streams_integration, "get_stream_for_derivation", return_value=None):
        assert gpx_export.gpx_bytes_from_streams(_activity(), db=None) is None
