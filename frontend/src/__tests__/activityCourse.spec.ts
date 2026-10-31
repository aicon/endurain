import { describe, expect, it } from 'vitest'

import {
  CAMERA_LERP,
  LOOK_AT_M,
  PITCH_FAST,
  PITCH_SLOW,
  ZOOM_FAST,
  ZOOM_SLOW,
  bearingDegrees,
  chasePose,
  courseBearing,
  cumulativeDistances,
  distanceAlongFraction,
  easeFraming,
  framingFromSpeedKmh,
  metersBetween,
  mixBearing,
  mpsToKmh,
  pointAtDistance,
  shortestBearingDelta,
  speedMpsAtFraction,
  splitRouteAtDistance,
  splitRouteAtFraction,
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

describe('framingFromSpeedKmh', () => {
  it('is close and steep when walking', () => {
    expect(framingFromSpeedKmh(5).zoom).toBeCloseTo(ZOOM_SLOW, 5)
    expect(framingFromSpeedKmh(5).pitch).toBeCloseTo(PITCH_SLOW, 5)
  })

  it('pulls back and flattens when fast', () => {
    expect(framingFromSpeedKmh(60).zoom).toBeCloseTo(ZOOM_FAST, 5)
    expect(framingFromSpeedKmh(60).pitch).toBeCloseTo(PITCH_FAST, 5)
  })
})

describe('easeFraming', () => {
  it('jumps on seek', () => {
    expect(
      easeFraming({ zoom: 16, pitch: 62 }, { zoom: ZOOM_FAST, pitch: PITCH_FAST }, true),
    ).toEqual({ zoom: ZOOM_FAST, pitch: PITCH_FAST })
  })

  it('moves a thirtieth of the gap each frame', () => {
    const next = easeFraming({ zoom: 16, pitch: 60 }, { zoom: 17, pitch: 50 }, false)
    expect(next.zoom).toBeCloseTo(16 + CAMERA_LERP, 5)
    expect(next.pitch).toBeCloseTo(60 + (50 - 60) * CAMERA_LERP, 5)
  })
})

describe('speedMpsAtFraction', () => {
  const east = Array.from({ length: 9 }, (_, index) => ({
    lat: 0,
    lng: index * 0.0001,
  }))
  const stepM = metersBetween(east[0]!, east[1]!)

  it('uses timestamps when they match the route', () => {
    const times = east.map((_, index) => index * 1000)
    const mps = speedMpsAtFraction(east, 0.5, times)
    expect(mps).toBeCloseTo(stepM, 3)
    expect(mpsToKmh(mps)).toBeCloseTo(stepM * 3.6, 3)
  })

  it('treats each sample as one second when the clock is missing', () => {
    expect(speedMpsAtFraction(east, 0.5, null)).toBeCloseTo(stepM, 3)
  })
})

describe('splitRouteAtFraction', () => {
  const points = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 0, lng: 2 },
    { lat: 0, lng: 3 },
  ]

  it('ends the traveled line on the interpolated cursor', () => {
    const split = splitRouteAtFraction(points, 0.5)
    const tip = split.traveled[split.traveled.length - 1]
    expect(tip).toEqual(split.remaining[0])
    expect(tip?.lng).toBeCloseTo(1.5, 5)
    expect(split.traveled[0]).toEqual(points[0])
    expect(split.traveled[1]).toEqual(points[1])
    expect(split.remaining[split.remaining.length - 1]).toEqual(points[3])
  })

  it('puts the whole route on remaining at the start', () => {
    const split = splitRouteAtFraction(points, 0)
    expect(split.traveled).toEqual([points[0]])
    expect(split.remaining).toEqual(points)
  })
})

describe('pointAtDistance', () => {
  const points = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.001 },
    { lat: 0, lng: 0.002 },
  ]
  const lengths = cumulativeDistances(points)

  it('lerps between vertices', () => {
    const mid = pointAtDistance(points, lengths, (lengths[1] ?? 0) * 0.5)
    expect(mid?.lng).toBeCloseTo(0.0005, 6)
  })

  it('matches distanceAlongFraction at the midpoint sample', () => {
    const distance = distanceAlongFraction(lengths, 0.5)
    const here = pointAtDistance(points, lengths, distance)
    expect(here?.lng).toBeCloseTo(0.001, 6)
  })
})

describe('splitRouteAtDistance', () => {
  it('pins the ribbon tip to the same coordinate as the cursor', () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
      { lat: 0, lng: 0.002 },
    ]
    const lengths = cumulativeDistances(points)
    const distance = (lengths[1] ?? 0) * 0.4
    const split = splitRouteAtDistance(points, lengths, distance)
    const tip = split.traveled[split.traveled.length - 1]
    const here = pointAtDistance(points, lengths, distance)
    expect(tip).toEqual(here)
    expect(split.remaining[0]).toEqual(here)
  })
})
