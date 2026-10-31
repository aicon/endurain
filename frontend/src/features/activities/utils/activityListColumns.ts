import type { FormattedMetric } from './format'

/** The headline metric columns shown in the activities list, including the
 * two sort-only columns (calories, avg HR) that are appended when the list is
 * actively sorted by one of them. */
export type ActivityMetricKey =
  'distance' | 'duration' | 'paceSpeed' | 'elevation' | 'calories' | 'avgHr'

/** A headline metric column definition for the activities list. */
export interface ActivityMetricColumn {
  /** Stable key, used to look up the row's formatted value. */
  key: ActivityMetricKey
  /** i18n key for the column header label. */
  labelKey: string
  /**
   * Shared alignment + responsive-visibility classes. The SAME class string is
   * applied to the column header cell (in `ActivitiesView`) and to every row's
   * value cell (in `ActivityListItem`) so the columns line up; keep the two
   * call sites in sync via this single source. Metric columns size to the
   * header text (`whitespace-nowrap`, no fixed width).
   */
  cellClass: string
}

/**
 * The activities-list metric columns, in display order. Distance and duration
 * are always visible (from the `sm` breakpoint up); pace/speed appears from
 * `md` and elevation from `lg`, so narrower panels progressively drop the
 * least-critical columns without shifting the rest.
 */
export const ACTIVITY_METRIC_COLUMNS: readonly ActivityMetricColumn[] = [
  {
    key: 'distance',
    labelKey: 'activities.list.columns.distance',
    cellClass: 'hidden text-right whitespace-nowrap sm:table-cell',
  },
  {
    key: 'duration',
    labelKey: 'activities.list.columns.duration',
    cellClass: 'hidden text-right whitespace-nowrap sm:table-cell',
  },
  {
    key: 'paceSpeed',
    labelKey: 'activities.list.columns.paceSpeed',
    cellClass: 'hidden text-right whitespace-nowrap md:table-cell',
  },
  {
    key: 'elevation',
    labelKey: 'activities.list.columns.elevation',
    cellClass: 'hidden text-right whitespace-nowrap lg:table-cell',
  },
]

/**
 * Extra columns that aren't part of the default headline set but that the
 * list can be sorted by (calories, avg HR). Neither is shown by default, so
 * sorting by one added no visible column and the sort appeared to do nothing
 * (see issue #778); `sortByToExtraColumn` appends the matching column so its
 * values are visible while that sort is active.
 */
export const ACTIVITY_EXTRA_COLUMNS: Readonly<
  Record<'calories' | 'average_hr', ActivityMetricColumn>
> = {
  calories: {
    key: 'calories',
    labelKey: 'activities.list.columns.calories',
    cellClass: 'hidden text-right whitespace-nowrap sm:table-cell',
  },
  average_hr: {
    key: 'avgHr',
    labelKey: 'activities.list.columns.avgHr',
    cellClass: 'hidden text-right whitespace-nowrap sm:table-cell',
  },
}

/**
 * Resolves the extra sort-only column (if any) for the given sort field.
 *
 * @param sortBy - The list's active sort field.
 * @returns The matching extra column, or `null` when sorting by a field that
 * already has a headline column (or doesn't have one at all).
 */
export function sortByToExtraColumn(sortBy: string): ActivityMetricColumn | null {
  return sortBy === 'calories' || sortBy === 'average_hr' ? ACTIVITY_EXTRA_COLUMNS[sortBy] : null
}

/** Placeholder metric for a column that does not apply to an activity. */
export const NA_METRIC: FormattedMetric = { value: '--', unit: '' }
