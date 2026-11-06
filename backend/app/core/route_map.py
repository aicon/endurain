# pyright: reportMissingTypeStubs=false
"""Static-map route renderer with SSRF-safe outbound tile requests.

Lives in ``core`` rather than in the activities module because it performs raw
network egress: ``activities-no-raw-egress`` in ``.importlinter`` forbids the
domain from importing ``staticmap`` / ``requests`` directly, so the outbound
call sits behind this host-owned seam next to the ``core.network`` host checks
it enforces.
"""

from dataclasses import dataclass
from io import BytesIO
from math import cos, log, pi, tan
from typing import Any
from urllib.parse import urlparse, urlunparse

from PIL import Image, ImageDraw
from staticmap import CircleMarker, Line, StaticMap
from urllib3 import HTTPConnectionPool, HTTPSConnectionPool

import core.logger as core_logger
import core.network as core_network

logger = core_logger.get_logger(__name__)

_DEFAULT_TILE_REQUEST_TIMEOUT_SECONDS = 10.0


@dataclass(frozen=True)
class RouteMapRenderRequest:
    """Renderer-neutral request to render a route over map tiles."""

    coordinates: tuple[tuple[float, float], ...]
    tile_url: str
    background_color: str
    headers: dict[str, str]
    width: int
    height: int
    line_color: str
    line_width: int
    marker_outer_color: str
    marker_outer_radius: int
    start_color: str
    end_color: str
    marker_inner_radius: int
    quality: int
    encoder_method: int
    request_timeout_seconds: float = _DEFAULT_TILE_REQUEST_TIMEOUT_SECONDS


class UnsafeTileServerError(ValueError):
    """Raised when a tile URL violates the shared outbound-network policy."""


def _ensure_safe_url(url: str) -> tuple[str, ...]:
    """Resolve a tile URL or reject one that could target an internal service."""
    addresses, reason = core_network.resolve_url_addresses(url, purpose="activity_thumbnail_tile")
    if reason is not None:
        logger.warning(
            "Rejected an unsafe activity thumbnail tile URL",
            extra=core_logger.context(reason=reason),
        )
        raise UnsafeTileServerError(reason)
    return addresses


def _pinned_get(url: str, address: str, *, timeout: float, headers: dict[str, str]) -> tuple[int, bytes]:
    """Fetch a URL by validated IP while preserving its HTTP and TLS hostname."""
    parsed = urlparse(url)
    hostname = parsed.hostname
    if hostname is None:
        raise UnsafeTileServerError("URL has no hostname")

    request_headers = dict(headers)
    request_headers["Host"] = parsed.netloc.rsplit("@", maxsplit=1)[-1]
    target = urlunparse(("", "", parsed.path or "/", parsed.params, parsed.query, ""))
    port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    if parsed.scheme.lower() == "https":
        pool = HTTPSConnectionPool(
            address,
            port=port,
            assert_hostname=hostname,
            server_hostname=hostname,
        )
    else:
        pool = HTTPConnectionPool(address, port=port)

    try:
        response = pool.request(
            "GET",
            target,
            headers=request_headers,
            timeout=timeout,
            redirect=False,
            retries=False,
        )
        return response.status, response.data
    finally:
        pool.close()


class _GuardedStaticMap(StaticMap):
    """StaticMap variant that validates every request and refuses redirects."""

    def get(self, url: str, **kwargs: Any) -> tuple[int, bytes]:
        """Fetch one validated tile without following redirects."""
        addresses = _ensure_safe_url(url)
        timeout = kwargs.pop("timeout", None) or _DEFAULT_TILE_REQUEST_TIMEOUT_SECONDS
        headers = kwargs.pop("headers", {})
        return _pinned_get(url, addresses[0], timeout=timeout, headers=headers)


def _lon_to_tile_x(lon: float, zoom: int) -> float:
    """Match staticmap's longitude-to-tile conversion."""
    if not -180 <= lon <= 180:
        lon = (lon + 180) % 360 - 180
    return ((lon + 180.0) / 360) * pow(2, zoom)


