import type { MeasureGroup } from './types'

/** One plotted observation. */
export interface SeriesPoint {
  at: Date
  value: number
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
export function toSeries(groups: MeasureGroup[], type: number): SeriesPoint[] {
  const points: SeriesPoint[] = []

  for (const group of groups) {
    const measure = group.measures.find((candidate) => candidate.type === type)
    if (!measure) continue
    points.push({ at: group.date, value: measure.value })
  }

  return points.sort((a, b) => a.at.getTime() - b.at.getTime())
}
