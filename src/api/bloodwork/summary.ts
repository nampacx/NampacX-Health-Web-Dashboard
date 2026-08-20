import type { BloodworkResultRow, BloodworkResultsByDate } from './types'

export interface BloodworkSummaryRow {
  /** Groups by `analyse`, the row's stable identity across documents -- not
   * `bezeichnung`, which is the lab's own label and can vary between reports
   * for the same analyte. */
  analyse: string
  label: string
  lastTested: string
  row: BloodworkResultRow
}

/**
 * One row per analyte, holding only its most recently reported measurement.
 * Report dates are ISO YYYY-MM-DD, so a plain string comparison is also a
 * chronological one -- no Date parsing needed to find the latest.
 */
export function buildSummaryRows(resultsByDate: BloodworkResultsByDate): BloodworkSummaryRow[] {
  const latest = new Map<string, { date: string; row: BloodworkResultRow }>()

  for (const [date, rows] of Object.entries(resultsByDate)) {
    for (const row of rows) {
      const existing = latest.get(row.analyse)
      if (!existing || date > existing.date) {
        latest.set(row.analyse, { date, row })
      }
    }
  }

  return [...latest.entries()]
    .map(([analyse, { date, row }]) => ({
      analyse,
      label: row.bezeichnung || row.analyse,
      lastTested: date,
      row,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
