"""Resolve and persist Open-Meteo weather off the ingestion path."""

from datetime import timedelta

from jasil.providers import ClockProvider
from sqlalchemy.orm import Session

import core.logger as core_logger
import core.pagination as core_pagination
import modules.activities.activity.integration_service as activity_integration
import modules.activities.activity_streams.constants as activity_streams_constants
import modules.activities.activity_streams.integration_service as activity_streams_integration
import modules.activities.activity_weather.open_meteo as open_meteo

logger = core_logger.get_logger(__name__)

LOOKUP_RETRY_DELAY = timedelta(days=1)
UNAVAILABLE = {"unavailable": True}


def fetch_and_store_activity_weather(activity_id: int, db: Session) -> bool:
    """Load the first GPS point, fetch Open-Meteo, and store the hour.

    No-ops when weather is already stored. An activity with no GPS is marked
    unavailable so the backfill does not retry it every minute.

    Args:
        activity_id: The activity to fill.
        db: Database session.

    Returns:
        True when a weather hour was stored.
    """
    activity = activity_integration.get_activity_by_id(activity_id, db)
    if activity is None or activity.weather is not None:
        return False

    stream = activity_streams_integration.get_stream_for_derivation(
        activity_id,
        activity_streams_constants.STREAM_TYPE_MAP,
        db,
    )
    db.commit()
    if stream is None or not stream.stream_waypoints or activity.start_time is None:
        activity_integration.set_activity_weather(activity_id, UNAVAILABLE, db)
        db.commit()
        return False

    first = stream.stream_waypoints[0]
    latitude = first.get("lat")
    longitude = first.get("lon")
    if latitude is None or longitude is None:
        activity_integration.set_activity_weather(activity_id, UNAVAILABLE, db)
        db.commit()
        return False

    weather = open_meteo.fetch_weather_hour(
        float(latitude),
        float(longitude),
        activity.start_time,
        activity.timezone,
    )
    if weather is None:
        return False
    if activity_integration.set_activity_weather(activity_id, weather, db):
        db.commit()
        logger.debug("Stored Open-Meteo weather", extra=core_logger.context(activity_id=activity_id))
        return True
    return False


def backfill_missing_activity_weather(
    clock: ClockProvider,
    db: Session,
    *,
    max_lookups: int = core_pagination.DEFAULT_EXTERNAL_IO_BATCH_SIZE,
) -> int:
    """Fetch weather for activities that still have none.

    Args:
        clock: Platform clock.
        db: Database session.
        max_lookups: Maximum Open-Meteo requests this pass may make.

    Returns:
        How many weather hours were stored.
    """
    now = clock.now()
    retry_at = now + LOOKUP_RETRY_DELAY
    stored = 0
    lookups = 0
    deferred: list[int] = []
    after_id = 0
    while lookups < max_lookups:
        candidates = activity_integration.list_activities_missing_weather(db, due_at=now, after_id=after_id)
        if not candidates:
            break
        after_id = candidates[-1].id
        waypoints_by_activity = activity_streams_integration.get_gps_waypoints_for_activities(
            [ref.id for ref in candidates], db
        )
        db.commit()
        for ref in candidates:
            waypoints = waypoints_by_activity.get(ref.id)
            if not waypoints or ref.start_time is None:
                activity_integration.set_activity_weather(ref.id, UNAVAILABLE, db)
                db.commit()
                continue
            if lookups >= max_lookups:
                break
            lookups += 1
            first = waypoints[0]
            latitude = first.get("lat")
            longitude = first.get("lon")
            if latitude is None or longitude is None:
                activity_integration.set_activity_weather(ref.id, UNAVAILABLE, db)
                db.commit()
                continue
            weather = open_meteo.fetch_weather_hour(
                float(latitude),
                float(longitude),
                ref.start_time,
                ref.timezone,
            )
            if weather is None:
                deferred.append(ref.id)
                continue
            if activity_integration.set_activity_weather(ref.id, weather, db):
                db.commit()
                stored += 1
        if deferred:
            activity_integration.defer_weather_lookups(deferred, retry_at, db)
            db.commit()
            deferred = []
    return stored
