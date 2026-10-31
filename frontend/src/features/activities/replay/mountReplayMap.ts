import {
  AttributionControl,
  GeoJSONSource,
  LngLatBounds,
  Map,
  Marker,
  setWorkerUrl,
} from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'

import type { GeoPoint } from '@/composables/useMapProvider'

import {
  fetchReplayPlaces,
  pickOverviewPlaces,
  pickVisiblePlace,
  placeCaption,
  type ReplayPlace,
} from '@/features/activities/replay/replayPlaces'
import {
  PITCH_SLOW,
  ZOOM_SLOW,
  bearingDegrees,
  chasePose,
  cumulativeDistances,
  distanceAlongFraction,
  easeFraming,
  framingFromSpeedKmh,
  indexAtDistance,
  mpsToKmh,
  speedMpsAtFraction,
  splitRouteAtDistance,
  turnAngleDegrees,
} from '@/features/activities/utils/course'
import '@/features/activities/replay/replayPlaceLabel.css'

// The bundled worker must be a same-origin file. MapLibre's default URL points
// at a script that Vite does not emit, and a blob: worker is blocked by the
// page's script-src. Set this before the first map is created.
setWorkerUrl(maplibreWorkerUrl)

/** Open elevation tiles. No API key; the map credits Mapterhorn. */
const TERRAIN_TILES = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'

/** Esri World Imagery. Public raster; no API key. */
const SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

const SATELLITE_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'

/**
 * Horizon / fog fill. MapLibre v6 has no Mapbox `setFog()`; atmosphere lives on
 * `sky`. This colour also paints the canvas so far tiles do not flash white.
 */
const FOG_COLOR = '#d8e2eb'

/** Zenith of the sky gradient. */
const SKY_ZENITH = '#6ea8d6'

/** Starting zoom before the overview camera fits the route. */
const INTRO_ZOOM = 14

/** Bird's-eye overview, in milliseconds. */
const OVERVIEW_MS = 2500

/** Fly-in from the overview to the start line, in milliseconds. */
const FLY_IN_MS = 2000

/** Pitch of the overview camera, in degrees. */
const OVERVIEW_PITCH = 40

/** Playback camera phase. */
export type ReplayState = 'INTRO_OVERVIEW' | 'FLYING_IN' | 'PLAYING'

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

/** Resolves after `ms`, or sooner when `signal` aborts. */
function waitMs(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = window.setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

/** One Relive board: card, pole, glowing base. */
function makeBillboard(): {
  root: HTMLElement
  wrapper: HTMLElement
  icon: HTMLElement
  title: HTMLElement
  subtitle: HTMLElement
} {
  const root = document.createElement('div')
  root.className = 'relive-billboard'
  root.setAttribute('aria-hidden', 'true')
  const wrapper = document.createElement('div')
  wrapper.className = 'relive-billboard-wrapper'
  const signCard = document.createElement('div')
  signCard.className = 'relive-sign-card'
  const icon = document.createElement('span')
  icon.className = 'sign-icon'
  const signContent = document.createElement('div')
  signContent.className = 'sign-content'
  const title = document.createElement('span')
  title.className = 'sign-title'
  const subtitle = document.createElement('span')
  subtitle.className = 'sign-subtitle'
  signContent.append(title, subtitle)
  signCard.append(icon, signContent)
  const signPole = document.createElement('div')
  signPole.className = 'relive-sign-pole'
  const signBase = document.createElement('div')
  signBase.className = 'relive-sign-base'
  wrapper.append(signCard, signPole, signBase)
  root.append(wrapper)
  return { root, wrapper, icon, title, subtitle }
}

/** Writes a place name onto a board. */
function fillBillboard(
  parts: { icon: HTMLElement; title: HTMLElement; subtitle: HTMLElement },
  place: ReplayPlace,
): void {
  const caption = placeCaption(place)
  parts.icon.textContent = caption.icon
  parts.title.textContent = caption.title
  parts.subtitle.textContent = caption.subtitle
}

/** Compass heading from the start of the route toward the finish. */
function routeOverviewBearing(points: readonly GeoPoint[]): number {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last || (first.lat === last.lat && first.lng === last.lng)) {
    return 0
  }
  return bearingDegrees(first, last)
}

