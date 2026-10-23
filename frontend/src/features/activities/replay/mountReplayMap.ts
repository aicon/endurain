import { AttributionControl, GeoJSONSource, Map, Marker, setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'

import type { GeoPoint } from '@/composables/useMapProvider'

import { courseBearing } from '@/features/activities/utils/course'
import { pointAtFraction } from '@/features/activities/utils/scrub'
import { themeColor } from '@/lib/themeColor'

// The bundled worker must be a same-origin file. MapLibre's default URL points
// at a script that Vite does not emit, and a blob: worker is blocked by the
// page's script-src. Set this before the first map is created.
setWorkerUrl(maplibreWorkerUrl)

/** Open elevation tiles. No API key; the map credits Mapterhorn. */
const TERRAIN_TILES = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'

/** Chase-camera tilt, in degrees. */
const REPLAY_PITCH = 60

/** Street-level zoom for the chase camera. The viewer can still zoom. */
const REPLAY_ZOOM = 15

/** A tilted map that follows one point on the route. */
export interface ReplayMap {
  /** Aims the camera from behind the direction of travel. */
  follow(points: readonly GeoPoint[], fraction: number): void
  /** Replaces the drawn route. */
  setTrack(points: readonly GeoPoint[]): void
  /** Releases the WebGL map. */
  destroy(): void
}

/** Options for {@link mountReplayMap}. */
export interface ReplayMapOptions {
  /** Ordered route points. */
  points: readonly GeoPoint[]
  /** Raster tile template, the same one the flat map uses. */
  tileUrl: string
  /** HTML attribution for those tiles. */
  attribution: string
}

/** GeoJSON line for the route. MapLibre expects `[lng, lat]`. */
function routeLine(points: readonly GeoPoint[]) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: points.map((point) => [point.lng, point.lat]),
    },
  }
}

/**
 * Mounts a pitched MapLibre map over the activity route.
 *
 * The flat Leaflet map stays underneath. This view is created only while the
 * player is open, so the rest of the app does not load MapLibre.
 *
 * @param target - Empty element that fills the map.
 * @param options - Route and the instance's tile server.
 * @returns A handle that follows the cursor.
 */
export async function mountReplayMap(
  target: HTMLElement,
  options: ReplayMapOptions,
): Promise<ReplayMap> {
  const color = themeColor('--color-brand')
  const start = options.points[0] ?? { lat: 0, lng: 0 }
  const map = new Map({
    container: target,
    center: [start.lng, start.lat],
    zoom: REPLAY_ZOOM,
    pitch: REPLAY_PITCH,
    bearing: 0,
    maxPitch: 75,
    attributionControl: false,
    fadeDuration: 0,
    style: {
      version: 8,
      sources: {
        base: {
          type: 'raster',
          tiles: [options.tileUrl],
          tileSize: 256,
          attribution: options.attribution,
        },
        terrain: {
          type: 'raster-dem',
          tiles: [TERRAIN_TILES],
          tileSize: 512,
          encoding: 'terrarium',
          attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
        },
        route: {
          type: 'geojson',
          data: routeLine(options.points),
        },
      },
      layers: [
        {
          id: 'ground',
          type: 'background',
          paint: { 'background-color': '#d5e3d8' },
        },
        { id: 'base', type: 'raster', source: 'base' },
        { id: 'hillshade', type: 'hillshade', source: 'terrain' },
        {
          id: 'route',
          type: 'line',
          source: 'route',
          paint: {
            'line-color': color,
            'line-width': 5,
          },
        },
      ],
      terrain: { source: 'terrain', exaggeration: 1.3 },
    },
  })
  map.addControl(new AttributionControl({ compact: true }), 'bottom-left')

  const dot = document.createElement('div')
  dot.style.width = '16px'
  dot.style.height = '16px'
  dot.style.borderRadius = '9999px'
  dot.style.background = '#2c2c2a'
  dot.style.border = '3px solid #ffffff'
  dot.style.boxShadow = '0 1px 3px rgb(0 0 0 / 0.45)'
  const marker = new Marker({ element: dot, anchor: 'center' })
    .setLngLat([start.lng, start.lat])
    .addTo(map)

  let loaded = false
  let bearing = 0
  let latestPoints = options.points
  let latestFraction = 0

  /** Points the camera once the style has loaded. */
  const aim = (): void => {
    if (!loaded) {
      return
    }
    const point = pointAtFraction(latestPoints, latestFraction)
    if (!point) {
      return
    }
    bearing = courseBearing(latestPoints, latestFraction, bearing)
    map.jumpTo({
      center: [point.lng, point.lat],
      bearing,
      pitch: REPLAY_PITCH,
    })
    marker.setLngLat([point.lng, point.lat])
  }

  map.on('load', () => {
    loaded = true
    map.resize()
    aim()
  })
  map.on('error', (event) => {
    console.error('Tilted replay map', event.error)
  })

  return {
    follow(points, fraction) {
      latestPoints = points
      latestFraction = fraction
      aim()
    },
    setTrack(points) {
      latestPoints = points
      const source = map.getSource('route')
      if (source instanceof GeoJSONSource) {
        source.setData(routeLine(points))
      }
    },
    destroy() {
      marker.remove()
      map.remove()
    },
  }
}
