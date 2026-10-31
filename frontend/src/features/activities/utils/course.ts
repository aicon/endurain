import type { GeoPoint } from '@/composables/useMapProvider'

import { indexAtFraction } from '@/features/activities/utils/scrub'

/** Mean Earth radius, in metres. */
const EARTH_M = 6_371_000

/** How far along the route heading is read, in metres. */
export const LOOK_AHEAD_M = 60

/** Ground point the map looks at, ahead of the athlete, in metres. */
export const LOOK_AT_M = 22

/** Fallback walk backward when there is no forward heading, in metres. */
export const CAMERA_BEHIND_M = 40

/** Ignore heading from a move shorter than this, so GPS jitter does not yaw. */
export const MIN_HEADING_M = 8

/** Blend toward the new heading each frame. 1 snaps, 0 never turns. */
export const BEARING_SMOOTH = 0.28

/** Camera pose for one replay frame. */
export interface ChasePose {
  /** The athlete marker. */
  marker: GeoPoint
  /**
   * Ground point in the middle of the view, ahead on the route.
   * MapLibre's pitch sits the camera behind this point, so the road runs
   * forward and the surroundings pass by.
   */
  lookAt: GeoPoint
  /** Compass heading the camera looks, 0–360. */
  bearing: number
}

/**
 * Compass bearing from one point to another, in degrees clockwise from north.
 *
 * @param from - The point the camera stands behind.
 * @param to - The point the camera looks toward.
 * @returns A bearing in the range 0–360.
 */
export function bearingDegrees(from: GeoPoint, to: GeoPoint): number {
  const lat1 = (from.lat * Math.PI) / 180
  const lat2 = (to.lat * Math.PI) / 180
  const deltaLng = ((to.lng - from.lng) * Math.PI) / 180
  const y = Math.sin(deltaLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng)
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360
}

/**
 * Shortest signed turn from one heading to another, in degrees (−180, 180].
 *
 * @param from - Current heading.
 * @param to - Target heading.
 */
export function shortestBearingDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}

/**
 * Mixes two headings along the short arc.
 *
 * @param from - Current heading.
 * @param to - Target heading.
 * @param amount - 0 keeps `from`, 1 reaches `to`.
 */
export function mixBearing(from: number, to: number, amount: number): number {
  const t = Math.min(1, Math.max(0, amount))
  return (from + shortestBearingDelta(from, to) * t + 360) % 360
}

/**
 * Great-circle distance in metres.
 *
 * @param from - First point.
 * @param to - Second point.
 */
export function metersBetween(from: GeoPoint, to: GeoPoint): number {
  const lat1 = (from.lat * Math.PI) / 180
  const lat2 = (to.lat * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLng = ((to.lng - from.lng) * Math.PI) / 180
  const sin = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(sin)))
}

/**
 * Point `meters` from `from` along `bearing` degrees.
 *
 * @param from - Start.
 * @param bearing - Clockwise from north.
 * @param meters - Distance.
 */
export function offsetMeters(from: GeoPoint, bearing: number, meters: number): GeoPoint {
  const lat1 = (from.lat * Math.PI) / 180
  const lng1 = (from.lng * Math.PI) / 180
  const br = (bearing * Math.PI) / 180
  const ang = meters / EARTH_M
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(br),
  )
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(br) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    )
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI }
}

/**
 * Walks along the polyline from a vertex. Positive metres go forward.
 *
 * @param points - Ordered route.
 * @param index - Start vertex.
 * @param meters - Signed distance along the line.
 */
export function walkRoute(
  points: readonly GeoPoint[],
  index: number,
  meters: number,
): GeoPoint | null {
  if (points.length === 0) {
    return null
  }
  const startIndex = Math.min(points.length - 1, Math.max(0, index))
  const start = points[startIndex]
  if (!start) {
    return null
  }
  if (meters >= 0) {
    let left = meters
    for (let i = startIndex; i < points.length - 1; i += 1) {
      const a = points[i]
      const b = points[i + 1]
      if (!a || !b) {
        continue
      }
      const seg = metersBetween(a, b)
      if (seg < 1e-6) {
        continue
      }
      if (left <= seg) {
        const t = left / seg
        return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
      }
      left -= seg
    }
    return points[points.length - 1] ?? start
  }
  let left = -meters
  for (let i = startIndex; i > 0; i -= 1) {
    const a = points[i - 1]
    const b = points[i]
    if (!a || !b) {
      continue
    }
    const seg = metersBetween(a, b)
    if (seg < 1e-6) {
      continue
    }
    if (left <= seg) {
      const t = left / seg
      return { lat: b.lat + (a.lat - b.lat) * t, lng: b.lng + (a.lng - b.lng) * t }
    }
    left -= seg
  }
  return points[0] ?? start
}

/**
 * Bearing of travel at a fraction, looking ahead along the route.
 *
 * Identical neighbours are skipped. At the last point the bearing is the
 * arrival direction. When the route cannot define one, the previous bearing
 * is kept so the camera does not spin.
 *
 * @param points - Ordered route points.
 * @param fraction - Position from 0 to 1.
 * @param previous - Bearing to keep when this sample has no direction.
 * @returns A bearing in degrees.
 */
export function courseBearing(
  points: readonly GeoPoint[],
  fraction: number,
  previous: number,
): number {
  if (points.length < 2) {
    return previous
  }
  const index = indexAtFraction(points.length, fraction)
  const here = points[index]
  if (!here) {
    return previous
  }
  for (let ahead = index + 1; ahead < points.length; ahead += 1) {
    const next = points[ahead]
    if (next && (next.lat !== here.lat || next.lng !== here.lng)) {
      return bearingDegrees(here, next)
    }
  }
  for (let behind = index - 1; behind >= 0; behind -= 1) {
    const prev = points[behind]
    if (prev && (prev.lat !== here.lat || prev.lng !== here.lng)) {
      return bearingDegrees(prev, here)
    }
  }
  return previous
}

/**
 * Chase-camera pose: look along the route from just behind the athlete.
 *
 * The map center is a few metres ahead. Pitched MapLibre then places the
 * camera behind the athlete, so the path runs forward instead of a tilted
 * map sliding under a pin.
 *
 * @param points - Ordered route.
 * @param fraction - Sample index fraction, 0–1.
 * @param previousBearing - Heading from the last frame.
 * @param snap - Skip heading easing (seek / first frame).
 */
export function chasePose(
  points: readonly GeoPoint[],
  fraction: number,
  previousBearing: number,
  snap = false,
): ChasePose | null {
  const here = walkRoute(points, indexAtFraction(points.length, fraction), 0)
  if (!here) {
    return null
  }
  const index = indexAtFraction(points.length, fraction)
  const ahead = walkRoute(points, index, LOOK_AHEAD_M) ?? here
  const behind = walkRoute(points, index, -CAMERA_BEHIND_M) ?? here
  let target = previousBearing
  if (metersBetween(here, ahead) >= MIN_HEADING_M) {
    target = bearingDegrees(here, ahead)
  } else if (metersBetween(behind, here) >= MIN_HEADING_M) {
    target = bearingDegrees(behind, here)
  }
  const bearing = snap ? target : mixBearing(previousBearing, target, BEARING_SMOOTH)
  const along = walkRoute(points, index, LOOK_AT_M)
  const lookAt =
    along && metersBetween(here, along) >= LOOK_AT_M * 0.4
      ? along
      : offsetMeters(here, bearing, LOOK_AT_M)
  return { marker: here, lookAt, bearing }
}
