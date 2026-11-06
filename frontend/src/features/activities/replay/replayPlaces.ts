import type { GeoPoint } from '@/composables/useMapProvider'

import { metersBetween } from '@/features/activities/utils/course'

/** Show a place board when the athlete is closer than this, in metres. */
export const PLACE_SHOW_M = 400

/** Hide the board once the athlete is farther than this, in metres. */
export const PLACE_HIDE_M = 600

/** Drop a POI whose closest track point is farther than this. */
const MAX_OFF_ROUTE_M = 2500

/** Extra degrees around the track so a nearby peak still matches. */
const BBOX_PAD_DEG = 0.02

/** Public Overpass interpreter. */
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

/** Nominatim search; covered by the existing `*.openstreetmap.org` CSP. */
export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'

/** OSM settlement class for the board subtitle. */
export type SettlementKind = 'city' | 'town' | 'village' | 'hamlet' | 'suburb'

/** Town or summit next to the route. */
export interface ReplayPlace {
  id: string
  name: string
  kind: 'town' | 'peak'
  settlement?: SettlementKind
  ele?: number
  lat: number
  lng: number
  /** Closest point on the GPS track; the board stands here, in camera. */
  anchor?: GeoPoint
}

/** South, west, north, east box, padded. */
export interface RouteBbox {
  south: number
  west: number
  north: number
  east: number
}

/**
 * Bounding box of the GPS track, padded so a village just off the path still
 * loads.
 *
 * @param points - Ordered route.
 */
export function routeBbox(points: readonly GeoPoint[]): RouteBbox | null {
  if (points.length === 0) {
    return null
  }
  let south = 90
  let north = -90
  let west = 180
  let east = -180
  for (const point of points) {
    south = Math.min(south, point.lat)
    north = Math.max(north, point.lat)
    west = Math.min(west, point.lng)
    east = Math.max(east, point.lng)
  }
  return {
    south: Math.max(-90, south - BBOX_PAD_DEG),
    west: Math.max(-180, west - BBOX_PAD_DEG),
    north: Math.min(90, north + BBOX_PAD_DEG),
    east: Math.min(180, east + BBOX_PAD_DEG),
  }
}

/**
 * Overpass QL for towns and peaks in a box.
 *
 * @param box - Route bounds.
 */
export function overpassQuery(box: RouteBbox): string {
  return `[out:json][timeout:25];
(
  node["place"~"city|town|village|hamlet|suburb"](${box.south},${box.west},${box.north},${box.east});
  node["natural"="peak"](${box.south},${box.west},${box.north},${box.east});
);
out body;`
}

type OverpassNode = {
  type?: string
  id?: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
}

/**
 * Reads named towns and peaks from an Overpass JSON body.
 *
 * @param payload - Interpreter response.
 */
export function parseOverpassPlaces(payload: unknown): ReplayPlace[] {
  if (!payload || typeof payload !== 'object' || !('elements' in payload)) {
    return []
  }
  const elements = (payload as { elements?: unknown }).elements
  if (!Array.isArray(elements)) {
    return []
  }
  const places: ReplayPlace[] = []
  for (const raw of elements) {
    const node = raw as OverpassNode
    if (node.type !== 'node' || typeof node.lat !== 'number' || typeof node.lon !== 'number') {
      continue
    }
    const tags = node.tags ?? {}
    const name = (tags['name:hu'] ?? tags.name)?.trim()
    if (!name) {
      continue
    }
    const placeTag = tags.place
    const isTown =
      placeTag === 'city' ||
      placeTag === 'town' ||
      placeTag === 'village' ||
      placeTag === 'hamlet' ||
      placeTag === 'suburb'
    const isPeak = tags.natural === 'peak'
    if (!isTown && !isPeak) {
      continue
    }
    const eleRaw = tags.ele
    const ele = eleRaw !== undefined ? Number.parseFloat(eleRaw) : Number.NaN
    places.push({
      id: `${isPeak ? 'peak' : 'town'}:${node.id ?? `${node.lat},${node.lon}`}`,
      name,
      kind: isPeak ? 'peak' : 'town',
      ...(!isPeak && isTown ? { settlement: placeTag as SettlementKind } : {}),
      ...(Number.isFinite(ele) ? { ele } : {}),
      lat: node.lat,
      lng: node.lon,
    })
  }
  return places
}

type NominatimHit = {
  lat?: string
  lon?: string
  name?: string
  addresstype?: string
  type?: string
  class?: string
  osm_id?: number
}

/**
 * Reads settlements from a Nominatim jsonv2 search.
 *
 * @param payload - Search array.
 */
