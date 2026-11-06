import type { MetricPillVariants } from '@/components/ui/metric-pill'

import type { Activity } from '../types'
import {
  activityTypeIsCycling,
  activityTypeIsDistanceBased,
  activityTypeIsJumpRope,
  activityTypeIsRunning,
  activityTypeIsSailing,
  activityTypeIsSwimming,
  activityTypeIsWindsurf,
  activityTypeUsesPace,
} from './activityType'
import {
  combineMetric,
  formatAirTemperature,
  formatDistance,
  formatElevation,
  formatHmsDuration,
  formatPace,
  formatSpeed,
  formatWindSpeed,
  type Units,
} from './format'

/** Which privacy-gated metrics the current viewer is allowed to see. */
export interface MetricVisibility {
  pace: boolean
  speed: boolean
  hr: boolean
  power: boolean
  cadence: boolean
  elevation: boolean
  location: boolean
}

/** A single summary metric tile. */
export interface MetricTile {
  /** Stable key for list rendering. */
  key: string
  /** i18n label key. */
  labelKey: string
  /** Formatted value. */
  value: string
  /** Unit suffix (may be empty). */
  unit: string
  /** Semantic colour accent for the value. */
  accent: NonNullable<MetricPillVariants['accent']>
}

/** Whether a numeric metric is present and finite. */
function has(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value)
}

/** i18n key for an Open-Meteo WMO weather code. */
export function weatherConditionLabelKey(code: number | null): string {
  if (code === null) {
    return 'activities.metrics.weather'
  }
  if (code <= 1) {
    return 'activities.metrics.weatherClear'
  }
  if (code <= 3) {
    return 'activities.metrics.weatherCloudy'
  }
  if (code === 45 || code === 48) {
    return 'activities.metrics.weatherFoggy'
  }
  if (code >= 51 && code <= 57) {
    return 'activities.metrics.weatherDrizzle'
  }
  if (
    (code >= 61 && code <= 67) ||
    (code >= 80 && code <= 82) ||
    code === 91 ||
    code === 92
  ) {
    return 'activities.metrics.weatherRainy'
  }
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) {
    return 'activities.metrics.weatherSnowy'
  }
  if (code >= 95) {
    return 'activities.metrics.weatherStormy'
  }
  return 'activities.metrics.weather'
}

/**
 * The activity's headline duration: moving (timer) time, matching the source app
 * and the activity list, or elapsed time when the timer time is missing or 0
 * (some imports and manual entries record no timer time).
 *
 * @param activity - The activity domain model.
 * @returns The duration in seconds, or `null` when neither time is positive.
 */
export function activityDuration(activity: Activity): number | null {
  for (const seconds of [activity.totalTimerTime, activity.totalElapsedTime]) {
    if (has(seconds) && seconds > 0) {
      return seconds
    }
  }
  return null
}

/**
 * The activity's elapsed (wall-clock) time when it differs from
 * {@link activityDuration}, e.g. a ride with long stops.
 *
 * @param activity - The activity domain model.
 * @returns The elapsed time in seconds, or `null` when absent or equal to the duration.
 */
export function distinctElapsedTime(activity: Activity): number | null {
  const elapsed = activity.totalElapsedTime
  const duration = activityDuration(activity)
  if (
    !has(elapsed) ||
    elapsed <= 0 ||
    duration === null ||
    Math.round(elapsed) === Math.round(duration)
  ) {
    return null
  }
  return elapsed
}

/**
 * Builds the summary metric tiles for an activity. Distance sports keep their
 * pace or speed, and also show heart rate and elevation when those aggregates
 * are already stored. Swimming does not get an elevation tile. Non-distance
 * sessions (gym/strength/racquet) stay calories, time, and average heart rate.
 * Privacy-hidden stats and missing aggregates are omitted.
 *
 * @param activity - The activity domain model.
 * @param units - The user's unit system.
 * @param visibility - Which privacy-gated metrics the viewer may see.
 * @returns The ordered tiles to render.
 */
