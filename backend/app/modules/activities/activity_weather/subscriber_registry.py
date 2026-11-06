"""Subscriber registration and reconciliation for activity weather."""

from jasil.jobs.reconciliation import DurableSubscriberNet
from jasil.jobs.registry import JobHandlerRegistry
from jasil.providers import EventBusProvider

import modules.activities.activity_weather.scheduled_jobs as activity_weather_scheduled_jobs
import modules.activities.activity_weather.subscribers as activity_weather_subscribers


def register_bus_subscribers(events: EventBusProvider) -> None:
    """Register weather bus subscribers.

    Args:
        events: The event bus to subscribe on.
    """
    activity_weather_subscribers.register_weather_subscribers(events)


def register_durable_handlers(registry: JobHandlerRegistry) -> None:
    """Register weather durable handlers.

    Args:
        registry: The durable-handler registry.
    """
    activity_weather_subscribers.register_weather_durable_handlers(registry)


DURABLE_SUBSCRIBER_NETS: tuple[DurableSubscriberNet, ...] = (
    DurableSubscriberNet(
        activity_weather_subscribers.WEATHER_SUBSCRIBER_ID,
        activity_weather_scheduled_jobs.run_missing_weather_backfill,
    ),
)
