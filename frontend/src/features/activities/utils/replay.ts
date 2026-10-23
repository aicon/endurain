import { indexAtFraction } from '@/features/activities/utils/scrub'

/** Playback rates shown on the button. `1` is the default label. */
export const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8] as const

/**
 * The labeled rate is multiplied by this before it drives the clock, so the
 * button still reads 1x while the route plays at ten times the recording.
 */
export const REPLAY_SPEED_SCALE = 10

/** One playback rate from {@link REPLAY_SPEEDS}. */
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number]

/**
 * Wall-clock time given to each sample when the track has no timestamps.
 * One second per sample matches a typical one-hertz GPS recording.
 */
const FALLBACK_SAMPLE_MS = 1000

/** Inputs for one playback step. */
export interface ReplayStepInput {
  /** Wall-clock milliseconds since play (or the last speed change). */
  elapsedMs: number
  /** Multiplier applied to recorded time. `2` covers the route twice as fast. */
  speed: number
  /** Number of route samples. */
  length: number
  /**
   * Sample times in epoch milliseconds, one per route point. `null` when the
   * series has no usable clock, which falls back to even sample spacing.
   */
  timesMs: readonly number[] | null
  /** Fraction already reached when this step's clock started. */
  startFraction: number
}

/** Where playback is after the elapsed wall clock. */
export interface ReplayStep {
  /** Position along the route, from 0 to 1. */
  fraction: number
  /** `true` when the cursor has reached the end. */
  done: boolean
}

/**
 * Returns the timestamp series when every sample has a finite time and the
 * last sample is later than the first. Anything else is not a real clock.
 *
 * @param timesMs - Candidate times, or `null`.
 * @param length - Expected sample count.
 * @returns The same series, or `null` when playback should use sample order.
 */
function usableTimes(timesMs: readonly number[] | null, length: number): readonly number[] | null {
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
 * Largest index whose timestamp is at or before `target`.
 *
 * @param times - Ascending sample times.
 * @param target - Clock time to place.
 * @returns The sample index.
 */
function indexAtTime(times: readonly number[], target: number): number {
  let low = 0
  let high = times.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if ((times[mid] ?? Infinity) <= target) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  return low
}

/**
 * Advances a route cursor by wall-clock time.
 *
 * With timestamps, `speed` scales recorded time: one second at `2` moves two
 * seconds along the activity, and the fraction is the index of that sample so
 * the charts stay on the same point. Without timestamps, the same clock walks
 * the samples evenly, one second of wall clock per sample at `1`.
 *
 * @param input - Elapsed time, speed, and the route clock.
 * @returns The next fraction and whether the route is finished.
 */
export function replayStep(input: ReplayStepInput): ReplayStep {
  const { length } = input
  if (length <= 1) {
    return { fraction: 0, done: true }
  }
  const start = Math.min(1, Math.max(0, input.startFraction))
  const elapsed = Math.max(0, input.elapsedMs)
  const speed = input.speed > 0 ? input.speed : 1
  const times = usableTimes(input.timesMs, length)
  if (times) {
    const origin = times[indexAtFraction(length, start)] ?? times[0] ?? 0
    const target = origin + elapsed * speed
    const last = times[length - 1] ?? target
    if (target >= last) {
      return { fraction: 1, done: true }
    }
    const index = indexAtTime(times, target)
    return { fraction: index / (length - 1), done: false }
  }
  const duration = (length - 1) * FALLBACK_SAMPLE_MS
  const fraction = Math.min(1, start + (elapsed * speed) / duration)
  return { fraction, done: fraction >= 1 }
}
