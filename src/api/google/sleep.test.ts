import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  parseDurationMs,
  parseSleepPayload,
  parseStageType,
  sleepNights,
  stageShare,
} from './sleep'
import type { DataTypeDef, HealthRecord } from './types'

const SLEEP_TYPE: DataTypeDef = {
  id: 'sleep',
  label: 'Sleep',
  category: 'Sleep',
  scope: 'sleep.readonly',
}

function stage(stageType: string, startIso: string, endIso: string) {
  return { stageType, startTime: startIso, endTime: endIso }
}

/** A night with 30 min awake, 1 h REM, 4 h light, 1 h 30 deep. */
const NIGHT = {
  startTime: '2026-08-16T23:00:00Z',
  endTime: '2026-08-17T06:00:00Z',
  sleepType: 'SLEEP',
  sleepStages: [
    stage('SLEEP_STAGE_LIGHT', '2026-08-16T23:00:00Z', '2026-08-17T01:00:00Z'),
    stage('SLEEP_STAGE_DEEP', '2026-08-17T01:00:00Z', '2026-08-17T02:30:00Z'),
    stage('SLEEP_STAGE_AWAKE', '2026-08-17T02:30:00Z', '2026-08-17T03:00:00Z'),
    stage('SLEEP_STAGE_REM', '2026-08-17T03:00:00Z', '2026-08-17T04:00:00Z'),
    stage('SLEEP_STAGE_LIGHT', '2026-08-17T04:00:00Z', '2026-08-17T06:00:00Z'),
  ],
  sleepMetadata: { stagesState: 'STAGES_AVAILABLE' },
}

const HOUR = 3_600_000

describe('parseStageType', () => {
  it('accepts the fully-qualified enum name', () => {
    expect(parseStageType('SLEEP_STAGE_DEEP')).toBe('deep')
    expect(parseStageType('SLEEP_STAGE_REM')).toBe('rem')
  })

  it('accepts the bare form seen on some payloads', () => {
    expect(parseStageType('AWAKE')).toBe('awake')
    expect(parseStageType('LIGHT')).toBe('light')
  })

  // Guessing at an unknown stage would put a wrong-coloured bar on the chart;
  // dropping it leaves an honest gap instead.
  it('drops an unspecified or unrecognised stage rather than guessing', () => {
    expect(parseStageType('SLEEP_STAGE_TYPE_UNSPECIFIED')).toBeNull()
    expect(parseStageType('SLEEP_STAGE_SOMETHING_NEW')).toBeNull()
    expect(parseStageType(undefined)).toBeNull()
  })
})

describe('parseDurationMs', () => {
  it('reads the protobuf duration string', () => {
    expect(parseDurationMs('1800s')).toBe(1_800_000)
    expect(parseDurationMs('1800.5s')).toBe(1_800_500)
  })

  it('returns 0 for anything it cannot read', () => {
    expect(parseDurationMs('1800')).toBe(0)
    expect(parseDurationMs(undefined)).toBe(0)
  })
})

