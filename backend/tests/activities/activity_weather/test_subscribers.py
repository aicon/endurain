"""Tests for the weather subscribers (activity.created)."""

from unittest.mock import MagicMock, patch

from jasil.events import new_event

_SUB = "modules.activities.activity_weather.subscribers"


def _event(payload):
    return new_event("activity.created", payload, source="test")


class TestOnActivityCreatedWeather:
    @patch(f"{_SUB}.core_database")
    @patch(f"{_SUB}.activity_weather_service")
    def test_fetches_for_activity(self, mock_service, _mock_db):
        from modules.activities.activity_weather.subscribers import on_activity_created_weather

        on_activity_created_weather(_event({"activity_id": 1, "user_id": 2}))

        assert mock_service.fetch_and_store_activity_weather.call_args.args[0] == 1

    def test_subscribes_to_created(self):
        from modules.activities.activity_weather.subscribers import (
            on_activity_created_weather,
            register_weather_subscribers,
        )

        events = MagicMock()
        register_weather_subscribers(events)
        events.subscribe.assert_called_once_with("activity.created", on_activity_created_weather)
