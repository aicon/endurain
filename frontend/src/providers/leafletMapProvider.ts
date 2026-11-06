/**
 * Concrete Leaflet implementation of the {@link MapProvider} seam. Registered
 * during bootstrap so Activity and Home surfaces can render GPS tracks. Kept
 * behind the seam so minimal builds can omit Leaflet entirely.
 *
 * The pure {@link toLatLngs} and {@link boundsOf} helpers are exported so the
 * seam → Leaflet data translation can be unit-tested without a real map.
 */
import {
  circleMarker,
  divIcon,
  map as createMap,
  type Map,
  marker,
  polyline,
  tileLayer,
  type CircleMarker,
  type Layer,
  type LeafletMouseEvent,
} from 'leaflet'
import 'leaflet/dist/leaflet.css'

import type {
  GeoPoint,
  MapInstance,
  MapProvider,
  MapRenderOptions,
  MapTrack,
  TrackHoverHandler,
} from '@/composables/useMapProvider'
import { nearestTrackIndex } from '@/features/activities/utils/scrub'

import { DEFAULT_MAP_CONFIG } from '@/features/config/defaults'
import { themeColor } from '@/lib/themeColor'

/** A latitude/longitude pair in Leaflet's expected `[lat, lng]` order. */
export type LatLngTuple = [number, number]

/** Tile-server configuration for the Leaflet provider. */
export interface LeafletMapProviderConfig {
  /** Tile URL template (supports Leaflet's `{s}`, `{z}`, `{x}`, `{y}`). */
  tileUrl?: string
  /** Attribution HTML shown in the map corner. */
  attribution?: string
  /** Maximum zoom level offered by the tile server. */
  maxZoom?: number
  /** Polyline colour for the rendered track. */
  trackColor?: string
}

const DEFAULT_MAX_ZOOM = 19
/** Visible GPS polyline width. 2.25 is another 25% off the previous 3. */
const TRACK_LINE_WEIGHT = 2.25
/** Brand teal track colour, from the `--color-brand` design token. */
const DEFAULT_TRACK_COLOR = themeColor('--color-brand')
/** Start-marker fill — the `--color-goal` design token (green). */
const START_MARKER_COLOR = themeColor('--color-goal')
/** About the size of the hover dot, a couple of pixels larger than its black centre. */
const ROUTE_PIN_PX = 18
/** Above the marker pane (600), so the hover dot sits on the endpoints. */
const CURSOR_PANE = 'routeCursor'
const CURSOR_PANE_Z = '620'

/**
 * Converts seam {@link GeoPoint}s to Leaflet `[lat, lng]` tuples.
 *
 * @param points - Coordinates to convert.
 * @returns Tuples in Leaflet order.
 */
export function toLatLngs(points: readonly GeoPoint[]): LatLngTuple[] {
  return points.map((point) => [point.lat, point.lng])
}

/**
 * Computes the bounding box covering a track's points and markers.
 *
 * @param track - The track to bound.
 * @returns `[[south, west], [north, east]]`, or `null` when the track is empty.
 */
export function boundsOf(track: MapTrack): [LatLngTuple, LatLngTuple] | null {
  const points = [...track.points]
  if (track.start) {
    points.push(track.start)
  }
  if (track.finish) {
    points.push(track.finish)
  }
  const first = points[0]
  if (!first) {
    return null
  }

  let south = first.lat
  let north = first.lat
  let west = first.lng
  let east = first.lng
  for (const point of points) {
    south = Math.min(south, point.lat)
    north = Math.max(north, point.lat)
    west = Math.min(west, point.lng)
    east = Math.max(east, point.lng)
  }

  return [
    [south, west],
    [north, east],
  ]
}

/** Puts the hover dot above the start and finish icons. */
function ensureCursorPane(leafletMap: Map): void {
  if (leafletMap.getPane(CURSOR_PANE)) {
    return
  }
  const pane = leafletMap.createPane(CURSOR_PANE)
  pane.style.zIndex = CURSOR_PANE_Z
}

/** Drops Leaflet's default white box around a div icon. */
function ensureRoutePinStyle(): void {
  if (document.getElementById('endurain-route-pin-style')) {
    return
  }
  const style = document.createElement('style')
  style.id = 'endurain-route-pin-style'
  style.textContent = '.endurain-route-pin{background:transparent;border:none;}'
  document.head.appendChild(style)
}

/** Leaflet div icon centred on the track point. */
function routePin(point: GeoPoint, html: string): Layer {
  ensureRoutePinStyle()
  return marker([point.lat, point.lng], {
    icon: divIcon({
      className: 'endurain-route-pin',
      html,
      iconSize: [ROUTE_PIN_PX, ROUTE_PIN_PX],
      iconAnchor: [ROUTE_PIN_PX / 2, ROUTE_PIN_PX / 2],
    }),
    interactive: false,
    keyboard: false,
  })
}

/**
 * Green play button for the start of a track.
 *
 * @param point - The marker location.
 * @returns A Leaflet marker layer.
 */