/** MapLibre box around the GPS track. */
function routeLngLatBounds(points: readonly GeoPoint[]): LngLatBounds | null {
  if (points.length === 0) {
    return null
  }
  const bounds = new LngLatBounds()
  for (const point of points) {
    bounds.extend([point.lng, point.lat])
  }
  return bounds
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
  const fullRoute = routeLine(options.points)
  const emptyRoute = routeLine([])
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
        terrain: {
          type: 'raster-dem',
          tiles: [TERRAIN_TILES],
          tileSize: 512,
          encoding: 'terrarium',
          attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
        },
        'route-remain': {
          type: 'geojson',
          data: emptyRoute,
        },
        'route-traveled': {
          type: 'geojson',
          data: fullRoute,
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

  const chaseBoard = makeBillboard()
  const townMarker = new Marker({
    element: chaseBoard.root,
    anchor: 'bottom',
    rotationAlignment: 'viewport',
    pitchAlignment: 'viewport',
    opacityWhenCovered: 1,
    subpixelPositioning: true,
  })
    .setLngLat([start.lng, start.lat])
    .addTo(map)

  const placesAbort = new AbortController()
  let places: ReplayPlace[] = []
  let shownPlace: ReplayPlace | null = null
  let replayState: ReplayState = 'INTRO_OVERVIEW'
  let overviewMarkers: Marker[] = []

  /** Drops the bird's-eye boards. */
  const clearOverviewMarkers = (fade: boolean): void => {
    const dying = overviewMarkers
    overviewMarkers = []
    for (const board of dying) {
      board.getElement().classList.remove('is-visible')
      if (!fade) {
        board.remove()
      }
    }
    if (fade) {
      window.setTimeout(() => {
        for (const board of dying) {
          board.remove()
        }
      }, 400)
    }
  }

  /** Stands the main overview boards on their geographic points. */
  const showOverviewMarkers = (loaded: readonly ReplayPlace[]): void => {
    if (replayState !== 'INTRO_OVERVIEW') {
      return
    }
    clearOverviewMarkers(false)
    for (const place of pickOverviewPlaces(loaded)) {
      const parts = makeBillboard()
      fillBillboard(parts, place)
      const board = new Marker({
        element: parts.root,
        anchor: 'bottom',
        rotationAlignment: 'viewport',
        pitchAlignment: 'viewport',
        opacityWhenCovered: 1,
      })
        .setLngLat([place.lng, place.lat])
        .addTo(map)
      board.getElement().classList.add('is-visible')
      overviewMarkers.push(board)
    }
  }

  /** Fills the reused chase board and pops it in or out. */
  const paintPlace = (here: GeoPoint): void => {
    if (replayState !== 'PLAYING') {
      return
    }
    const next = pickVisiblePlace(here, places, shownPlace)
    if (!next) {
      if (shownPlace) {
        chaseBoard.root.classList.remove('is-visible')
        chaseBoard.wrapper.classList.add('is-leaving')
        shownPlace = null
      }
      return
    }
    if (shownPlace?.id !== next.id) {
      fillBillboard(chaseBoard, next)
      const pole = next.anchor ?? { lat: next.lat, lng: next.lng }
      townMarker.setLngLat([pole.lng, pole.lat])
      chaseBoard.wrapper.classList.remove('is-leaving')
      chaseBoard.root.classList.remove('is-visible')
      requestAnimationFrame(() => {
        chaseBoard.root.classList.add('is-visible')
      })
    } else {
      chaseBoard.wrapper.classList.remove('is-leaving')
      chaseBoard.root.classList.add('is-visible')
    }
    shownPlace = next
  }

  let bearing = 0
  let latestPoints = options.points
  let latestTimes = options.timesMs ?? null
  let latestFraction = options.fraction ?? 0
  let lastLookAt: { lat: number; lng: number } | null = null
  const startFraming = framingFromSpeedKmh(
    mpsToKmh(speedMpsAtFraction(latestPoints, latestFraction, latestTimes)),
  )
  let currentZoom = startFraming.zoom
  let currentPitch = startFraming.pitch
  const traveledFeature = routeLine(options.points)
  const remainFeature = routeLine([])
  const puckFeature = routePuck(start)
  let lastLineAt = 0
  let lastLineVertex = -1

  void fetchReplayPlaces(options.points, placesAbort.signal).then((loaded) => {
    places = loaded
    showOverviewMarkers(loaded)
    if (replayState === 'PLAYING') {
      const pose = chasePose(latestPoints, latestFraction, bearing, true, lengths)
      if (pose) {
        paintPlace(pose.marker)
      }
    }
  })

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
    if (replayState !== 'PLAYING') {
      return
    }
    const pose = chasePose(latestPoints, latestFraction, bearing, snap, lengths)
    if (!pose) {
      return
    }
    const previousBearing = bearing
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
      turnAngleDegrees(previousBearing, pose.lookAhead),
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
    paintPlace(pose.marker)
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
  replayState = 'INTRO_OVERVIEW'
  const overviewBearing = routeOverviewBearing(latestPoints)
  const bounds = routeLngLatBounds(latestPoints)
  if (bounds) {
    map.fitBounds(bounds, {
      pitch: OVERVIEW_PITCH,
      bearing: overviewBearing,
      padding: { top: 80, bottom: 80, left: 60, right: 60 },
      duration: 0,
    })
  }
  const startPose = chasePose(latestPoints, latestFraction, overviewBearing, true, lengths)
  if (startPose) {
    bearing = startPose.bearing
    marker.setLngLat([startPose.marker.lng, startPose.marker.lat]).setRotation(startPose.heading)
    paintPuck(startPose.marker)
  }
  if (places.length > 0) {
    showOverviewMarkers(places)
  }
  await waitMs(OVERVIEW_MS, placesAbort.signal)
  if (placesAbort.signal.aborted) {
    replayState = 'PLAYING'
  } else {
    replayState = 'FLYING_IN'
    clearOverviewMarkers(true)
    const flyTarget = startPose?.marker ?? start
    const flyBearing = startPose?.bearing ?? overviewBearing
    await new Promise<void>((resolve) => {
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
      map.flyTo({
        center: [flyTarget.lng, flyTarget.lat],
        zoom: ZOOM_SLOW,
        pitch: PITCH_SLOW,
        bearing: flyBearing,
        duration: FLY_IN_MS,
        essential: true,
      })
      window.setTimeout(finish, FLY_IN_MS + 200)
    })
    replayState = 'PLAYING'
    currentZoom = ZOOM_SLOW
    currentPitch = PITCH_SLOW
    lastLookAt = startPose?.lookAt ?? flyTarget
    paintLine(true)
  }

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
      if (replayState === 'PLAYING') {
        aim(snap)
      }
    },
    setTrack(points) {
      latestPoints = points
      lengths = cumulativeDistances(points)
      void fetchReplayPlaces(points, placesAbort.signal).then((loaded) => {
        places = loaded
        showOverviewMarkers(loaded)
        const next = chasePose(latestPoints, latestFraction, bearing, true, lengths)
        if (next) {
          paintPlace(next.marker)
        }
      })
      const pose = chasePose(latestPoints, latestFraction, bearing, true, lengths)
      const puck = pose?.marker ?? points[0] ?? start
      paintPuck(puck)
      paintPlace(puck)
      if (replayState === 'PLAYING') {
        paintLine(true)
      }
    },
    destroy() {
      placesAbort.abort()
      clearOverviewMarkers(false)
      map.stop()
      townMarker.remove()
      marker.remove()
      map.remove()
    },
  }
}
