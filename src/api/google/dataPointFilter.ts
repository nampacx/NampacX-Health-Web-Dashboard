/**
 * Builds the `filter` expression for `dataPoints.list`.
 *
 * This is its own module because the grammar is **not** uniform across data
 * types, and assuming it was cost the time range its effect on most of the
 * dashboard. `dataPoints.list` documents five different time fields and picks
 * between them by the data type's *record type*, plus two per-type exceptions:
 *
 * | Record type | Field |
 * | --- | --- |
 * | Interval | `{type}.interval.civil_start_time` |
 * | Sample | `{type}.sample_time.civil_time` |
 * | Daily | `{type}.date` — **date only**, no time part |
 * | Session | `{type}.interval.civil_start_time` — *excluding sleep and ECG* |
 * | Food | nothing filterable |
 *
 * - **Sleep filters on the *end* time**, `sleep.interval.civil_end_time`. The
 *   session start-time pattern is documented as explicitly excluding it. This is
 *   not an inconsistency to work around — a night belongs to the morning it ended
 *   on, which is the same rule `sleepMetrics.ts` keys daily metrics by.
 * - **ECG takes a physical RFC-3339 timestamp** and supports `>=` only.
 *
 * A wrong field is not a soft failure: the API rejects the request with a 400,
 * and `healthApi.ts` then retries unfiltered, so the type quietly returns its
 * newest N rows as though no time range had been asked for. That is what used to
 * happen to every sample, daily and sleep type here.
 */

import type { DataTypeDef } from './types'

/**
 * How the data type is spelled in a filter expression.
 *
 * The reference does not say, and its examples do not settle it: every one of
 * them is a single-word type (`steps`, `weight`, `exercise`, `sleep`) where the
 * two spellings are identical — except the single multi-word example,
 * `dailyHeartRateVariability.date`, which is camelCase. That is one data point
 * against a grammar whose *field* names (`civil_start_time`, `sample_time`) are
 * plainly snake_case, so it is suggestive rather than conclusive.
 *
 * Rather than bet the time range on reading tea leaves, `healthApi.ts` tries both
 * and remembers which one the API accepted. See `nextDialect` there.
 */
export type FilterDialect = 'camel' | 'snake'

/** `daily-resting-heart-rate` -> `dailyRestingHeartRate` */
function toCamelCase(dataTypeId: string): string {
  return dataTypeId.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

/** `daily-resting-heart-rate` -> `daily_resting_heart_rate` */
function toSnakeCase(dataTypeId: string): string {
  return dataTypeId.replace(/-/g, '_')
}

export function dataTypeToken(dataTypeId: string, dialect: FilterDialect): string {
  return dialect === 'camel' ? toCamelCase(dataTypeId) : toSnakeCase(dataTypeId)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `2026-08-11` — the local calendar day, for the date-only daily filter. */
function toCivilDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `2026-08-11T22:30:00` — a civil timestamp, which carries no zone by design. */
function toCivilDateTime(date: Date): string {
  return (
    `${toCivilDate(date)}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

interface TimeField {
  /** Path after the data type token, e.g. `interval.civil_start_time`. */
  path: string
  format: (date: Date) => string
}

/**
 * The lower-bound time field for a data type, or null when it has none.
 *
 * Food types (`food`, `food-measurement-unit`) are a reference table rather than
 * observations — they carry no time at all and the grammar lists no field for
 * them, so they are filtered client-side or not at all.
 */
export function timeFieldFor(dataType: DataTypeDef): TimeField | null {
  // Two per-type exceptions the record type cannot express.
  if (dataType.id === 'sleep') {
    return { path: 'interval.civil_end_time', format: toCivilDateTime }
  }
  if (dataType.id === 'electrocardiogram') {
    return { path: 'interval.start_time', format: (date) => date.toISOString() }
  }

  switch (dataType.recordType) {
    case 'interval':
    case 'session':
      return { path: 'interval.civil_start_time', format: toCivilDateTime }
    case 'sample':
      return { path: 'sample_time.civil_time', format: toCivilDateTime }
    case 'daily':
      // Date literal only: a time part is rejected.
      return { path: 'date', format: toCivilDate }
    case 'food':
      return null
  }
}

/**
 * The `filter` value asking for everything at or after `since`, or null when the
 * data type has no time field to filter on.
 */
export function timeFilter(
  dataType: DataTypeDef,
  since: Date,
  dialect: FilterDialect,
): string | null {
  const field = timeFieldFor(dataType)
  if (!field) return null
  const token = dataTypeToken(dataType.id, dialect)
  return `${token}.${field.path} >= "${field.format(since)}"`
}
