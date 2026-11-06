import { Mountain, type LucideIcon } from '@lucide/vue'

import type { Schemas } from '@/types'

import { activityTypeIcon } from '@/features/activities/utils/activityType'

/** `Date.getUTCDay()` index for each profile week-start value. Sunday is 0. */
const WEEK_START_INDEX: Record<Schemas['WeekDay'], number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

/** `Date.getUTCDay()` index for a profile week-start value. Sunday is 0. */
export function weekStartIndex(weekStartsOn: Schemas['WeekDay']): number {
  return WEEK_START_INDEX[weekStartsOn]
}

/** One cell in the month grid. Leading and trailing days belong to other months. */
export interface CalendarDay {
  /** Civil date, `YYYY-MM-DD`. */
  date: string
  /** Day of month, 1–31. */
  day: number
  /** Whether the day belongs to the month being shown. */
  inMonth: boolean
}

/** Hike is its own mark; the shared map uses the same footprints as a walk. */
const HIKE_ACTIVITY_TYPE = 12

/**
 * Icon for a calendar day. A hike uses a mountain so it does not look like a walk.
 *
 * @param type - Numeric activity type.
 * @returns The icon component.
 */
export function calendarActivityIcon(type: number): LucideIcon {
  if (type === HIKE_ACTIVITY_TYPE) {
    return Mountain
  }
  return activityTypeIcon(type)
}

/**
 * Civil date of an activity in the timezone it was recorded in.
 *
 * @param startTime - UTC instant (ISO 8601).
 * @param timeZone - IANA zone, or `null` to use the runtime zone.
 * @returns `YYYY-MM-DD`, or `null` when the instant cannot be read.
 */
export function activityLocalDate(startTime: string, timeZone: string | null): string | null {
  const instant = new Date(startTime)
  if (Number.isNaN(instant.getTime())) {
    return null
  }
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }
  if (timeZone) {
    options.timeZone = timeZone
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(instant)
    const year = parts.find((part) => part.type === 'year')?.value
    const month = parts.find((part) => part.type === 'month')?.value
    const day = parts.find((part) => part.type === 'day')?.value
    if (!year || !month || !day) {
      return null
    }
    return `${year}-${month}-${day}`
  } catch {
    return null
  }
}

/** Pads a UTC date's calendar fields to `YYYY-MM-DD`. */
function isoUtc(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Builds a month grid, including the neighbouring days that fill the first and
 * last weeks. The first column follows the profile's first day of the week.
 *
 * @param year - Full year.
 * @param monthIndex - Month index, 0 = January.
 * @param weekStartsOn - Profile first weekday. Defaults to Monday.
 * @returns The cells, always a multiple of 7.
 */
export function monthGrid(
  year: number,
  monthIndex: number,
  weekStartsOn: Schemas['WeekDay'] = 'monday',
): CalendarDay[] {
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay()
  const offset = (firstWeekday - WEEK_START_INDEX[weekStartsOn] + 7) % 7
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  const daysInPrevious = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate()
  const cells: CalendarDay[] = []

  for (let index = offset; index > 0; index -= 1) {
    const day = daysInPrevious - index + 1
    cells.push({
      date: isoUtc(new Date(Date.UTC(year, monthIndex - 1, day))),
      day,
      inMonth: false,
    })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      date: isoUtc(new Date(Date.UTC(year, monthIndex, day))),
      day,
      inMonth: true,
    })
  }
  let trailing = 1
  while (cells.length % 7 !== 0) {
    cells.push({
      date: isoUtc(new Date(Date.UTC(year, monthIndex + 1, trailing))),
      day: trailing,
      inMonth: false,
    })
    trailing += 1
  }
  return cells
}

/**
 * Steps a year/month cursor by whole months.
 *
 * @param year - Full year.
 * @param monthIndex - Month index, 0 = January.
 * @param delta - Months to add (negative steps backward).
 * @returns The resulting year and month index.
 */
export function shiftMonth(
  year: number,
  monthIndex: number,
  delta: number,
): { year: number; monthIndex: number } {
  const next = new Date(Date.UTC(year, monthIndex + delta, 1))
  return { year: next.getUTCFullYear(), monthIndex: next.getUTCMonth() }
}
