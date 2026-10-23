import { describe, expect, it } from 'vitest'

import { bearingDegrees, courseBearing } from '@/features/activities/utils/course'

describe('bearingDegrees', () => {
  it('looks east and north', () => {
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 5)
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 5)
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
