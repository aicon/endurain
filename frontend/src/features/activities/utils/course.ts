import type { GeoPoint } from '@/composables/useMapProvider'

import { indexAtFraction } from '@/features/activities/utils/scrub'

/** Mean Earth radius, in metres. */
const EARTH_M = 6_371_000

/** How far along the route heading is read, in metres. */
export const LOOK_AHEAD_M = 60

/** How far along the route the athlete arrow reads heading, in metres. */
export const MARKER_AHEAD_M = 16

/** Ground point the map looks at, ahead of the athlete, in metres. */
export const LOOK_AT_M = 22

/** Fallback walk backward when there is no forward heading, in metres. */
export const CAMERA_BEHIND_M = 40

/** Ignore heading from a move shorter than this, so GPS jitter does not yaw. */
export const MIN_HEADING_M = 8

/** Blend toward the new heading each frame. 1 snaps, 0 never turns. */
export const BEARING_SMOOTH = 0.28

/** Walk / slow climb: close, steep camera. */
export const MIN_SPEED_KMH = 5

/** Fast descent / sprint: pull back for the next bend. */
export const MAX_SPEED_KMH = 60

/** Zoom at {@link MIN_SPEED_KMH}. */
export const ZOOM_SLOW = 17.1

/** Zoom at {@link MAX_SPEED_KMH}. */
export const ZOOM_FAST = 15.65

/** Pitch at {@link MIN_SPEED_KMH}, in degrees. */
export const PITCH_SLOW = 65

/** Pitch at {@link MAX_SPEED_KMH}, in degrees. */
export const PITCH_FAST = 55

/** Per-frame blend for zoom and pitch. 1 snaps, 0 never moves. */
export const CAMERA_LERP = 0.03

/** Samples on each side of the cursor used to average speed. */
const SPEED_HALF_WINDOW = 4

/** One second per sample when the track has no clock, matching playback. */
const FALLBACK_SAMPLE_S = 1

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
  /** Compass heading of the path under the athlete, 0–360. */
  heading: number
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
  const near = walkRoute(points, index, MARKER_AHEAD_M) ?? here
  let heading = bearing
  if (metersBetween(here, near) >= MIN_HEADING_M * 0.5) {
    heading = bearingDegrees(here, near)
  } else if (metersBetween(behind, here) >= MIN_HEADING_M * 0.5) {
    heading = bearingDegrees(behind, here)
  }
  const along = walkRoute(points, index, LOOK_AT_M)
  const lookAt =
    along && metersBetween(here, along) >= LOOK_AT_M * 0.4
      ? along
      : offsetMeters(here, bearing, LOOK_AT_M)
  return { marker: here, lookAt, bearing, heading }
}

/**
 * Splits the polyline at the playback cursor. Both sides include the current
 * vertex so the remaining ghost and the glow ribbon meet at the athlete.
 *
 * @param points - Ordered route.
 * @param fraction - Position from 0 to 1.
 */
export function splitRouteAtFraction(
  points: readonly GeoPoint[],
  fraction: number,
): { traveled: GeoPoint[]; remaining: GeoPoint[] } {
  if (points.length === 0) {
    return { traveled: [], remaining: [] }
  }
  const index = indexAtFraction(points.length, fraction)
  return {
    traveled: points.slice(0, index + 1),
    remaining: points.slice(index),
  }
}

/**
 * Clamps `value` to 0–1.
 *
 * @param value - Unbounded mix amount.
 */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Linear interpolation.
 *
 * @param from - Start.
 * @param to - End.
 * @param amount - 0 keeps `from`, 1 reaches `to`.
 */
export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount
}

/**
 * Zoom and pitch for a ground speed. Slow is close and steep; fast pulls back
 * and flattens so the next bend stays in view.
 *
 * @param speedKmh - Smoothed speed in kilometres per hour.
 */
export function framingFromSpeedKmh(speedKmh: number): { zoom: number; pitch: number } {
  const t = clamp01((speedKmh - MIN_SPEED_KMH) / (MAX_SPEED_KMH - MIN_SPEED_KMH))
  return {
    zoom: lerp(ZOOM_SLOW, ZOOM_FAST, t),
    pitch: lerp(PITCH_SLOW, PITCH_FAST, t),
  }
}

/**
 * Steps zoom and pitch toward a target. Seek jumps; playback eases.
 *
 * @param current - Last frame.
 * @param target - Speed-derived framing.
 * @param snap - Skip easing.
 * @param amount - Blend per frame. Defaults to {@link CAMERA_LERP}.
 */
export function easeFraming(
  current: { zoom: number; pitch: number },
  target: { zoom: number; pitch: number },
  snap: boolean,
  amount = CAMERA_LERP,
): { zoom: number; pitch: number } {
  if (snap) {
    return target
  }
  return {
    zoom: lerp(current.zoom, target.zoom, amount),
    pitch: lerp(current.pitch, target.pitch, amount),
  }
}

/**
 * Sample clock when every time is finite and the series moves forward.
 *
 * @param timesMs - Candidate times, or `null`.
 * @param length - Expected sample count.
 */
function usableSpeedTimes(
  timesMs: readonly number[] | null,
  length: number,
): readonly number[] | null {
  if (!timesMs || timesMs.length !== length || length < 2) {
    return null
  }
  const first = timesMs[0]
  const last = timesMs[length - 1]
  if (
    first == null ||
    last == null ||
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    last <= first
  ) {
    return null
  }
  for (const time of timesMs) {
    if (!Number.isFinite(time)) {
      return null
    }
  }
  return timesMs
}

/**
 * Ground speed at a route fraction, in metres per second. Uses a few samples
 * around the cursor. When timestamps are missing, each sample is one second.
 *
 * @param points - Ordered route.
 * @param fraction - Position from 0 to 1.
 * @param timesMs - Epoch milliseconds per point, or `null`.
 */
export function speedMpsAtFraction(
  points: readonly GeoPoint[],
  fraction: number,
  timesMs: readonly number[] | null,
): number {
  if (points.length < 2) {
    return 0
  }
  const index = indexAtFraction(points.length, fraction)
  const from = Math.max(0, index - SPEED_HALF_WINDOW)
  const to = Math.min(points.length - 1, index + SPEED_HALF_WINDOW)
  if (to <= from) {
    return 0
  }
  let distance = 0
  for (let step = from; step < to; step += 1) {
    const a = points[step]
    const b = points[step + 1]
    if (a && b) {
      distance += metersBetween(a, b)
    }
  }
  const times = usableSpeedTimes(timesMs, points.length)
  const firstTime = times?.[from]
  const lastTime = times?.[to]
  const durationS =
    firstTime != null && lastTime != null && lastTime > firstTime
      ? (lastTime - firstTime) / 1000
      : (to - from) * FALLBACK_SAMPLE_S
  if (distance <= 0 || durationS <= 0) {
    return 0
  }
  return distance / durationS
}

/** Metres per second to kilometres per hour. */
export function mpsToKmh(mps: number): number {
  return mps * 3.6
}
