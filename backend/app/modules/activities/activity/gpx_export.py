"""Build a GPX 1.1 activity file from stored streams.

Used when an activity has no retained source file (``.gpx`` / ``.tcx`` / ``.fit``).
The layout matches the FitBridge Endurain upload: track name, Garmin
TrackPointExtension heart rate and cadence, optional calories on the track.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

import modules.activities.activity.constants as activity_constants
import modules.activities.activity.schema as activity_schema
import modules.activities.activity_streams.constants as activity_streams_constants
import modules.activities.activity_streams.integration_service as activity_streams_integration

GPX_NS = "http://www.topografix.com/GPX/1/1"
TPX_NS = "http://www.garmin.com/xmlschemas/TrackPointExtension/v1"


def _local_creator(activity: activity_schema.ActivityRead) -> str:
    manufacturer = (activity.tracker_manufacturer or "").strip()
    model = (activity.tracker_model or "").strip()
    if manufacturer and model:
        maker = manufacturer.lower()
        device = model.lower()
        if device.startswith(maker) or maker in device:
            return model if len(model) >= len(manufacturer) else manufacturer
        return f"{manufacturer} {model}"
    return manufacturer or model or "Endurain"


def _gpx_time(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        aware = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
        return aware.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    text = str(value).strip()
    return text or None


def _value_by_time(waypoints: list[dict], key: str) -> dict[str, Any]:
    index: dict[str, Any] = {}
    for waypoint in waypoints:
        stamp = _gpx_time(waypoint.get("time"))
        value = waypoint.get(key)
        if stamp is None or value is None:
            continue
        index[stamp] = value
    return index


def gpx_bytes_from_streams(activity: activity_schema.ActivityRead, db: Session) -> bytes | None:
    """Serialize GPS (and matching HR/cadence/elevation) streams as GPX 1.1.

    Args:
        activity: The owning activity (name, type, calories, device).
        db: Database session.

    Returns:
        UTF-8 GPX bytes, or ``None`` when there is no GPS track.
    """
    gps = activity_streams_integration.get_stream_for_derivation(
        activity.id,
        activity_streams_constants.STREAM_TYPE_MAP,
        db,
    )
    if gps is None or not gps.stream_waypoints:
        return None

    def stream_values(stream_type: int, key: str) -> dict[str, Any]:
        stream = activity_streams_integration.get_stream_for_derivation(activity.id, stream_type, db)
        if stream is None:
            return {}
        return _value_by_time(stream.stream_waypoints, key)

    elevation = stream_values(activity_streams_constants.STREAM_TYPE_ELEVATION, "ele")
    heart_rate = stream_values(activity_streams_constants.STREAM_TYPE_HR, "hr")
    cadence = stream_values(activity_streams_constants.STREAM_TYPE_CADENCE, "cad")
    sport = activity_constants.ACTIVITY_ID_TO_NAME.get(activity.activity_type, "Workout")

    gpx = ET.Element(f"{{{GPX_NS}}}gpx", {"version": "1.1", "creator": _local_creator(activity)})
    track = ET.SubElement(gpx, f"{{{GPX_NS}}}trk")
    ET.SubElement(track, f"{{{GPX_NS}}}name").text = activity.name
    ET.SubElement(track, f"{{{GPX_NS}}}type").text = sport
    if activity.calories is not None and activity.calories > 0:
        extensions = ET.SubElement(track, f"{{{GPX_NS}}}extensions")
        stats = ET.SubElement(extensions, f"{{{TPX_NS}}}TrackStatsExtension")
        ET.SubElement(stats, f"{{{TPX_NS}}}Calories").text = str(int(activity.calories))
    segment = ET.SubElement(track, f"{{{GPX_NS}}}trkseg")
    for waypoint in gps.stream_waypoints:
        latitude = waypoint.get("lat")
        longitude = waypoint.get("lon")
        if latitude is None or longitude is None:
            continue
        stamp = _gpx_time(waypoint.get("time"))
        point = ET.SubElement(
            segment,
            f"{{{GPX_NS}}}trkpt",
            {"lat": str(latitude), "lon": str(longitude)},
        )
        ele = waypoint.get("ele")
        if ele is None and stamp is not None:
            ele = elevation.get(stamp)
        if ele is not None:
            ET.SubElement(point, f"{{{GPX_NS}}}ele").text = str(ele)
        if stamp:
            ET.SubElement(point, f"{{{GPX_NS}}}time").text = stamp
        hr = waypoint.get("hr")
        cad = waypoint.get("cad")
        if stamp is not None:
            if hr is None:
                hr = heart_rate.get(stamp)
            if cad is None:
                cad = cadence.get(stamp)
        if hr is not None or cad is not None:
            extensions = ET.SubElement(point, f"{{{GPX_NS}}}extensions")
            tpx = ET.SubElement(extensions, f"{{{TPX_NS}}}TrackPointExtension")
            if hr is not None:
                ET.SubElement(tpx, f"{{{TPX_NS}}}hr").text = str(int(round(float(hr))))
            if cad is not None:
                ET.SubElement(tpx, f"{{{TPX_NS}}}cad").text = str(int(round(float(cad))))

    if segment.find(f"{{{GPX_NS}}}trkpt") is None:
        return None

    saved = dict(ET._namespace_map)
    try:
        ET.register_namespace("", GPX_NS)
        ET.register_namespace("gpxtpx", TPX_NS)
        return ET.tostring(gpx, encoding="utf-8", xml_declaration=True)
    finally:
        ET._namespace_map.clear()
        ET._namespace_map.update(saved)
