"""Unit tests for the owner activity-file download."""

from unittest.mock import MagicMock, patch

import pytest

import core.exceptions as core_exceptions
import modules.activities.activity.download_service as download_service
from modules.activities.activity.schema import ActivityRead


def _activity(**kw) -> ActivityRead:
    data = dict(id=9, user_id=1, distance=0, name="Afternoon Walk", activity_type=11)
    data.update(kw)
    return ActivityRead(**data)


def test_download_filename_sanitizes_the_title():
    assert download_service.download_filename("Afternoon Walk", ".gpx") == "Afternoon_Walk.gpx"
    assert download_service.download_filename("a/b:c", "fit") == "abc.fit"


def test_prefers_the_retained_source_file():
    storage = MagicMock()
    db = MagicMock()
    with (
        patch.object(
            download_service.activity_crud,
            "get_activity_by_id_from_user_id",
            return_value=_activity(),
        ),
        patch.object(
            download_service.activity_file_storage_integration,
            "get_activity_file",
            return_value=("9.gpx", b"<gpx>src</gpx>"),
        ),
    ):
        data, filename, media_type = download_service.download_activity_file(9, 1, storage, db)

    assert data == b"<gpx>src</gpx>"
    assert filename == "Afternoon_Walk.gpx"
    assert media_type == "application/gpx+xml"


def test_rebuilds_gpx_when_no_source_file():
    storage = MagicMock()
    db = MagicMock()
    with (
        patch.object(
            download_service.activity_crud,
            "get_activity_by_id_from_user_id",
            return_value=_activity(),
        ),
        patch.object(download_service.activity_file_storage_integration, "get_activity_file", return_value=None),
        patch.object(download_service.activity_gpx_export, "gpx_bytes_from_streams", return_value=b"<gpx/>"),
    ):
        data, filename, media_type = download_service.download_activity_file(9, 1, storage, db)

    assert data == b"<gpx/>"
    assert filename.endswith(".gpx")
    assert media_type == "application/gpx+xml"


def test_missing_owner_or_track_is_not_found():
    storage = MagicMock()
    db = MagicMock()
    with patch.object(download_service.activity_crud, "get_activity_by_id_from_user_id", return_value=None):
        with pytest.raises(core_exceptions.NotFoundError):
            download_service.download_activity_file(9, 1, storage, db)

    with (
        patch.object(
            download_service.activity_crud,
            "get_activity_by_id_from_user_id",
            return_value=_activity(),
        ),
        patch.object(download_service.activity_file_storage_integration, "get_activity_file", return_value=None),
        patch.object(download_service.activity_gpx_export, "gpx_bytes_from_streams", return_value=None),
    ):
        with pytest.raises(core_exceptions.NotFoundError):
            download_service.download_activity_file(9, 1, storage, db)
