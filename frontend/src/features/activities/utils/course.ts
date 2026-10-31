import type { GeoPoint } from '@/composables/useMapProvider'

import { indexAtFraction } from '@/features/activities/utils/scrub'

/** Mean Earth radius, in metres. */
const EARTH_M = 6_371_000

/** How far along the route heading is read, in metres. */
export const LOOK_AHEAD_M = 60

/** Path samples mixed into the camera target bearing, in metres. */
export const LOOK_AHEAD_OFFSETS_M = [40, 60, 80] as const

/** How far along the route the athlete arrow reads heading, in metres. */
export const MARKER_AHEAD_M = 16

/** Ground point the map looks at, ahead of the athlete, in metres. */
export const LOOK_AT_M = 22

/** Fallback walk backward when there is no forward heading, in metres. */
export const CAMERA_BEHIND_M = 40

/** Ignore heading from a move shorter than this, so GPS jitter does not yaw. */
export const MIN_HEADING_M = 8

/** Blend toward the new heading each frame. 1 snaps, 0 never turns. */
export const BEARING_SMOOTH = 0.04

/** Walk / slow climb / hairpin: close, steep camera. */
export const MIN_SPEED_KMH = 8

/** Fast descent / sprint: bird's-eye panorama. */
export const MAX_SPEED_KMH = 45

/** Zoom at {@link MIN_SPEED_KMH}. */
export const ZOOM_SLOW = 17.5

/** Zoom at {@link MAX_SPEED_KMH}. */
export const ZOOM_FAST = 13.9

/** Zoom at a full hairpin ({@link TURN_ZOOM_FULL_DEG}). */
export const ZOOM_TURN = 18.2

/** Pitch at {@link MIN_SPEED_KMH}, in degrees. */
export const PITCH_SLOW = 67

/** Pitch at {@link MAX_SPEED_KMH}, in degrees. */
export const PITCH_FAST = 44

/** Pitch at a full hairpin, in degrees. */
export const PITCH_TURN = 70

/** Per-frame blend when the camera moves in (zoom up). */
export const CAMERA_LERP_IN = 0.04

/** Per-frame blend when the camera pulls out to panorama. */
export const CAMERA_LERP_OUT = 0.018

/** Default blend; {@link easeFraming} prefers {@link CAMERA_LERP_IN} on close-up. */
export const CAMERA_LERP = CAMERA_LERP_IN

/** Pull in when the look-ahead heading differs by more than this, in degrees. */
export const TURN_ZOOM_DEG = 20

/** Turn angle that applies the full close-up, in degrees. */
export const TURN_ZOOM_FULL_DEG = 90

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
  /** Unsmoothed look-ahead heading used for turn-in zoom, 0–360. */
  lookAhead: number
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
 * Circular mean of compass headings. Empty input returns `fallback`.
 *
 * @param bearings - Headings in degrees.
 * @param fallback - Used when nothing can be averaged.
 */
export function meanBearing(bearings: readonly number[], fallback: number): number {
  if (bearings.length === 0) {
    return fallback
  }
  let x = 0
  let y = 0
  for (const heading of bearings) {
    const radians = (heading * Math.PI) / 180
    x += Math.cos(radians)
    y += Math.sin(radians)
  }
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/**
 * Camera target heading from several look-ahead distances, so one GPS kink
 * does not yank the horizon.
 *
 * @param points - Ordered route.
 * @param cumulative - Path lengths.
 * @param here - Interpolated athlete position.
 * @param distance - Path metres at `here`.
 * @param fallback - Used when no sample is far enough.
 */
export function lookAheadBearing(
  points: readonly GeoPoint[],
  cumulative: readonly number[],
  here: GeoPoint,
  distance: number,
  fallback: number,
): number {
  const samples: number[] = []
  for (const offset of LOOK_AHEAD_OFFSETS_M) {
    const ahead = pointAtDistance(points, cumulative, distance + offset)
    if (ahead && metersBetween(here, ahead) >= MIN_HEADING_M) {
      samples.push(bearingDegrees(here, ahead))
    }
  }
  return meanBearing(samples, fallback)
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
 * Cumulative path length at each vertex, in metres. `result[0]` is 0.
 *
 * @param points - Ordered route.
 */
export function cumulativeDistances(points: readonly GeoPoint[]): number[] {
  const distances = new Array<number>(points.length)
  distances[0] = 0
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1]
    const here = points[index]
    const last = distances[index - 1] ?? 0
    distances[index] = prev && here ? last + metersBetween(prev, here) : last
  }
  return distances
}

