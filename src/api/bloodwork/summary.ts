import { analyteIdentity } from './analyteIdentity'
import type { BloodworkResultRow, BloodworkResultsByDate } from './types'

export interface BloodworkSummaryRow {
  /** Case-/whitespace-normalized display identity, see `analyteIdentity` --
   * not the raw `analyse` field, which can differ between report formats for
   * what is otherwise plainly the same test. */
  identity: string
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
      const identity = analyteIdentity(row)
      const existing = latest.get(identity)
      if (!existing || date > existing.date) {
        latest.set(identity, { date, row })
      }
    }
  }

  return [...latest.entries()]
    .map(([identity, { date, row }]) => ({
      identity,
      label: row.bezeichnung || row.analyse,
      lastTested: date,
      row,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
