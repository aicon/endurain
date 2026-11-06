import { Mountain } from '@lucide/vue'
import { describe, expect, it } from 'vitest'

import { activityTypeIcon } from '@/features/activities/utils/activityType'
import {
  activityLocalDate,
  calendarActivityIcon,
  monthGrid,
  shiftMonth,
} from '@/features/home/utils/activityCalendar'

describe('monthGrid', () => {
  it('starts November 2026 on Monday by default', () => {
    const cells = monthGrid(2026, 10)

    expect(cells[0]).toEqual({ date: '2026-10-26', day: 26, inMonth: false })
    expect(cells[6]).toEqual({ date: '2026-11-01', day: 1, inMonth: true })
    expect(cells[cells.length - 1]?.date).toBe('2026-12-06')
    expect(cells.length % 7).toBe(0)
  })

  it('starts November 2026 on Sunday when that is the profile week start', () => {
    const cells = monthGrid(2026, 10, 'sunday')

    expect(cells).toHaveLength(35)
    expect(cells[0]).toEqual({ date: '2026-11-01', day: 1, inMonth: true })
    expect(cells[5]).toEqual({ date: '2026-11-06', day: 6, inMonth: true })
    expect(cells[cells.length - 1]?.date).toBe('2026-12-05')
  })

  it('prefixes the previous month when the first day is not the week start', () => {
    const cells = monthGrid(2026, 9)

    expect(cells[0]).toEqual({ date: '2026-09-28', day: 28, inMonth: false })
    expect(cells.find((cell) => cell.inMonth)?.date).toBe('2026-10-01')
  })
})

describe('shiftMonth', () => {
  it('steps across the year boundary', () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, monthIndex: 11 })
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, monthIndex: 0 })
  })
})

describe('activityLocalDate', () => {
  it('uses the activity timezone, not UTC', () => {
    expect(activityLocalDate('2026-11-06T23:30:00Z', 'Europe/Budapest')).toBe('2026-11-07')
    expect(activityLocalDate('2026-11-06T23:30:00Z', 'UTC')).toBe('2026-11-06')
  })

  it('returns null for an unreadable instant', () => {
    expect(activityLocalDate('not-a-date', 'UTC')).toBeNull()
  })
})

describe('calendarActivityIcon', () => {
  it('gives a hike its own mountain and keeps the shared icons otherwise', () => {
    expect(calendarActivityIcon(12)).toBe(Mountain)
    expect(calendarActivityIcon(11)).toBe(activityTypeIcon(11))
    expect(calendarActivityIcon(4)).toBe(activityTypeIcon(4))
  })
})