/**
 * Largest vertex whose cumulative distance is at most `distance`.
 *
 * @param cumulative - Path lengths from {@link cumulativeDistances}.
 * @param distance - Metres from the start.
 */
export function indexAtDistance(cumulative: readonly number[], distance: number): number {
  if (cumulative.length === 0) {
    return 0
  }
  const target = Math.min(cumulative[cumulative.length - 1] ?? 0, Math.max(0, distance))
  let low = 0
  let high = cumulative.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if ((cumulative[mid] ?? Infinity) <= target) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  return low
}

/**
 * Path metres matching a sample-index fraction, interpolating between vertices.
 *
 * @param cumulative - Path lengths from {@link cumulativeDistances}.
 * @param fraction - Position from 0 to 1.
 */
export function distanceAlongFraction(cumulative: readonly number[], fraction: number): number {
  if (cumulative.length === 0) {
    return 0
  }
  if (cumulative.length === 1) {
    return 0
  }
  const floatIndex = clamp01(fraction) * (cumulative.length - 1)
  const index = Math.min(cumulative.length - 2, Math.floor(floatIndex))
  const mix = floatIndex - index
  const a = cumulative[index] ?? 0
  const b = cumulative[index + 1] ?? a
  return lerp(a, b, mix)
}

/**
 * Point at a path distance. Vertices are lerped, so the cursor is not stuck
 * on GPS samples.
 *
 * @param points - Ordered route.
 * @param cumulative - Path lengths from {@link cumulativeDistances}.
 * @param distance - Metres from the start.
 */
export function pointAtDistance(
  points: readonly GeoPoint[],
  cumulative: readonly number[],
  distance: number,
): GeoPoint | null {
  if (points.length === 0) {
    return null
  }
  const total = cumulative[cumulative.length - 1] ?? 0
  const along = Math.min(total, Math.max(0, distance))
  const index = indexAtDistance(cumulative, along)
  const from = points[index]
  if (!from) {
    return null
  }
  const to = points[index + 1]
  const start = cumulative[index] ?? 0
  const end = cumulative[index + 1] ?? start
  const span = end - start
  if (!to || span < 1e-6) {
    return from
  }
  const mix = (along - start) / span
  return {
    lat: from.lat + (to.lat - from.lat) * mix,
    lng: from.lng + (to.lng - from.lng) * mix,
  }
}

/**
 * Chase-camera pose: look along the route from just behind the athlete.
 *
 * The map center is a few metres ahead. Pitched MapLibre then places the
 * camera behind the athlete, so the path runs forward instead of a tilted
 * map sliding under a pin. The marker is the interpolated path point, not a
 * GPS vertex, so the glow ribbon can end on the same coordinate.
 *
 * @param points - Ordered route.
 * @param fraction - Sample index fraction, 0–1.
 * @param previousBearing - Heading from the last frame.
 * @param snap - Skip heading easing (seek / first frame).
 * @param cumulative - Optional path lengths; computed when omitted.
 */
export function chasePose(
  points: readonly GeoPoint[],
  fraction: number,
  previousBearing: number,
  snap = false,
  cumulative?: readonly number[],
): ChasePose | null {
  const lengths = cumulative ?? cumulativeDistances(points)
  const distance = distanceAlongFraction(lengths, fraction)
  const here = pointAtDistance(points, lengths, distance)
  if (!here) {
    return null
  }
  const behind = pointAtDistance(points, lengths, distance - CAMERA_BEHIND_M) ?? here
  let target = lookAheadBearing(points, lengths, here, distance, previousBearing)
  if (target === previousBearing && metersBetween(behind, here) >= MIN_HEADING_M) {
    target = bearingDegrees(behind, here)
  }
  const bearing = snap ? target : mixBearing(previousBearing, target, BEARING_SMOOTH)
  const near = pointAtDistance(points, lengths, distance + MARKER_AHEAD_M) ?? here
  let heading = bearing
  if (metersBetween(here, near) >= MIN_HEADING_M * 0.5) {
    heading = bearingDegrees(here, near)
  } else if (metersBetween(behind, here) >= MIN_HEADING_M * 0.5) {
    heading = bearingDegrees(behind, here)
  }
  const along = pointAtDistance(points, lengths, distance + LOOK_AT_M)
  const lookAt =
    along && metersBetween(here, along) >= LOOK_AT_M * 0.4
      ? along
      : offsetMeters(here, bearing, LOOK_AT_M)
  return { marker: here, lookAt, bearing, lookAhead: target, heading }
}

