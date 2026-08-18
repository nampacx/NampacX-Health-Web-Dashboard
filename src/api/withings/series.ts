import type { MeasureGroup } from './types'

/** One plotted observation. */
export interface SeriesPoint {
  at: Date
  value: number
}

export type SeriesGranularity = 'day' | 'week'

interface CalendarWeek {
  year: number
  week: number
  start: Date
}

/** ISO-8601 week from the date's local civil day (Monday-first). */
function calendarWeek(date: Date): CalendarWeek {
  const civilUtc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const isoDay = civilUtc.getUTCDay() || 7 // Sunday(0) -> 7

  const start = new Date(civilUtc)
  start.setUTCDate(civilUtc.getUTCDate() - isoDay + 1)

  const thursday = new Date(civilUtc)
  thursday.setUTCDate(civilUtc.getUTCDate() + 4 - isoDay)
  const weekYear = thursday.getUTCFullYear()
  const yearStart = new Date(Date.UTC(weekYear, 0, 1))
  const week = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7)

  return { year: weekYear, week, start }
}

export function calendarWeekLabel(date: Date): string {
  const { year, week } = calendarWeek(date)
  return `CW ${week}/${year}`
}

/**
 * Pulls a single measure type out of the weigh-in groups as a time series,
 * **oldest first** — charts read left to right, while the API, the card list
 * and `normalizeGetMeasResponse` are all newest-first.
 *
 * Groups missing the type are skipped rather than plotted as zero: a scale that
 * reported weight but not fat ratio should leave a gap in the fat chart, not a
 * dive to the axis.
 */
export function toSeries(
  groups: MeasureGroup[],
  type: number,
  granularity: SeriesGranularity = 'day',
): SeriesPoint[] {
  const points: SeriesPoint[] = []

  for (const group of groups) {
    const measure = group.measures.find((candidate) => candidate.type === type)
    if (!measure) continue
    points.push({ at: group.date, value: measure.value })
  }

  const dailyPoints = points.sort((a, b) => a.at.getTime() - b.at.getTime())
  if (granularity === 'day') return dailyPoints

  const buckets = new Map<string, { at: Date; sum: number; count: number }>()
  for (const point of dailyPoints) {
    const { year, week, start } = calendarWeek(point.at)
    const key = `${year}-W${week}`
    const current = buckets.get(key)
    if (!current) {
      buckets.set(key, { at: start, sum: point.value, count: 1 })
      continue
    }
    current.sum += point.value
    current.count += 1
  }

  return Array.from(buckets.values())
    .map((bucket) => ({ at: bucket.at, value: bucket.sum / bucket.count }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
}