def _lat_to_tile_y(lat: float, zoom: int) -> float:
    """Match staticmap's latitude-to-tile conversion."""
    if not -90 <= lat <= 90:
        lat = (lat + 90) % 180 - 90
    return (1 - log(tan(lat * pi / 180) + 1 / cos(lat * pi / 180)) / pi) / 2 * pow(2, zoom)


def _endpoint_icon(kind: str, diameter: int, start_color: str) -> Image.Image:
    """Play button or checkered disc, transparent outside the circle."""
    icon = Image.new("RGBA", (diameter, diameter), (0, 0, 0, 0))
    draw = ImageDraw.Draw(icon)
    box = (0, 0, diameter - 1, diameter - 1)
    if kind == "start":
        draw.ellipse(box, fill=start_color)
        center_y = diameter / 2
        left = diameter * 0.34
        draw.polygon(
            [(left, center_y - diameter * 0.24), (left, center_y + diameter * 0.24), (diameter * 0.72, center_y)],
            fill="#111111",
        )
    else:
        tile = max(2, diameter // 4)
        for top in range(0, diameter, tile):
            for left in range(0, diameter, tile):
                dark = ((left // tile) + (top // tile)) % 2 == 0
                draw.rectangle((left, top, left + tile, top + tile), fill="#111111" if dark else "#ffffff")
        mask = Image.new("L", (diameter, diameter), 0)
        ImageDraw.Draw(mask).ellipse(box, fill=255)
        icon.putalpha(mask)
        draw = ImageDraw.Draw(icon)
    draw.ellipse(box, outline="#ffffff", width=max(1, diameter // 14))
    return icon


def _paint_endpoint(
    image: Image.Image,
    static_map: StaticMap,
    coord: tuple[float, float],
    kind: str,
    start_color: str,
    diameter: int,
) -> None:
    """Centre an endpoint icon on a route point of an already rendered map."""
    if diameter < 2:
        return
    zoom = static_map.zoom
    pixel_x = static_map._x_to_px(_lon_to_tile_x(coord[0], zoom))
    pixel_y = static_map._y_to_px(_lat_to_tile_y(coord[1], zoom))
    icon = _endpoint_icon(kind, diameter, start_color)
    image.paste(icon, (pixel_x - diameter // 2, pixel_y - diameter // 2), icon)


def render(request: RouteMapRenderRequest) -> bytes:
    """Render one route as WebP bytes.

    Args:
        request: The route geometry, tile source, and encoding options.

    Returns:
        The rendered map as WebP-encoded bytes.

    Raises:
        ValueError: When fewer than two coordinates are supplied.
        UnsafeTileServerError: When the tile URL targets a non-public address.
    """
    if len(request.coordinates) < 2:
        raise ValueError("At least two route coordinates are required")

    _ensure_safe_url(request.tile_url.format(z=0, x=0, y=0))
    static_map = _GuardedStaticMap(
        request.width,
        request.height,
        url_template=request.tile_url,
        tile_request_timeout=request.request_timeout_seconds,
        background_color=request.background_color,
        headers=request.headers,
    )
    static_map.add_line(Line(list(request.coordinates), request.line_color, request.line_width))
    # The white disc reserves the icon's extent. The play button and the
    # checkered finish are painted on top, in the same place.
    for coord in (request.coordinates[0], request.coordinates[-1]):
        static_map.add_marker(CircleMarker(coord, request.marker_outer_color, request.marker_outer_radius))

    image = static_map.render()
    if isinstance(image, Image.Image):
        _paint_endpoint(
            image,
            static_map,
            request.coordinates[0],
            "start",
            request.start_color,
            request.marker_outer_radius,
        )
        _paint_endpoint(
            image,
            static_map,
            request.coordinates[-1],
            "finish",
            request.start_color,
            request.marker_outer_radius,
        )
    buffer = BytesIO()
    image.save(buffer, "WEBP", quality=request.quality, method=request.encoder_method)
    return buffer.getvalue()
