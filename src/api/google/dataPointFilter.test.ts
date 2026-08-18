import { describe, expect, it } from 'vitest'
import { DATA_TYPES, DATA_TYPES_BY_ID } from './dataTypes'
import { dataTypeToken, timeFieldFor, timeFilter } from './dataPointFilter'
import type { DataTypeDef } from './types'

const SINCE = new Date(2026, 7, 11, 22, 30, 0) // local: 2026-08-11T22:30:00

function typeById(id: string): DataTypeDef {
  const dataType = DATA_TYPES_BY_ID.get(id)
  if (!dataType) throw new Error(`no such data type: ${id}`)
  return dataType
}

describe('dataTypeToken', () => {
  it('spells the data type both ways', () => {
    expect(dataTypeToken('daily-heart-rate-variability', 'camel')).toBe('dailyHeartRateVariability')
    expect(dataTypeToken('daily-heart-rate-variability', 'snake')).toBe(
      'daily_heart_rate_variability',
    )
  })

  it('is identical for the single-word types the reference uses as examples', () => {
    for (const id of ['steps', 'weight', 'sleep', 'exercise']) {
      expect(dataTypeToken(id, 'camel')).toBe(dataTypeToken(id, 'snake'))
    }
  })
})

/**
 * The field is chosen by record type, and getting it wrong is not a soft
 * failure: the API 400s and `healthApi.ts` retries unfiltered, so the data type
 * silently returns its newest rows as though no range had been asked for.
 */
describe('timeFieldFor', () => {
  it('filters interval and session types on the interval start', () => {
    expect(timeFieldFor(typeById('steps'))?.path).toBe('interval.civil_start_time')
    expect(timeFieldFor(typeById('exercise'))?.path).toBe('interval.civil_start_time')
  })

  it('filters sample types on the sample time', () => {
    expect(timeFieldFor(typeById('weight'))?.path).toBe('sample_time.civil_time')
    expect(timeFieldFor(typeById('heart-rate'))?.path).toBe('sample_time.civil_time')
  })

  it('filters daily types on the bare date', () => {
    expect(timeFieldFor(typeById('daily-heart-rate-variability'))?.path).toBe('date')
    expect(timeFieldFor(typeById('daily-resting-heart-rate'))?.path).toBe('date')
  })

  /**
   * The whole reason this module exists. The session start-time pattern is
   * documented as excluding sleep, which has its own *end*-time field -- and that
   * is not an inconsistency to route around: a night belongs to the morning it
   * ended on, the same rule sleepMetrics.ts keys daily metrics by.
   */
  it('filters sleep on the interval END, never the start', () => {
    expect(timeFieldFor(typeById('sleep'))?.path).toBe('interval.civil_end_time')
  })

  it('filters ECG on a physical start time', () => {
    expect(timeFieldFor(typeById('electrocardiogram'))?.path).toBe('interval.start_time')
  })

  // Food types are a reference table, not observations -- no time to filter on.
  it('has no field for the food types', () => {
    expect(timeFieldFor(typeById('food'))).toBeNull()
    expect(timeFieldFor(typeById('food-measurement-unit'))).toBeNull()
  })

  it('covers every catalogued data type without throwing', () => {
    for (const dataType of DATA_TYPES) {
      expect(() => timeFieldFor(dataType), dataType.id).not.toThrow()
    }
  })
})

describe('timeFilter', () => {
  it('builds a civil timestamp for interval types', () => {
    expect(timeFilter(typeById('steps'), SINCE, 'snake')).toBe(
      'steps.interval.civil_start_time >= "2026-08-11T22:30:00"',
    )
  })

  it('builds an end-time filter for sleep', () => {
    expect(timeFilter(typeById('sleep'), SINCE, 'snake')).toBe(
      'sleep.interval.civil_end_time >= "2026-08-11T22:30:00"',
    )
  })

  // The daily grammar takes a date literal; a time part is rejected.
  it('builds a date-only filter for daily types, in both spellings', () => {
    expect(timeFilter(typeById('daily-resting-heart-rate'), SINCE, 'camel')).toBe(
      'dailyRestingHeartRate.date >= "2026-08-11"',
    )
    expect(timeFilter(typeById('daily-resting-heart-rate'), SINCE, 'snake')).toBe(
      'daily_resting_heart_rate.date >= "2026-08-11"',
    )
  })

  // ECG wants RFC-3339 physical time, not a civil one.
  it('builds an RFC-3339 filter for ECG', () => {
    expect(timeFilter(typeById('electrocardiogram'), SINCE, 'snake')).toContain(
      SINCE.toISOString(),
    )
  })

  it('returns null where there is nothing to filter on', () => {
    expect(timeFilter(typeById('food'), SINCE, 'snake')).toBeNull()
  })

  // A civil timestamp carries no zone by design, so a trailing Z would be a lie
  // about which clock the bound is expressed in.
  it('never puts a zone on a civil timestamp', () => {
    for (const id of ['steps', 'sleep', 'weight', 'daily-resting-heart-rate']) {
      expect(timeFilter(typeById(id), SINCE, 'snake')).not.toContain('Z"')
    }
  })
})
