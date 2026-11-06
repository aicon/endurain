"""Owner-only download of an activity as a portable GPS file."""

from __future__ import annotations

import re
from urllib.parse import quote

import jasil.providers as platform_providers
from sqlalchemy.orm import Session

import core.exceptions as core_exceptions
import modules.activities.activity.crud as activity_crud
import modules.activities.activity.gpx_export as activity_gpx_export
import modules.activities.activity_file_storage.integration_service as activity_file_storage_integration

_CONTENT_TYPES = {
    ".gpx": "application/gpx+xml",
    ".tcx": "application/vnd.garmin.tcx+xml",
    ".fit": "application/octet-stream",
}


def download_filename(name: str, extension: str) -> str:
    """Build a safe download filename from the activity title.

    Args:
        name: Activity name.
        extension: File extension, with or without a leading dot.

    Returns:
        A single-path-segment filename such as ``Afternoon_Walk.gpx``.
    """
    stem = re.sub(r"[^\w\s.-]+", "", name, flags=re.UNICODE).strip()
    stem = re.sub(r"[\s.]+", "_", stem).strip("._") or "activity"
    ext = extension if extension.startswith(".") else f".{extension}"
    return f"{stem}{ext.lower()}"


def content_disposition(filename: str) -> str:
    """RFC 5987 Content-Disposition for an attachment.

    Args:
        filename: The suggested download name.

    Returns:
        The header value.
    """
    ascii_name = filename.encode("ascii", "replace").decode("ascii").replace('"', "")
    return f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(filename)}'


def download_activity_file(
    activity_id: int,
    user_id: int,
    storage: platform_providers.StorageProvider,
    db: Session,
) -> tuple[bytes, str, str]:
    """Return the retained source file, or a GPX rebuilt from streams.

    Only the owner may download. A missing activity, a non-owner, or an activity
    with neither a stored file nor a GPS stream is answered as not found.

    Args:
        activity_id: The activity to export.
        user_id: The authenticated caller.
        storage: Blob storage holding retained source files.
        db: Database session.

    Returns:
        ``(bytes, filename, media_type)``.

    Raises:
        core_exceptions.NotFoundError: When the caller may not download a file.
    """
    activity = activity_crud.get_activity_by_id_from_user_id(activity_id, user_id, db)
    if activity is None:
        raise core_exceptions.NotFoundError("Activity not found")

    stored = activity_file_storage_integration.get_activity_file(activity_id, storage)
    if stored is not None:
        key, data = stored
        extension = key[key.rfind(".") :] if "." in key else ".gpx"
        media_type = _CONTENT_TYPES.get(extension.lower(), "application/octet-stream")
        return data, download_filename(activity.name, extension), media_type

    payload = activity_gpx_export.gpx_bytes_from_streams(activity, db)
    if payload is None:
        raise core_exceptions.NotFoundError("Activity file not found")
    return payload, download_filename(activity.name, ".gpx"), _CONTENT_TYPES[".gpx"]