describe('parseSleepPayload', () => {
  it('sums stage totals from the segments when no summary is present', () => {
    const night = parseSleepPayload(NIGHT, 'n1', NIGHT)
    expect(night.totals.light).toBe(4 * HOUR)
    expect(night.totals.deep).toBe(1.5 * HOUR)
    expect(night.totals.rem).toBe(1 * HOUR)
    expect(night.totals.awake).toBe(0.5 * HOUR)
  })

  it('counts only REM, light and deep as asleep', () => {
    const night = parseSleepPayload(NIGHT, 'n1', NIGHT)
    expect(night.timeAsleepMs).toBe(6.5 * HOUR)
    expect(night.timeInBedMs).toBe(7 * HOUR)
  })

  it('derives efficiency from asleep over in-bed', () => {
    const night = parseSleepPayload(NIGHT, 'n1', NIGHT)
    expect(night.efficiency).toBeCloseTo((6.5 / 7) * 100, 5)
  })

  // The API's own summary is what the Google Health app shows, so it wins.
  it('prefers sleepSummary totals over the segment sum', () => {
    const night = parseSleepPayload(
      {
        ...NIGHT,
        sleepSummary: {
          stageSummaries: [
            { stageType: 'SLEEP_STAGE_DEEP', duration: '7200s' },
            { stageType: 'SLEEP_STAGE_LIGHT', duration: '10800s' },
          ],
        },
      },
      'n1',
      {},
    )
    expect(night.totals.deep).toBe(2 * HOUR)
    expect(night.totals.light).toBe(3 * HOUR)
    // Not in the summary at all, so it is 0 rather than the segments' value.
    expect(night.totals.rem).toBe(0)
  })

  it('falls back to the segments when the summary has no usable entries', () => {
    const night = parseSleepPayload(
      { ...NIGHT, sleepSummary: { stageSummaries: [{ stageType: 'NONSENSE', duration: '60s' }] } },
      'n1',
      {},
    )
    expect(night.totals.light).toBe(4 * HOUR)
  })

  it('counts a full awakening only above five minutes', () => {
    const night = parseSleepPayload(
      {
        ...NIGHT,
        sleepStages: [
          stage('SLEEP_STAGE_AWAKE', '2026-08-17T01:00:00Z', '2026-08-17T01:02:00Z'), // 2 min
          stage('SLEEP_STAGE_AWAKE', '2026-08-17T02:00:00Z', '2026-08-17T02:20:00Z'), // 20 min
        ],
      },
      'n1',
      {},
    )
    expect(night.fullAwakenings).toBe(1)
  })

  it('reports stages unavailable when the device said so', () => {
    const night = parseSleepPayload(
      { ...NIGHT, sleepMetadata: { stagesState: 'STAGES_UNAVAILABLE' } },
      'n1',
      {},
    )
    expect(night.stagesAvailable).toBe(false)
  })

  it('reports stages unavailable when the array is empty', () => {
    const night = parseSleepPayload({ ...NIGHT, sleepStages: [] }, 'n1', {})
    expect(night.stagesAvailable).toBe(false)
    expect(night.timeInBedMs).toBe(7 * HOUR) // duration still known
  })

  it('drops zero-length and reversed segments', () => {
    const night = parseSleepPayload(
      {
        ...NIGHT,
        sleepStages: [
          stage('SLEEP_STAGE_DEEP', '2026-08-17T01:00:00Z', '2026-08-17T01:00:00Z'),
          stage('SLEEP_STAGE_REM', '2026-08-17T03:00:00Z', '2026-08-17T02:00:00Z'),
          stage('SLEEP_STAGE_LIGHT', '2026-08-17T04:00:00Z', '2026-08-17T05:00:00Z'),
        ],
      },
      'n1',
      {},
    )
    expect(night.segments).toHaveLength(1)
    expect(night.segments[0].stage).toBe('light')
  })

  it('sorts segments oldest-first regardless of payload order', () => {
    const night = parseSleepPayload(
      {
        ...NIGHT,
        sleepStages: [
          stage('SLEEP_STAGE_REM', '2026-08-17T04:00:00Z', '2026-08-17T05:00:00Z'),
          stage('SLEEP_STAGE_LIGHT', '2026-08-16T23:00:00Z', '2026-08-17T00:00:00Z'),
        ],
      },
      'n1',
      {},
    )
    expect(night.segments.map((s) => s.stage)).toEqual(['light', 'rem'])
  })

  it('sums out-of-bed segments', () => {
    const night = parseSleepPayload(
      {
        ...NIGHT,
        outOfBedSegments: [
          { startTime: '2026-08-17T02:30:00Z', endTime: '2026-08-17T02:40:00Z' },
          { startTime: '2026-08-17T05:00:00Z', endTime: '2026-08-17T05:05:00Z' },
        ],
      },
      'n1',
      {},
    )
    expect(night.outOfBedMs).toBe(15 * 60_000)
  })

  it('survives a completely empty payload', () => {
    const night = parseSleepPayload(undefined, 'n1', {})
    expect(night.timeAsleepMs).toBe(0)
    expect(night.efficiency).toBeNull()
    expect(night.stagesAvailable).toBe(false)
  })
})

describe('sleepNights', () => {
  const record = (key: string, payload: unknown, id = 'sleep'): HealthRecord => ({
    key,
    dataType: { ...SLEEP_TYPE, id },
    timestamp: null,
    summary: null,
    details: [],
    source: null,
    raw: { name: key, sleep: payload },
  })

  it('picks out only the sleep records', () => {
    const nights = sleepNights([
      record('a', NIGHT),
      record('b', {}, 'steps'),
      record('c', {}, 'daily-heart-rate-variability'),
    ])
    expect(nights).toHaveLength(1)
    expect(nights[0].key).toBe('a')
  })

  it('sorts nights newest-first', () => {
    const older = { ...NIGHT, startTime: '2026-08-14T23:00:00Z' }
    const nights = sleepNights([record('old', older), record('new', NIGHT)])
    expect(nights.map((n) => n.key)).toEqual(['new', 'old'])
  })
})

describe('stageShare', () => {
  it('reports each stage as a percentage of the whole session', () => {
    const night = parseSleepPayload(NIGHT, 'n1', {})
    expect(stageShare(night, 'light')).toBeCloseTo((4 / 7) * 100, 5)
    expect(stageShare(night, 'awake')).toBeCloseTo((0.5 / 7) * 100, 5)
  })

  it('returns 0 rather than NaN when the night is empty', () => {
    expect(stageShare(parseSleepPayload({}, 'n1', {}), 'deep')).toBe(0)
  })
})

describe('formatDuration', () => {
  it('reads as hours and minutes', () => {
    expect(formatDuration(7.7 * HOUR)).toBe('7 h 42 min')
    expect(formatDuration(2 * HOUR)).toBe('2 h')
    expect(formatDuration(45 * 60_000)).toBe('45 min')
    expect(formatDuration(0)).toBe('0 min')
  })
})
