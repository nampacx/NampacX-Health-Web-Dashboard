import { describe, expect, it } from 'vitest'
import {
  dateKey,
  hasAnyMetric,
  metricsForNight,
  nightMetricsByDate,
  parseDateKey,
} from './sleepMetrics'
import type { DataTypeDef, HealthRecord } from './types'

function typeDef(id: string): DataTypeDef {
  return { id, label: id, category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' }
}

function record(id: string, payload: unknown, timestamp: Date | null = null): HealthRecord {
  return {
    key: `${id}:1`,
    dataType: typeDef(id),
    timestamp,
    summary: null,
    details: [],
    source: null,
    // The payload sits under a camelCase key named after the data type.
    raw: { name: `${id}:1`, [id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())]: payload },
  }
}

const HRV_PAYLOAD = {
  date: { year: 2026, month: 8, day: 17 },
  averageHeartRateVariabilityMilliseconds: 42.5,
  nonRemHeartRateBeatsPerMinute: '54',
  entropy: 2.1,
  deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds: 61.2,
}

describe('parseDateKey', () => {
  it('reads google.type.Date, zero-padding month and day', () => {
    expect(parseDateKey({ year: 2026, month: 8, day: 7 })).toBe('2026-08-07')
  })

  it('reads a plain date string too', () => {
    expect(parseDateKey('2026-08-17')).toBe('2026-08-17')
    expect(parseDateKey('2026-08-17T06:00:00Z')).toBe('2026-08-17')
  })

  it('returns null for anything else', () => {
    expect(parseDateKey({ year: 2026 })).toBeNull()
    expect(parseDateKey(undefined)).toBeNull()
  })
})

describe('nightMetricsByDate', () => {
  it('pulls the sleeping HRV and sleeping heart rate off one daily record', () => {
    const byDate = nightMetricsByDate([record('daily-heart-rate-variability', HRV_PAYLOAD)])
    const metrics = byDate.get('2026-08-17')
    expect(metrics?.deepSleepHrvMs).toBe(61.2)
    expect(metrics?.nonRemHeartRateBpm).toBe(54) // int64 arrives as a string
    expect(metrics?.averageHrvMs).toBe(42.5)
    expect(metrics?.entropy).toBe(2.1)
  })

  it('merges the three data types onto the same day', () => {
    const byDate = nightMetricsByDate([
      record('daily-heart-rate-variability', HRV_PAYLOAD),
      record('daily-resting-heart-rate', { date: '2026-08-17', beatsPerMinute: 58 }),
      record('respiratory-rate-sleep-summary', {
        date: { year: 2026, month: 8, day: 17 },
        respiratoryRateSleepSummaryStatistics: [{ averageBreathsPerMinute: 14.2 }],
      }),
    ])
    const metrics = byDate.get('2026-08-17')
    expect(metrics?.deepSleepHrvMs).toBe(61.2)
    expect(metrics?.restingHeartRateBpm).toBe(58)
    expect(metrics?.breathsPerMinute).toBe(14.2)
  })

  it('ignores records that are not sleep metrics', () => {
    const byDate = nightMetricsByDate([record('steps', { date: '2026-08-17', steps: 9000 })])
    expect(byDate.size).toBe(0)
  })

  // Records arrive newest-first, so the first value seen is the current one.
  it('keeps the first value when a day has two records', () => {
    const byDate = nightMetricsByDate([
      record('daily-resting-heart-rate', { date: '2026-08-17', beatsPerMinute: 58 }),
      record('daily-resting-heart-rate', { date: '2026-08-17', beatsPerMinute: 61 }),
    ])
    expect(byDate.get('2026-08-17')?.restingHeartRateBpm).toBe(58)
  })

  it('falls back to the record timestamp when the payload has no date', () => {
    const at = new Date(2026, 7, 17, 6, 0)
    const withoutDate = record('daily-resting-heart-rate', { date: null, beatsPerMinute: 58 }, at)
    expect(nightMetricsByDate([withoutDate]).get(dateKey(at))?.restingHeartRateBpm).toBe(58)
  })
})

// Instants are UTC with an explicit offset rather than local Dates, so these
// assertions mean the same thing on a CI runner in any zone.
describe('metricsForNight', () => {
  const byDate = nightMetricsByDate([record('daily-heart-rate-variability', HRV_PAYLOAD)])
  const OFFSET = 7200 // +02:00, as on the captured fixture night

  // The load-bearing one: a night starting on the 16th is the 17th's reading.
  it('keys on the morning the night ended, not the evening it began', () => {
    const night = {
      start: new Date(Date.UTC(2026, 7, 16, 20, 18)), // 22:18 local
      end: new Date(Date.UTC(2026, 7, 17, 4, 16)), //  06:16 local
      utcOffsetSeconds: OFFSET,
    }
    expect(metricsForNight(byDate, night)?.deepSleepHrvMs).toBe(61.2)
  })

  // The offset is not cosmetic here: 23:30Z has already rolled over to the 18th
  // in UTC while it is still 01:30 on the 18th locally... and 22:30Z on the 16th
  // is already the 17th at +02:00, which is the day the metrics are filed under.
  it('resolves the calendar day in the recording zone, not in UTC', () => {
    const night = { start: null, end: new Date(Date.UTC(2026, 7, 16, 22, 30)), utcOffsetSeconds: OFFSET }
    expect(metricsForNight(byDate, night)?.deepSleepHrvMs).toBe(61.2)
    // Same instant read as UTC would land on the 16th, which has no record.
    expect(metricsForNight(byDate, { ...night, utcOffsetSeconds: 0 })).toBeNull()
  })

  it('falls back to the start when a session has no end', () => {
    const night = { start: new Date(Date.UTC(2026, 7, 17, 1, 0)), end: null, utcOffsetSeconds: OFFSET }
    expect(metricsForNight(byDate, night)?.deepSleepHrvMs).toBe(61.2)
  })

  it('returns null when the night has no dates at all', () => {
    expect(metricsForNight(byDate, { start: null, end: null })).toBeNull()
  })

  it('returns null for a night with no matching day', () => {
    const night = { start: null, end: new Date(Date.UTC(2026, 7, 1, 7, 0)), utcOffsetSeconds: OFFSET }
    expect(metricsForNight(byDate, night)).toBeNull()
  })
})

describe('hasAnyMetric', () => {
  it('is false for null and for an all-empty day', () => {
    expect(hasAnyMetric(null)).toBe(false)
    const empty = nightMetricsByDate([
      record('daily-resting-heart-rate', { date: '2026-08-17', beatsPerMinute: null }),
    ])
    expect(hasAnyMetric(empty.get('2026-08-17') ?? null)).toBe(false)
  })

  it('is true as soon as one slot is filled', () => {
    const byDate = nightMetricsByDate([record('daily-heart-rate-variability', HRV_PAYLOAD)])
    expect(hasAnyMetric(byDate.get('2026-08-17') ?? null)).toBe(true)
  })
})