export function buildActivityMetrics(
  activity: Activity,
  units: Units,
  visibility: MetricVisibility,
): MetricTile[] {
  const type = activity.activityType
  const tiles: MetricTile[] = []

  const pushTime = (): void => {
    const duration = activityDuration(activity)
    if (duration !== null) {
      tiles.push({
        key: 'time',
        labelKey: 'activities.metrics.time',
        value: formatHmsDuration(duration),
        unit: '',
        accent: 'ink',
      })
    }
  }
  // Wall-clock elapsed time sits next to moving time when stops make it longer
  // (same field Dreeve shows as elapsed). Pace/speed charts still add it too.
  const pushWeather = (): void => {
    const weather = activity.weather
    if (!visibility.location || weather === null || !has(weather.temperatureC)) {
      return
    }
    const temp = formatAirTemperature(weather.temperatureC, units)
    tiles.push({
      key: 'weather',
      labelKey: weatherConditionLabelKey(weather.code),
      value: temp.value,
      unit: temp.unit,
      accent: 'info',
    })
    if (has(weather.humidity)) {
      tiles.push({
        key: 'humidity',
        labelKey: 'activities.metrics.humidity',
        value: String(weather.humidity),
        unit: '%',
        accent: 'ink',
      })
    }
    if (has(weather.windKmh)) {
      const wind = formatWindSpeed(weather.windKmh, units)
      tiles.push({
        key: 'wind',
        labelKey: 'activities.metrics.wind',
        value: weather.windDir ? `${wind.value} ${weather.windDir}` : wind.value,
        unit: wind.unit,
        accent: 'ink',
      })
    }
  }
  const pushElapsed = (): void => {
    const elapsed = distinctElapsedTime(activity)
    if (elapsed !== null) {
      tiles.push({
        key: 'elapsedTime',
        labelKey: 'activities.metrics.elapsedTime',
        value: formatHmsDuration(elapsed),
        unit: '',
        accent: 'ink',
      })
    }
  }
  const pushCalories = (): void => {
    if (has(activity.calories)) {
      tiles.push({
        key: 'calories',
        labelKey: 'activities.metrics.calories',
        value: String(Math.round(activity.calories)),
        unit: 'kcal',
        accent: 'effort',
      })
    }
  }
  const pushPace = (): void => {
    if (visibility.pace && has(activity.pace)) {
      const pace = formatPace(activity.pace, type, units)
      tiles.push({
        key: 'pace',
        labelKey: 'activities.metrics.avgPace',
        value: pace.value,
        unit: pace.unit,
        accent: 'info',
      })
    }
  }
  const pushAvgSpeed = (): void => {
    if (visibility.speed && has(activity.averageSpeed)) {
      const speed = formatSpeed(activity.averageSpeed, type, units)
      tiles.push({
        key: 'avgSpeed',
        labelKey: 'activities.metrics.avgSpeed',
        value: speed.value,
        unit: speed.unit,
        accent: 'info',
      })
    }
  }
  const pushElevationGain = (): void => {
    if (visibility.elevation && has(activity.elevationGain)) {
      const gain = formatElevation(activity.elevationGain, units)
      tiles.push({
        key: 'elevationGain',
        labelKey: 'activities.metrics.elevationGain',
        value: gain.value,
        unit: gain.unit,
        accent: 'goal',
      })
    }
  }
  const pushAvgPower = (): void => {
    if (visibility.power && has(activity.averagePower)) {
      tiles.push({
        key: 'avgPower',
        labelKey: 'activities.metrics.avgPower',
        value: String(Math.round(activity.averagePower)),
        unit: 'W',
        accent: 'effort',
      })
    }
  }
  const pushAvgHr = (): void => {
    if (visibility.hr && has(activity.averageHr)) {
      tiles.push({
        key: 'avgHr',
        labelKey: 'activities.metrics.avgHr',
        value: String(Math.round(activity.averageHr)),
        unit: 'bpm',
        accent: 'hr',
      })
    }
  }
  const pushMaxHr = (): void => {
    if (visibility.hr && has(activity.maxHr)) {
      tiles.push({
        key: 'maxHr',
        labelKey: 'activities.metrics.maxHr',
        value: String(Math.round(activity.maxHr)),
        unit: 'bpm',
        accent: 'hr',
      })
    }
  }
  // Jump rope: total_cycles is the total jump count and the headline metric
  // (jump rope has no distance). Other sports interpret cycles differently
  // (strides/pedal revolutions/strokes) where cadence already covers it.
  const pushJumps = (): void => {
    if (activityTypeIsJumpRope(type) && has(activity.totalCycles)) {
      tiles.push({
        key: 'jumps',
        labelKey: 'activities.metrics.jumps',
        value: String(Math.round(activity.totalCycles)),
        unit: '',
        accent: 'brand',
      })
    }
  }

  // Non-distance sessions (gym/strength/yoga/racquet/…): calories, time, avg HR.
  if (!activityTypeIsDistanceBased(type)) {
    pushJumps()
    pushCalories()
    pushTime()
    pushElapsed()
    pushWeather()
    pushAvgHr()
    return tiles
  }

  // Distance-based, starting with distance and time. Heart rate and elevation
  // follow when the activity stored them, including on a walk or hike.
  const distance = formatDistance(activity.distance, type, units)
  tiles.push({
    key: 'distance',
    labelKey: 'activities.metrics.distance',
    value: distance.value,
    unit: distance.unit,
    accent: 'brand',
  })
  pushTime()
  pushElapsed()
  pushWeather()

  if (activityTypeIsCycling(type)) {
    // distance, time, elevation, power, speed, heart rate, calories
    pushElevationGain()
    pushAvgPower()
    pushAvgSpeed()
    pushAvgHr()
    pushMaxHr()
    pushCalories()
  } else if (activityTypeIsRunning(type)) {
    // distance, time, pace, power, elevation, heart rate, calories
    pushPace()
    pushAvgPower()
    pushElevationGain()
    pushAvgHr()
    pushMaxHr()
    pushCalories()
  } else if (activityTypeIsWindsurf(type) || activityTypeIsSailing(type)) {
    // distance, time, speed, heart rate, elevation, calories
    pushAvgSpeed()
    pushAvgHr()
    pushMaxHr()
    pushElevationGain()
    pushCalories()
  } else {
    // swimming/walking/hiking/rowing/…: distance, time, pace, heart rate, elevation, calories
    pushPace()
    pushAvgHr()
    pushMaxHr()
    if (!activityTypeIsSwimming(type)) {
      pushElevationGain()
    }
    pushCalories()
  }

  return tiles
}

/**
 * Formats a single lap's pace or speed for the laps table, choosing pace vs.
 * speed by activity type.
 *
 * @param enhancedAvgPace - Lap average pace in seconds per metre.
 * @param enhancedAvgSpeed - Lap average speed in metres per second.
 * @param activityType - Numeric activity type.
 * @param units - The user's unit system.
 * @returns A combined `value unit` string, or `--`.
 */
export function formatLapTempo(
  enhancedAvgPace: number | null,
  enhancedAvgSpeed: number | null,
  activityType: number,
  units: Units,
): string {
  if (activityTypeUsesPace(activityType)) {
    return enhancedAvgPace === null
      ? '--'
      : combineMetric(formatPace(enhancedAvgPace, activityType, units))
  }
  return enhancedAvgSpeed === null
    ? '--'
    : combineMetric(formatSpeed(enhancedAvgSpeed, activityType, units))
}