/**
 * Splits the polyline at a path distance. The interpolated cursor is the last
 * traveled coordinate and the first remaining coordinate, so the ribbon tip
 * and the athlete marker share one point.
 *
 * @param points - Ordered route.
 * @param cumulative - Path lengths from {@link cumulativeDistances}.
 * @param distance - Metres from the start.
 */
export function splitRouteAtDistance(
  points: readonly GeoPoint[],
  cumulative: readonly number[],
  distance: number,
): { traveled: GeoPoint[]; remaining: GeoPoint[] } {
  if (points.length === 0) {
    return { traveled: [], remaining: [] }
  }
  const here = pointAtDistance(points, cumulative, distance)
  if (!here) {
    return { traveled: [], remaining: [] }
  }
  const index = indexAtDistance(cumulative, distance)
  const traveled = points.slice(0, index + 1)
  const last = traveled[traveled.length - 1]
  if (!last || metersBetween(last, here) >= 0.01) {
    traveled.push(here)
  }
  const remaining = [here, ...points.slice(index + 1)]
  return { traveled, remaining }
}

/**
 * Splits the polyline at the playback cursor using interpolated path metres.
 *
 * @param points - Ordered route.
 * @param fraction - Position from 0 to 1.
 */
export function splitRouteAtFraction(
  points: readonly GeoPoint[],
  fraction: number,
): { traveled: GeoPoint[]; remaining: GeoPoint[] } {
  const lengths = cumulativeDistances(points)
  return splitRouteAtDistance(points, lengths, distanceAlongFraction(lengths, fraction))
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
 * Absolute heading change along the short arc, in degrees.
 *
 * @param currentBearing - Camera heading now.
 * @param targetBearing - Look-ahead heading.
 */
export function turnAngleDegrees(currentBearing: number, targetBearing: number): number {
  return Math.abs(shortestBearingDelta(currentBearing, targetBearing))
}

/**
 * 0–1 mix toward the hairpin close-up when the path bends harder than
 * {@link TURN_ZOOM_DEG}.
 *
 * @param turnAngle - Degrees from {@link turnAngleDegrees}.
 */
export function turnZoomBoost(turnAngle: number): number {
  if (turnAngle <= TURN_ZOOM_DEG) {
    return 0
  }
  const span = TURN_ZOOM_FULL_DEG - TURN_ZOOM_DEG
  return clamp01((turnAngle - TURN_ZOOM_DEG) / span)
}

/**
 * Zoom and pitch for a ground speed. Slow is close and steep; fast pulls back
 * and flattens into a valley panorama. Sharp turns mix toward the hairpin
 * close-up so the camera stays with the athlete at any speed.
 *
 * @param speedKmh - Smoothed speed in kilometres per hour.
 * @param turnAngle - Look-ahead heading change in degrees.
 */
export function framingFromSpeedKmh(
  speedKmh: number,
  turnAngle = 0,
): { zoom: number; pitch: number } {
  const t = clamp01((speedKmh - MIN_SPEED_KMH) / (MAX_SPEED_KMH - MIN_SPEED_KMH))
  const turn = turnZoomBoost(turnAngle)
  return {
    zoom: lerp(lerp(ZOOM_SLOW, ZOOM_FAST, t), ZOOM_TURN, turn),
    pitch: lerp(lerp(PITCH_SLOW, PITCH_FAST, t), PITCH_TURN, turn),
  }
}

/**
 * Steps zoom and pitch toward a target. Seek jumps. Playback eases in faster
 * than it eases out, so a hairpin snaps close and the panorama lifts slowly.
 *
 * @param current - Last frame.
 * @param target - Speed-derived framing.
 * @param snap - Skip easing.
 * @param amount - Blend per frame. Defaults to in/out from zoom direction.
 */
export function easeFraming(
  current: { zoom: number; pitch: number },
  target: { zoom: number; pitch: number },
  snap: boolean,
  amount?: number,
): { zoom: number; pitch: number } {
  if (snap) {
    return target
  }
  const closing =
    target.zoom > current.zoom || (target.zoom === current.zoom && target.pitch > current.pitch)
  const mix = amount ?? (closing ? CAMERA_LERP_IN : CAMERA_LERP_OUT)
  return {
    zoom: lerp(current.zoom, target.zoom, mix),
    pitch: lerp(current.pitch, target.pitch, mix),
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
