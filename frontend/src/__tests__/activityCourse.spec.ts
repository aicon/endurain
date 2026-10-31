import { describe, expect, it } from 'vitest'

import {
  LOOK_AT_M,
  bearingDegrees,
  chasePose,
  courseBearing,
  metersBetween,
  mixBearing,
  shortestBearingDelta,
} from '@/features/activities/utils/course'

describe('bearingDegrees', () => {
  it('looks east and north', () => {
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 5)
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 5)
  })
})

describe('mixBearing', () => {
  it('takes the short turn across north', () => {
    expect(shortestBearingDelta(350, 10)).toBeCloseTo(20, 5)
    expect(mixBearing(350, 10, 0.5)).toBeCloseTo(0, 5)
  })
})

describe('courseBearing', () => {
  const points = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 1, lng: 1 },
  ]

  it('looks ahead from the start', () => {
    expect(courseBearing(points, 0, 0)).toBeCloseTo(90, 5)
  })

  it('uses the arrival direction at the end', () => {
    expect(courseBearing(points, 1, 0)).toBeCloseTo(0, 5)
  })

  it('keeps the previous bearing when every point is the same', () => {
    const stuck = [
      { lat: 1, lng: 1 },
      { lat: 1, lng: 1 },
    ]
    expect(courseBearing(stuck, 0.4, 33)).toBe(33)
  })
})

describe('chasePose', () => {
  const east = Array.from({ length: 12 }, (_, index) => ({
    lat: 0,
    lng: index * 0.001,
  }))

  it('looks east at a point ahead of the marker', () => {
    const pose = chasePose(east, 0.4, 90, true)
    expect(pose).not.toBeNull()
    if (!pose) {
      return
    }
    expect(pose.bearing).toBeCloseTo(90, 0)
    expect(pose.heading).toBeCloseTo(90, 0)
    expect(pose.lookAt.lng).toBeGreaterThan(pose.marker.lng)
    expect(metersBetween(pose.lookAt, pose.marker)).toBeGreaterThan(LOOK_AT_M * 0.4)
  })

  it('does not yaw to a one-sample GPS spike', () => {
    const spiked = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
      { lat: 0.0002, lng: 0.00105 },
      { lat: 0, lng: 0.002 },
      { lat: 0, lng: 0.003 },
      { lat: 0, lng: 0.004 },
    ]
    const pose = chasePose(spiked, 1 / 5, 90, true)
    expect(pose).not.toBeNull()
    if (!pose) {
      return
    }
    expect(Math.abs(shortestBearingDelta(90, pose.bearing))).toBeLessThan(35)
  })

  it('keeps the previous heading when the route does not move', () => {
    const stuck = [
      { lat: 1, lng: 1 },
      { lat: 1, lng: 1 },
    ]
    const pose = chasePose(stuck, 0.5, 33, true)
    expect(pose?.bearing).toBe(33)
    expect(pose?.heading).toBe(33)
  })

  it('turns the athlete arrow with the path, not the far look-ahead', () => {
    const step = 0.00025
    const eastThenNorth = [
      ...Array.from({ length: 8 }, (_, index) => ({ lat: 0, lng: index * step })),
      ...Array.from({ length: 8 }, (_, index) => ({
        lat: (index + 1) * step,
        lng: 7 * step,
      })),
    ]
    const pose = chasePose(eastThenNorth, 6 / 15, 90, true)
    expect(pose).not.toBeNull()
    if (!pose) {
      return
    }
    expect(pose.heading).toBeCloseTo(90, 0)
    expect(Math.abs(shortestBearingDelta(pose.heading, pose.bearing))).toBeGreaterThan(20)
  })
})
