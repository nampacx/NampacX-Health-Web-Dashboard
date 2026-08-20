import type { BloodworkResultRow, BloodworkResultsByDate } from './types'

export interface AnalyteHistoryEntry {
  date: string
  row: BloodworkResultRow
}

/**
 * Every recorded value for one analyte, oldest first -- the order the chart
 * wants, and report dates are ISO YYYY-MM-DD so a plain string sort is also a
 * chronological one.
 */
export function buildAnalyteHistory(
  resultsByDate: BloodworkResultsByDate,
  analyse: string,
): AnalyteHistoryEntry[] {
  const entries: AnalyteHistoryEntry[] = []
  for (const [date, rows] of Object.entries(resultsByDate)) {
    for (const row of rows) {
      if (row.analyse === analyse) entries.push({ date, row })
    }
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Ergebniswert is a German-formatted decimal ("4,70") -- `Number` alone stops
 * at the comma and silently returns 4. Returns null for anything that isn't a
 * plain number (a text result, a missing value) so the chart can skip it
 * rather than plot a wrong point.
 */
export function parseAnalyteValue(ergebniswert: string): number | null {
  const normalized = ergebniswert.trim().replace(',', '.')
  if (normalized === '') return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

/** Parses a report date (YYYY-MM-DD) as UTC midnight, paired with `formatReportDate`
 * below so the label always matches the stored date regardless of the viewer's zone. */
export function reportDateToUtcDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

const reportDateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })

/** Formats a UTC-midnight report date. Pinned to `timeZone: 'UTC'` against a
 * UTC-constructed instant, the same trick `profile.ts`'s `formatCivilDate`
 * uses, so a viewer west of UTC doesn't see the day before. */
export function formatReportDate(at: Date): string {
  return reportDateFormat.format(at)
}

/**
 * Highest number of fractional digits seen across a set of Ergebniswert
 * strings, capped at 2. There's no per-analyte precision catalog the way the
 * Withings measure types have one, so the observed data is the only signal --
 * an analyte that has only ever been reported as whole numbers charts and
 * tabulates as one, instead of a hardcoded decimal count padding "539" out to
 * "539.00".
 */
export function inferDecimals(values: string[]): number {
  let max = 0
  for (const value of values) {
    const normalized = value.trim().replace(',', '.')
    const dot = normalized.indexOf('.')
    if (dot === -1) continue
    max = Math.max(max, normalized.length - dot - 1)
  }
  return Math.min(max, 2)
}
