/**
 * The overnight cardio numbers that sit alongside a night's stages.
 *
 * Worth knowing before reading this: **you do not have to intersect raw HRV
 * samples with the sleep interval yourself.** `daily-heart-rate-variability`
 * is already computed over the night, and carries both halves of the usual
 * question in one record:
 *
 *   deepSleepRootMeanSquare…Milliseconds  HRV (RMSSD) during deep sleep
 *   nonRemHeartRateBeatsPerMinute         heart rate during non-REM sleep
 *
 * so "HRV and resting heart rate while asleep" is a field read, not a join.
 * `daily-resting-heart-rate` is kept beside them as the whole-day baseline the
 * sleeping numbers are interesting *relative to*.
 */

import type { HealthRecord } from './types'

export interface NightMetrics {
  /** Local calendar day the record is filed under, as `YYYY-MM-DD`. */
  date: string
  /** RMSSD during deep sleep, ms — the "HRV while sleeping" number. */
  deepSleepHrvMs: number | null
  /** Daily average HRV, ms. */
  averageHrvMs: number | null
  /** Heart rate during non-REM sleep, bpm — the "RHR while sleeping" number. */
  nonRemHeartRateBpm: number | null
  /** Whole-day resting heart rate, bpm. The daytime baseline. */
  restingHeartRateBpm: number | null
  /** Sleep-window respiratory rate, breaths/min. */
  breathsPerMinute: number | null
  /** HRV entropy, unitless. Google exposes it; it has no documented scale. */
  entropy: number | null
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** int64 fields arrive as JSON strings, so numeric strings count as numbers. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value)
  return null
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * `google.type.Date` serialises as `{year, month, day}`, but daily payloads
 * have also been seen carrying a plain `YYYY-MM-DD` string. Both are accepted
 * rather than betting on one — the cost of guessing wrong is every metric
 * silently failing to line up with its night.
 */
export function parseDateKey(value: unknown): string | null {
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
    return match ? `${match[1]}-${match[2]}-${match[3]}` : null
  }
  if (isObject(value)) {
    const year = asNumber(value.year)
    const month = asNumber(value.month)
    const day = asNumber(value.day)
    if (year === null || month === null || day === null) return null
    return `${year}-${pad(month)}-${pad(day)}`
  }
  return null
}

function emptyMetrics(date: string): NightMetrics {
  return {
    date,
    deepSleepHrvMs: null,
    averageHrvMs: null,
    nonRemHeartRateBpm: null,
    restingHeartRateBpm: null,
    breathsPerMinute: null,
    entropy: null,
  }
}

/** First non-null `averageBreathsPerMinute` in the statistics array. */
function firstBreathRate(value: unknown): number | null {
  if (!Array.isArray(value)) return null
  for (const entry of value) {
    if (!isObject(entry)) continue
    const rate = asNumber(entry.averageBreathsPerMinute)
    if (rate !== null) return rate
  }
  return null
}

/** Every slot but `date`, all of which are `number | null`. */
type MetricKey = Exclude<keyof NightMetrics, 'date'>

/** Only overwrite a slot that is still empty, so the newest record wins. */
function fill(target: NightMetrics, key: MetricKey, value: number | null): void {
  if (value === null) return
  if (target[key] === null) target[key] = value
}

/**
 * Indexes the daily records by calendar day. Records arrive newest-first from
 * healthApi, and each slot keeps the first value it sees, so a day with two
 * records resolves to the more recent one.
 */
export function nightMetricsByDate(records: HealthRecord[]): Map<string, NightMetrics> {
  const byDate = new Map<string, NightMetrics>()

  const forDate = (date: string): NightMetrics => {
    const existing = byDate.get(date)
    if (existing) return existing
    const created = emptyMetrics(date)
    byDate.set(date, created)
    return created
  }

  for (const record of records) {
    const id = record.dataType.id
    if (
      id !== 'daily-heart-rate-variability' &&
      id !== 'daily-resting-heart-rate' &&
      id !== 'respiratory-rate-sleep-summary'
    ) {
      continue
    }

    // The payload sits under a camelCase key named after the data type; fall
    // back to the record's own timestamp when the payload has no date field.
    const payload = Object.values(record.raw).find(
      (value): value is Json => isObject(value) && 'date' in value,
    )
    const date =
      parseDateKey(payload?.date) ?? (record.timestamp ? dateKey(record.timestamp) : null)
    if (!date || !payload) continue

    const metrics = forDate(date)

    if (id === 'daily-heart-rate-variability') {
      fill(
        metrics,
        'deepSleepHrvMs',
        asNumber(payload.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds),
      )
      fill(metrics, 'averageHrvMs', asNumber(payload.averageHeartRateVariabilityMilliseconds))
      fill(metrics, 'nonRemHeartRateBpm', asNumber(payload.nonRemHeartRateBeatsPerMinute))
      fill(metrics, 'entropy', asNumber(payload.entropy))
    } else if (id === 'daily-resting-heart-rate') {
      fill(metrics, 'restingHeartRateBpm', asNumber(payload.beatsPerMinute))
    } else {
      fill(
        metrics,
        'breathsPerMinute',
        firstBreathRate(payload.respiratoryRateSleepSummaryStatistics),
      )
    }
  }

  return byDate
}

/**
 * The metrics belonging to a night, or null.
 *
 * Keyed on the morning the session *ended*, which is how Google files a daily
 * record — a night starting 23:40 on the 16th and ending 07:10 on the 17th is
 * the 17th's HRV reading, not the 16th's. Falling back to the start date would
 * silently pair every night with the wrong day's numbers.
 */
export function metricsForNight(
  byDate: Map<string, NightMetrics>,
  night: { start: Date | null; end: Date | null },
): NightMetrics | null {
  const anchor = night.end ?? night.start
  return anchor ? (byDate.get(dateKey(anchor)) ?? null) : null
}

/** True when nothing in the record set filled a single slot. */
export function hasAnyMetric(metrics: NightMetrics | null): boolean {
  if (!metrics) return false
  return (
    metrics.deepSleepHrvMs !== null ||
    metrics.averageHrvMs !== null ||
    metrics.nonRemHeartRateBpm !== null ||
    metrics.restingHeartRateBpm !== null ||
    metrics.breathsPerMinute !== null ||
    metrics.entropy !== null
  )
}