export function parseNominatimPlaces(payload: unknown): ReplayPlace[] {
  if (!Array.isArray(payload)) {
    return []
  }
  const places: ReplayPlace[] = []
  for (const raw of payload) {
    const hit = raw as NominatimHit
    const name = hit.name?.trim()
    const lat = hit.lat !== undefined ? Number.parseFloat(hit.lat) : Number.NaN
    const lng = hit.lon !== undefined ? Number.parseFloat(hit.lon) : Number.NaN
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue
    }
    const kind = hit.addresstype ?? hit.type
    const isPeak = hit.class === 'natural' && kind === 'peak'
    const isTown =
      kind === 'city' ||
      kind === 'town' ||
      kind === 'village' ||
      kind === 'hamlet' ||
      kind === 'suburb'
    if (!isTown && !isPeak) {
      continue
    }
    places.push({
      id: `${isPeak ? 'peak' : 'town'}:nom:${hit.osm_id ?? `${lat},${lng}`}`,
      name,
      kind: isPeak ? 'peak' : 'town',
      ...(!isPeak && isTown ? { settlement: kind as SettlementKind } : {}),
      lat,
      lng,
    })
  }
  return places
}

/**
 * Puts each place on the nearest GPS sample so the pole stands in the shot.
 *
 * @param places - Overpass / Nominatim hits.
 * @param points - Ordered route.
 */
export function snapPlacesToRoute(
  places: readonly ReplayPlace[],
  points: readonly GeoPoint[],
): ReplayPlace[] {
  if (points.length === 0) {
    return []
  }
  const snapped: ReplayPlace[] = []
  for (const place of places) {
    let anchor = points[0]!
    let nearestM = Infinity
    for (const point of points) {
      const distance = metersBetween(point, { lat: place.lat, lng: place.lng })
      if (distance < nearestM) {
        nearestM = distance
        anchor = point
      }
    }
    if (nearestM > MAX_OFF_ROUTE_M) {
      continue
    }
    snapped.push({ ...place, anchor })
  }
  return snapped
}

/**
 * Keeps one board: enter under {@link PLACE_SHOW_M}, stay until
 * {@link PLACE_HIDE_M}. Distance is to the on-route pole, not the town hall.
 *
 * @param here - Athlete position.
 * @param places - Loaded POIs.
 * @param current - Board already shown, if any.
 */
export function pickVisiblePlace(
  here: GeoPoint,
  places: readonly ReplayPlace[],
  current: ReplayPlace | null,
): ReplayPlace | null {
  const poleOf = (place: ReplayPlace): GeoPoint =>
    place.anchor ?? { lat: place.lat, lng: place.lng }
  const distTo = (place: ReplayPlace): number => metersBetween(here, poleOf(place))
  if (current) {
    const held = places.find((place) => place.id === current.id) ?? current
    if (distTo(held) <= PLACE_HIDE_M) {
      return held
    }
  }
  let nearest: ReplayPlace | null = null
  let nearestM = Infinity
  for (const place of places) {
    const distance = distTo(place)
    if (distance < nearestM) {
      nearest = place
      nearestM = distance
    }
  }
  if (nearest && nearestM < PLACE_SHOW_M) {
    return nearest
  }
  return null
}

/**
 * Caption on the floating board.
 *
 * @param place - Town or peak.
 */
export function placeCaption(place: ReplayPlace): {
  icon: string
  title: string
  subtitle: string
} {
  if (place.kind === 'peak') {
    const rounded = place.ele !== undefined ? Math.round(place.ele) : undefined
    return {
      icon: '⛰️',
      title: place.name,
      subtitle: rounded !== undefined ? `${rounded} M • CSÚCS` : 'CSÚCS',
    }
  }
  return {
    icon: '📍',
    title: place.name,
    subtitle: place.settlement === 'village' || place.settlement === 'hamlet' ? 'FALU' : 'VÁROS',
  }
}

/**
 * Loads towns and peaks along the route. Network errors return an empty list.
 *
 * @param points - Ordered route.
 * @param signal - Aborted when the map is destroyed.
 */
export async function fetchReplayPlaces(
  points: readonly GeoPoint[],
  signal?: AbortSignal,
): Promise<ReplayPlace[]> {
  const box = routeBbox(points)
  if (!box) {
    return []
  }
  const overpassUrl = `${OVERPASS_URL}?data=${encodeURIComponent(overpassQuery(box))}`
  const nominatimUrl =
    `${NOMINATIM_SEARCH_URL}?format=jsonv2&bounded=1&limit=50` +
    `&featureType=settlement&viewbox=${box.west},${box.north},${box.east},${box.south}`
  let loaded: ReplayPlace[] = []
  try {
    const response = await fetch(overpassUrl, { signal })
    if (response.ok) {
      loaded = parseOverpassPlaces(await response.json())
    }
  } catch {
    loaded = []
  }
  if (loaded.length === 0) {
    try {
      const response = await fetch(nominatimUrl, { signal })
      if (response.ok) {
        loaded = parseNominatimPlaces(await response.json())
      }
    } catch {
      loaded = []
    }
  }
  return loaded
}
