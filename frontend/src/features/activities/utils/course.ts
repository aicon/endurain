import type { GeoPoint } from '@/composables/useMapProvider'

import { indexAtFraction } from '@/features/activities/utils/scrub'

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