function startMarker(point: GeoPoint): Layer {
  const html =
    `<div style="box-sizing:border-box;width:${ROUTE_PIN_PX}px;height:${ROUTE_PIN_PX}px;border-radius:50%;` +
    `background:${START_MARKER_COLOR};border:1px solid #ffffff;display:flex;align-items:center;justify-content:center;">` +
    `<div style="width:0;height:0;margin-left:1px;border-style:solid;border-width:4px 0 4px 6px;` +
    `border-color:transparent transparent transparent #111111;"></div></div>`
  return routePin(point, html)
}

/**
 * Checkered disc for the end of a track, the Strava finish marker.
 *
 * @param point - The marker location.
 * @returns A Leaflet marker layer.
 */
function finishMarker(point: GeoPoint): Layer {
  const html =
    `<div style="box-sizing:border-box;width:${ROUTE_PIN_PX}px;height:${ROUTE_PIN_PX}px;border-radius:50%;` +
    `border:1px solid #ffffff;box-shadow:inset 0 0 0 1px #222222;` +
    `background:repeating-conic-gradient(#111111 0% 25%,#ffffff 0% 50%) 0 0/8px 8px;"></div>`
  return routePin(point, html)
}

/**
 * Creates a Leaflet-backed map provider.
 *
 * @param config - Optional tile-server overrides; defaults to OpenStreetMap.
 * @returns A {@link MapProvider} ready to register via `setMapProvider`.
 */
export function createLeafletMapProvider(config: LeafletMapProviderConfig = {}): MapProvider {
  const tileUrl = config.tileUrl ?? DEFAULT_MAP_CONFIG.tileUrl
  const attribution = config.attribution ?? DEFAULT_MAP_CONFIG.attribution
  const maxZoom = config.maxZoom ?? DEFAULT_MAX_ZOOM
  const trackColor = config.trackColor ?? DEFAULT_TRACK_COLOR

  return {
    name: 'leaflet',
    mount(target: HTMLElement, options: MapRenderOptions): MapInstance {
      const interactive = options.interactive ?? true
      const map = createMap(target, {
        attributionControl: true,
        zoomControl: interactive,
        dragging: interactive,
        scrollWheelZoom: interactive,
        keyboard: interactive,
      })

      tileLayer(tileUrl, { attribution, maxZoom }).addTo(map)
      ensureCursorPane(map)

      let overlays: Layer[] = []
      let currentTrack: MapTrack = options.track
      let onTrackHover: TrackHoverHandler | null = null
      let cursor: CircleMarker | null = null

      /** Re-fits the viewport to a track's bounds (or the world when empty). */
      const fit = (track: MapTrack): void => {
        const bounds = boundsOf(track)
        if (bounds) {
          map.fitBounds(bounds, { padding: [24, 24] })
        } else {
          map.setView([0, 0], 2)
        }
      }

      const draw = (track: MapTrack): void => {
        currentTrack = track
        for (const layer of overlays) {
          map.removeLayer(layer)
        }
        overlays = []

        const linePoints = toLatLngs(track.points)
        if (linePoints.length > 0) {
          const visible = polyline(linePoints, {
            color: trackColor,
            weight: TRACK_LINE_WEIGHT,
            interactive: false,
          })
          const hit = polyline(linePoints, { color: trackColor, weight: 20, opacity: 0.01 })
          const move = (event: LeafletMouseEvent): void => {
            if (!onTrackHover || track.points.length === 0) {
              return
            }
            const index = nearestTrackIndex(track.points, event.latlng.lat, event.latlng.lng)
            onTrackHover(track.points.length === 1 ? 0 : index / (track.points.length - 1))
          }
          const leave = (): void => {
            onTrackHover?.(null)
          }
          hit.on('mousemove', move)
          hit.on('mouseout', leave)
          overlays.push(visible.addTo(map), hit.addTo(map))
        }
        if (track.start) {
          overlays.push(startMarker(track.start).addTo(map))
        }
        if (track.finish) {
          overlays.push(finishMarker(track.finish).addTo(map))
        }

        fit(track)
        cursor?.bringToFront()
      }

      draw(options.track)

      return {
        update(next: MapRenderOptions): void {
          draw(next.track)
        },
        recenter(): void {
          map.invalidateSize()
          fit(currentTrack)
        },
        setCursor(point: GeoPoint | null): void {
          if (!point) {
            cursor?.remove()
            cursor = null
            return
          }
          if (!cursor) {
            cursor = circleMarker([point.lat, point.lng], {
              radius: 8,
              color: '#ffffff',
              weight: 3,
              fillColor: '#2c2c2a',
              fillOpacity: 1,
              interactive: false,
              pane: CURSOR_PANE,
            }).addTo(map)
          } else {
            cursor.setLatLng([point.lat, point.lng])
          }
          cursor.bringToFront()
        },
        panTo(point: GeoPoint): void {
          map.panTo([point.lat, point.lng], { animate: false })
        },
        setTrackHover(handler: TrackHoverHandler | null): void {
          onTrackHover = handler
        },
        destroy(): void {
          cursor?.remove()
          cursor = null
          map.remove()
        },
      }
    },
  }
}
