import { AttributionControl, GeoJSONSource, Map, Marker, setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'

import type { GeoPoint } from '@/composables/useMapProvider'

import {
  chasePose,
  cumulativeDistances,
  distanceAlongFraction,
  easeFraming,
  framingFromSpeedKmh,
  indexAtDistance,
  mpsToKmh,
  speedMpsAtFraction,
  splitRouteAtDistance,
} from '@/features/activities/utils/course'

// The bundled worker must be a same-origin file. MapLibre's default URL points
// at a script that Vite does not emit, and a blob: worker is blocked by the
// page's script-src. Set this before the first map is created.
setWorkerUrl(maplibreWorkerUrl)

/** Open elevation tiles. No API key; the map credits Mapterhorn. */
const TERRAIN_TILES = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'

/** Esri World Imagery. Public raster; no API key. */
const SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

/** Place names and boundaries over the imagery. */
const HYBRID_LABEL_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'

const SATELLITE_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'

/**
 * Horizon / fog fill. MapLibre v6 has no Mapbox `setFog()`; atmosphere lives on
 * `sky`. This colour also paints the canvas so far tiles do not flash white.
 */
const FOG_COLOR = '#d8e2eb'

/** Zenith of the sky gradient. */
const SKY_ZENITH = '#6ea8d6'

/** Starting zoom for the 2D-to-3D intro. */
const INTRO_ZOOM = 14

/** How long the pitch-in from the flat map lasts, in milliseconds. */
const INTRO_MS = 1100

/** Relive-style ribbon glow. */
const ROUTE_GLOW = '#ff5500'

/** Bright core of the traveled line. */
const ROUTE_CORE = '#ffffff'

/** How strongly the DEM lifts the ground. */
const TERRAIN_EXAGGERATION = 1.3

/** How often the glow polyline is pushed to the MapLibre worker, in ms. */
const LINE_UPDATE_MS = 35

/** A tilted map that follows one point on the route. */
export interface ReplayMap {
  /**
   * Aims the camera from behind the direction of travel.
   *
   * @param snap - Jump instead of easing. Use on seek and the first frame.
   */
  follow(
    points: readonly GeoPoint[],
    fraction: number,
    snap?: boolean,
    timesMs?: readonly number[] | null,
  ): void
  /** Replaces the drawn route. */
  setTrack(points: readonly GeoPoint[]): void
  /** Releases the WebGL map. */
  destroy(): void
}

/** Options for {@link mountReplayMap}. */
export interface ReplayMapOptions {
  /** Ordered route points. */
  points: readonly GeoPoint[]
  /**
   * Raster tile template of the closed Leaflet map. Unused while playing:
   * the chase camera uses Esri World Imagery instead.
   */
  tileUrl: string
  /** HTML attribution for {@link ReplayMapOptions.tileUrl}. Unused while playing. */
  attribution: string
  /** Sample fraction to open on, 0–1. */
  fraction?: number
  /** Epoch milliseconds per point, when the track has a clock. */
  timesMs?: readonly number[] | null
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

/** GeoJSON point for the lead puck. */
function routePuck(point: GeoPoint) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Point' as const,
      coordinates: [point.lng, point.lat],
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
  const start = options.points[0] ?? { lat: 0, lng: 0 }
  let lengths = cumulativeDistances(options.points)
  const opening = splitRouteAtDistance(
    options.points,
    lengths,
    distanceAlongFraction(lengths, options.fraction ?? 0),
  )
  target.style.width = '100%'
  target.style.height = '100%'
  target.style.backgroundColor = FOG_COLOR
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
        satellite: {
          type: 'raster',
          tiles: [SATELLITE_TILES],
          tileSize: 256,
          maxzoom: 18,
          attribution: SATELLITE_ATTRIBUTION,
        },
        'hybrid-labels': {
          type: 'raster',
          tiles: [HYBRID_LABEL_TILES],
          tileSize: 256,
          maxzoom: 18,
        },
        terrain: {
          type: 'raster-dem',
          tiles: [TERRAIN_TILES],
          tileSize: 512,
          encoding: 'terrarium',
          attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
        },
        'route-remain': {
          type: 'geojson',
          data: routeLine(opening.remaining),
        },
        'route-traveled': {
          type: 'geojson',
          data: routeLine(opening.traveled),
        },
        puck: {
          type: 'geojson',
          data: routePuck(start),
        },
      },
      layers: [
        {
          id: 'ground',
          type: 'background',
          paint: { 'background-color': FOG_COLOR },
        },
        {
          id: 'satellite-layer',
          type: 'raster',
          source: 'satellite',
          paint: { 'raster-fade-duration': 300 },
        },
        {
          id: 'hillshade',
          type: 'hillshade',
          source: 'terrain',
          paint: {
            'hillshade-illumination-direction': 315,
            'hillshade-illumination-anchor': 'map',
            'hillshade-exaggeration': 0.18,
            'hillshade-shadow-color': '#0a1220',
            'hillshade-highlight-color': '#ffffff',
          },
        },
        {
          id: 'hybrid-labels-layer',
          type: 'raster',
          source: 'hybrid-labels',
          paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 300 },
        },
        {
          id: 'replay-route-remain',
          type: 'line',
          source: 'route-remain',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': 2,
            'line-opacity': 0.25,
          },
        },
        {
          id: 'replay-route-glow',
          type: 'line',
          source: 'route-traveled',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ROUTE_GLOW,
            'line-width': ['interpolate', ['linear'], ['zoom'], 14, 8, 17, 16],
            'line-blur': 5,
            'line-opacity': 0.5,
          },
        },
        {
          id: 'replay-route-core',
          type: 'line',
          source: 'route-traveled',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ROUTE_CORE,
            'line-width': 3.5,
            'line-opacity': 0.95,
          },
        },
        {
          id: 'replay-puck-halo',
          type: 'circle',
          source: 'puck',
          paint: {
            'circle-radius': 9,
            'circle-color': ROUTE_GLOW,
            'circle-opacity': 0.4,
            'circle-blur': 0.4,
            'circle-pitch-alignment': 'map',
          },
        },
        {
          id: 'replay-puck-core',
          type: 'circle',
          source: 'puck',
          paint: {
            'circle-radius': 4.5,
            'circle-color': '#ffffff',
            'circle-opacity': 0.95,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': ROUTE_GLOW,
            'circle-pitch-alignment': 'map',
          },
        },
      ],
      terrain: { source: 'terrain', exaggeration: TERRAIN_EXAGGERATION },
      sky: {
        'sky-color': SKY_ZENITH,
        'horizon-color': FOG_COLOR,
        'fog-color': FOG_COLOR,
        'fog-ground-blend': 0.55,
        'horizon-fog-blend': 0.85,
        'sky-horizon-blend': 0.18,
        'atmosphere-blend': 0.72,
      },
    },
  })
  map.getCanvas().style.backgroundColor = FOG_COLOR
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
  let latestTimes = options.timesMs ?? null
  let latestFraction = options.fraction ?? 0
  let lastLookAt: { lat: number; lng: number } | null = null
  let introDone = false
  const startFraming = framingFromSpeedKmh(
    mpsToKmh(speedMpsAtFraction(latestPoints, latestFraction, latestTimes)),
  )
  let currentZoom = startFraming.zoom
  let currentPitch = startFraming.pitch
  const traveledFeature = routeLine(opening.traveled)
  const remainFeature = routeLine(opening.remaining)
  const puckFeature = routePuck(start)
  let lastLineAt = 0
  let lastLineVertex = -1

  /** Writes lng/lat pairs without cloning the GeoJSON wrapper twice. */
  const toCoords = (points: readonly GeoPoint[]): [number, number][] =>
    points.map((point) => [point.lng, point.lat])

  /** Moves the lead puck every frame. A single point is cheap for the worker. */
  const paintPuck = (puck: GeoPoint): void => {
    puckFeature.geometry.coordinates = [puck.lng, puck.lat]
    const puckSource = map.getSource('puck')
    if (puckSource instanceof GeoJSONSource) {
      puckSource.setData(puckFeature)
    }
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 280)
    map.setPaintProperty('replay-puck-halo', 'circle-radius', 8 + pulse * 4)
    map.setPaintProperty('replay-puck-halo', 'circle-opacity', 0.28 + pulse * 0.22)
  }

  /**
   * Pushes the glow polyline on seek, when a GPS vertex is crossed, or on a
   * 35 ms cadence so the worker is not tessellating 60 times a second.
   */
  const paintLine = (snap: boolean): void => {
    const distance = distanceAlongFraction(lengths, latestFraction)
    const vertex = indexAtDistance(lengths, distance)
    const now = performance.now()
    if (!snap && vertex === lastLineVertex && now - lastLineAt < LINE_UPDATE_MS) {
      return
    }
    lastLineAt = now
    lastLineVertex = vertex
    const split = splitRouteAtDistance(latestPoints, lengths, distance)
    traveledFeature.geometry.coordinates = toCoords(split.traveled)
    remainFeature.geometry.coordinates = toCoords(split.remaining)
    const traveled = map.getSource('route-traveled')
    if (traveled instanceof GeoJSONSource) {
      traveled.setData(traveledFeature)
    }
    const remain = map.getSource('route-remain')
    if (remain instanceof GeoJSONSource) {
      remain.setData(remainFeature)
    }
  }

  /** Looks down the route from just behind the athlete. */
  const aim = (snap: boolean): void => {
    const pose = chasePose(latestPoints, latestFraction, bearing, snap, lengths)
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
    const target = framingFromSpeedKmh(
      mpsToKmh(speedMpsAtFraction(latestPoints, latestFraction, latestTimes)),
    )
    const framing = easeFraming({ zoom: currentZoom, pitch: currentPitch }, target, snap)
    currentZoom = framing.zoom
    currentPitch = framing.pitch
    map.jumpTo({
      center: [lookAt.lng, lookAt.lat],
      bearing,
      pitch: currentPitch,
      zoom: currentZoom,
    })
    marker.setLngLat([pose.marker.lng, pose.marker.lat]).setRotation(pose.heading)
    paintPuck(pose.marker)
    paintLine(snap)
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
  map.setSky({
    'sky-color': SKY_ZENITH,
    'horizon-color': FOG_COLOR,
    'fog-color': FOG_COLOR,
    'fog-ground-blend': 0.55,
    'horizon-fog-blend': 0.85,
    'sky-horizon-blend': 0.18,
    'atmosphere-blend': 0.72,
  })
  collapseAttribution(map)
  const intro = chasePose(latestPoints, latestFraction, 0, true, lengths)
  if (intro) {
    bearing = intro.bearing
    lastLookAt = intro.lookAt
    marker.setLngLat([intro.marker.lng, intro.marker.lat]).setRotation(intro.heading)
    paintPuck(intro.marker)
    paintLine(true)
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
        pitch: startFraming.pitch,
        zoom: startFraming.zoom,
      },
      INTRO_MS,
    )
    currentZoom = startFraming.zoom
    currentPitch = startFraming.pitch
  }
  introDone = true

  return {
    follow(points, fraction, snap = false, timesMs) {
      if (points !== latestPoints) {
        latestPoints = points
        lengths = cumulativeDistances(points)
      }
      latestFraction = fraction
      if (timesMs !== undefined) {
        latestTimes = timesMs
      }
      if (introDone) {
        aim(snap)
      }
    },
    setTrack(points) {
      latestPoints = points
      lengths = cumulativeDistances(points)
      const pose = chasePose(latestPoints, latestFraction, bearing, true, lengths)
      const puck = pose?.marker ?? points[0] ?? start
      paintPuck(puck)
      paintLine(true)
    },
    destroy() {
      map.stop()
      marker.remove()
      map.remove()
    },
  }
}
