"""Scheduled Open-Meteo backfill for activities that still have no weather."""

import jasil.runtime as platform_runtime

import core.database as core_database
import core.logger as core_logger
import core.scheduler as core_scheduler
import modules.activities.activity_weather.service as activity_weather_service

logger = core_logger.get_logger(__name__)


def run_missing_weather_backfill() -> None:
    """Scheduled reconciliation: fetch weather for GPS activities missing it."""
    platform = platform_runtime.get_active_platform()
    with platform.lock.try_acquire("weather_backfill") as acquired:
        if not acquired:
            logger.debug("Weather scheduler: another replica holds the backfill lock; skipping")
            return
        with core_database.SessionLocal() as db:
            activity_weather_service.backfill_missing_activity_weather(platform.clock, db)


def recurring_jobs() -> tuple[core_scheduler.ScheduledJob, ...]:
    """Return weather reconciliation jobs.

    Returns:
        The jobs to schedule.
    """
    return (
        core_scheduler.ScheduledJob(
            run_missing_weather_backfill,
            60,
            "backfill missing activity weather (Open-Meteo)",
        ),
    )


def schedule_missing_weather_backfill() -> None:
    """Queue one missing-weather reconciliation pass."""
    core_scheduler.run_once(
        run_missing_weather_backfill,
        job_id="endurain_backfill_missing_weather_oneshot",
        description="activity-weather backfill",
    )
