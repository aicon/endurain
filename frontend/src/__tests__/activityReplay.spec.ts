import { describe, expect, it } from 'vitest'

import { replayStep, smoothFrameDelta } from '@/features/activities/utils/replay'

const times = [0, 1_000, 3_000]

describe('replayStep', () => {
  it('follows recorded time at 1×', () => {
    expect(
      replayStep({ elapsedMs: 1_000, speed: 1, length: 3, timesMs: times, startFraction: 0 }),
    ).toEqual({ fraction: 0.5, done: false })
  })

  it('interpolates between samples instead of sitting on a vertex', () => {
    expect(
      replayStep({ elapsedMs: 500, speed: 1, length: 3, timesMs: times, startFraction: 0 }),
    ).toEqual({ fraction: 0.25, done: false })
    expect(
      replayStep({ elapsedMs: 2_000, speed: 1, length: 3, timesMs: times, startFraction: 0 }),
    ).toEqual({ fraction: 0.75, done: false })
  })

  it('scales recorded time by the speed', () => {
    expect(
      replayStep({ elapsedMs: 1_000, speed: 2, length: 3, timesMs: times, startFraction: 0 }),
    ).toEqual({ fraction: 0.75, done: false })
    expect(
      replayStep({ elapsedMs: 1_500, speed: 2, length: 3, timesMs: times, startFraction: 0 }),
    ).toEqual({ fraction: 1, done: true })
  })

  it('continues from the current sample', () => {
    expect(
      replayStep({ elapsedMs: 2_000, speed: 1, length: 3, timesMs: times, startFraction: 0.5 }),
    ).toEqual({ fraction: 1, done: true })
  })

  it('walks samples evenly when timestamps are missing', () => {
    expect(
      replayStep({ elapsedMs: 2_000, speed: 1, length: 5, timesMs: null, startFraction: 0 }),
    ).toEqual({
      fraction: 0.5,
      done: false,
    })
    expect(
      replayStep({ elapsedMs: 1_000, speed: 2, length: 5, timesMs: null, startFraction: 0 }),
    ).toEqual({
      fraction: 0.5,
      done: false,
    })
    expect(
      replayStep({ elapsedMs: 4_000, speed: 1, length: 5, timesMs: null, startFraction: 0 }),
    ).toEqual({
      fraction: 1,
      done: true,
    })
  })

  it('blends a jittery RAF interval', () => {
    const previous = 1 / 60
    const next = smoothFrameDelta(previous, 0.019)
    expect(next).toBeGreaterThan(previous)
    expect(next).toBeLessThan(0.019)
    expect(smoothFrameDelta(previous, 1)).toBeCloseTo(previous * 0.8 + 0.05 * 0.2, 5)
  })

  it('uses even spacing when a timestamp is missing', () => {
    expect(
      replayStep({
        elapsedMs: 1_000,
        speed: 1,
        length: 3,
        timesMs: [0, Number.NaN, 2_000],
        startFraction: 0,
      }),
    ).toEqual({ fraction: 0.5, done: false })
  })
})
