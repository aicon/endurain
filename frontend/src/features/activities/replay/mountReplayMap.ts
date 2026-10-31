import { AttributionControl, GeoJSONSource, Map, Marker, setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'

import type { GeoPoint } from '@/composables/useMapProvider'

import { chasePose } from '@/features/activities/utils/course'
import { themeColor } from '@/lib/themeColor'

// The bundled worker must be a same-origin file. MapLibre's default URL points
// at a script that Vite does not emit, and a blob: worker is blocked by the
// page's script-src. Set this before the first map is created.
setWorkerUrl(maplibreWorkerUrl)

/** Open elevation tiles. No API key; the map credits Mapterhorn. */
const TERRAIN_TILES = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'

/** Forward tilt: the camera sits behind the look-at point and sees the road. */
const REPLAY_PITCH = 62

/** Close enough that houses and the path pass by, Relive-style. */
const REPLAY_ZOOM = 16.5

/** Starting zoom for the 2D-to-3D intro. */
const INTRO_ZOOM = 14

/** How long the pitch-in from the flat map lasts, in milliseconds. */
const INTRO_MS = 1100

/** A tilted map that follows one point on the route. */
export interface ReplayMap {
  /**
   * Aims the camera from behind the direction of travel.
   *
   * @param snap - Jump instead of easing. Use on seek and the first frame.
   */
  follow(points: readonly GeoPoint[], fraction: number, snap?: boolean): void
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
  /** Sample fraction to open on, 0–1. */
  fraction?: number
}

/** Heading chevron that turns with the route, like Strava's cursor. */
function headingArrow(): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.width = '28px'
  wrap.style.height = '28px'
  wrap.style.pointerEvents = 'none'
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">' +
    '<path d="M12 2.5 L21.5 21.2 L12 16.4 L2.5 21.2 Z" fill="#2c2c2a" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>' +
    '</svg>'
  return wrap
}

/** Resolves after a MapLibre ease, or after `ms` if the camera never fires. */
function easeCamera(
  map: Map,
  options: { center: [number, number]; bearing: number; pitch: number; zoom: number },
  ms: number,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) {
        return
      }
      settled = true
      map.off('moveend', finish)
      resolve()
    }
    map.once('moveend', finish)
    map.easeTo({ ...options, duration: ms, easing: (t) => 1 - (1 - t) ** 3 })
    window.setTimeout(finish, ms + 120)
  })
}

/** Collapses the credit to the info button so it does not cover the map. */
function collapseAttribution(map: Map): void {
  const attrib = map.getContainer().querySelector('.maplibregl-ctrl-attrib')
  if (attrib instanceof HTMLElement) {
    attrib.classList.add('maplibregl-compact')
    attrib.classList.remove('maplibregl-compact-show')
    attrib.removeAttribute('open')
  }
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
  target.style.width = '100%'
  target.style.height = '100%'
  const map = new Map({
    container: target,
    center: [start.lng, start.lat],
    zoom: INTRO_ZOOM,
    pitch: 0,
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
            'line-width': 7,
          },
        },
      ],
      terrain: { source: 'terrain', exaggeration: 1.25 },
    },
  })
  map.addControl(new AttributionControl({ compact: true }), 'bottom-right')

  const marker = new Marker({
    element: headingArrow(),
    anchor: 'center',
    rotationAlignment: 'map',
    pitchAlignment: 'viewport',
  })
    .setLngLat([start.lng, start.lat])
    .addTo(map)

  let bearing = 0
  let latestPoints = options.points
  let latestFraction = options.fraction ?? 0
  let lastLookAt: { lat: number; lng: number } | null = null
  let introDone = false

  /** Looks down the route from just behind the athlete. */
  const aim = (snap: boolean): void => {
    const pose = chasePose(latestPoints, latestFraction, bearing, snap)
    if (!pose) {
      return
    }
    bearing = pose.bearing
    const lookAt =
      snap || !lastLookAt
        ? pose.lookAt
        : {
            lat: lastLookAt.lat + (pose.lookAt.lat - lastLookAt.lat) * 0.35,
            lng: lastLookAt.lng + (pose.lookAt.lng - lastLookAt.lng) * 0.35,
          }
    lastLookAt = lookAt
    map.jumpTo({
      center: [lookAt.lng, lookAt.lat],
      bearing,
      pitch: REPLAY_PITCH,
      zoom: REPLAY_ZOOM,
    })
    marker.setLngLat([pose.marker.lng, pose.marker.lat]).setRotation(pose.heading)
  }

  map.on('error', (event) => {
    console.error('Tilted replay map', event.error)
  })

  await new Promise<void>((resolve) => {
    if (map.loaded()) {
      resolve()
      return
    }
    map.once('load', () => resolve())
  })
  map.resize()
  collapseAttribution(map)
  const intro = chasePose(latestPoints, latestFraction, 0, true)
  if (intro) {
    bearing = intro.bearing
    lastLookAt = intro.lookAt
    marker.setLngLat([intro.marker.lng, intro.marker.lat]).setRotation(intro.heading)
    map.jumpTo({
      center: [intro.lookAt.lng, intro.lookAt.lat],
      bearing,
      pitch: 0,
      zoom: INTRO_ZOOM,
    })
    await easeCamera(
      map,
      {
        center: [intro.lookAt.lng, intro.lookAt.lat],
        bearing,
        pitch: REPLAY_PITCH,
        zoom: REPLAY_ZOOM,
      },
      INTRO_MS,
    )
  }
  introDone = true

  return {
    follow(points, fraction, snap = false) {
      latestPoints = points
      latestFraction = fraction
      if (introDone) {
        aim(snap)
      }
    },
    setTrack(points) {
      latestPoints = points
      const source = map.getSource('route')
      if (source instanceof GeoJSONSource) {
        source.setData(routeLine(points))
      }
    },
    destroy() {
      map.stop()
      marker.remove()
      map.remove()
    },
  }
}
