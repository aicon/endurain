"""Event subscribers filling Open-Meteo weather off the ingestion path."""

import jasil.event_versioning as platform_event_versioning
from jasil.events import Event
from jasil.jobs.registry import JobHandlerRegistry
from jasil.providers import EventBusProvider
from jasil.subscribers import best_effort

import core.database as core_database
import core.logger as core_logger
import modules.activities.activity.events as activity_events
import modules.activities.activity_weather.service as activity_weather_service

logger = core_logger.get_logger(__name__)

WEATHER_SUBSCRIBER_ID = "activity_weather.open_meteo"


def fetch_weather_for_event(event: Event) -> None:
    """Fetch Open-Meteo weather for a created activity; raises on unexpected errors.

    Args:
        event: The ``activity.created`` event.
    """
    payload = platform_event_versioning.parse_payload(activity_events.ActivityCreatedPayload, event)
    with core_database.SessionLocal() as db:
        activity_weather_service.fetch_and_store_activity_weather(payload.activity_id, db)
    logger.debug(
        "Handled Open-Meteo weather for created activity",
        extra=core_logger.context(activity_id=payload.activity_id, user_id=payload.user_id),
    )


on_activity_created_weather = best_effort(fetch_weather_for_event)


def register_weather_subscribers(events: EventBusProvider) -> None:
    """Register the weather subscriber for ``activity.created``.

    Args:
        events: The event-bus provider to subscribe on.
    """
    events.subscribe(activity_events.ACTIVITY_CREATED, on_activity_created_weather)


def register_weather_durable_handlers(registry: JobHandlerRegistry) -> None:
    """Register the weather handler as a durable job subscriber.

    Args:
        registry: The durable-subscriber registry.
    """
    registry.register(
        activity_events.ACTIVITY_CREATED,
        WEATHER_SUBSCRIBER_ID,
        fetch_weather_for_event,
    )
