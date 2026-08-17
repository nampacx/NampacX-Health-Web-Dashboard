import { describe, expect, it } from 'vitest'
import {
  clockLabel,
  formatDuration,
  localDateKey,
  parseOffsetSeconds,
  parseSleepPayload,
  parseStageType,
  sleepNights,
  stageShare,
} from './sleep'
import { FITBIT_SLEEP_NIGHT } from './sleepNight.fixture'
import type { DataTypeDef, HealthRecord } from './types'

const MINUTE = 60_000
const SLEEP_TYPE: DataTypeDef = {
  id: 'sleep',
  label: 'Sleep',
  category: 'Sleep',
  scope: 'sleep.readonly',
}

const payload = FITBIT_SLEEP_NIGHT.sleep
const night = parseSleepPayload(payload, 'n1', FITBIT_SLEEP_NIGHT)

/**
 * Everything below asserts against one real night captured from a live account.
 * The previous version of this parser passed a full suite of hand-written tests
 * and still produced "0 min asleep" on every card, because the fixtures were
 * built from the same wrong field names as the parser. Synthetic payloads only
 * ever prove the parser agrees with itself.
 */
describe('parseSleepPayload, against a real Fitbit night', () => {
  it('reads the session bounds from interval, not the top level', () => {
    expect(night.start?.toISOString()).toBe('2026-08-16T20:18:00.000Z')
    expect(night.end?.toISOString()).toBe('2026-08-17T04:16:00.000Z')
  })

  // The single most visible bug in the first version: `stages[].type`, not
  // `sleepStages[].stageType`, so every segment was dropped.
  it('finds all 23 stage segments', () => {
    expect(night.segments).toHaveLength(23)
    expect(night.stagesAvailable).toBe(true)
    expect(night.segments[0].stage).toBe('awake')
    expect(night.segments[1].stage).toBe('light')
    expect(night.segments[2].stage).toBe('deep')
  })

  it('takes stage totals from summary.stagesSummary in minutes', () => {
    expect(night.totals.awake).toBe(10 * MINUTE)
    expect(night.totals.light).toBe(308 * MINUTE)
    expect(night.totals.deep).toBe(51 * MINUTE)
    expect(night.totals.rem).toBe(108 * MINUTE)
  })

  it('reports how fragmented each stage was', () => {
    expect(night.episodes).toEqual({ awake: 2, light: 11, deep: 5, rem: 5 })
  })

  it('uses the summary for asleep and in-bed rather than re-deriving them', () => {
    expect(night.timeAsleepMs).toBe(468 * MINUTE)
    expect(night.timeInBedMs).toBe(478 * MINUTE)
    expect(night.awakeMs).toBe(10 * MINUTE)
    expect(night.fallAsleepMs).toBe(0)
  })

  it('computes efficiency from the summary figures', () => {
    expect(night.efficiency).toBeCloseTo((468 / 478) * 100, 5)
  })

  it('counts the brief arousals tracked outside the stage timeline', () => {
    expect(night.shortAwakenings).toBe(22)
  })

  it('carries the tracking type and main-sleep flag', () => {
    expect(night.trackingType).toBe('STAGES')
    expect(night.isMainSleep).toBe(true)
  })

  it('renders in the recording zone, not the browser zone', () => {
    // 20:18Z at +02:00 is a 22:18 bedtime. Formatting the instant locally would
    // agree only for a viewer who happens to sit at +02:00 as well.
    expect(night.utcOffsetSeconds).toBe(7200)
    expect(clockLabel(night.start!, night.utcOffsetSeconds)).toBe('22:18')
    expect(clockLabel(night.end!, night.utcOffsetSeconds)).toBe('06:16')
  })

  it('files the night under the morning it ended, in local terms', () => {
    expect(localDateKey(night.end!, night.utcOffsetSeconds)).toBe('2026-08-17')
    expect(localDateKey(night.start!, night.utcOffsetSeconds)).toBe('2026-08-16')
  })

  it('agrees with the segments it drew, to within the summary rounding', () => {
    // The summary is whole minutes; the segments carry :30 boundaries. Half a
    // minute per stage is expected -- anything larger means they disagree.
    const summed = night.segments.reduce<Record<string, number>>((totals, segment) => {
      totals[segment.stage] = (totals[segment.stage] ?? 0) + segment.durationMs
      return totals
    }, {})
    for (const stage of ['awake', 'light', 'deep', 'rem'] as const) {
      expect(Math.abs(summed[stage] - night.totals[stage])).toBeLessThanOrEqual(MINUTE)
    }
  })
})

describe('parseSleepPayload, degraded inputs', () => {
  it('falls back to summing the segments when there is no summary', () => {
    const { summary: _summary, ...withoutSummary } = payload
    const parsed = parseSleepPayload(withoutSummary, 'n1', {})
    // 51.5 min of deep across the segments, versus the summary's 51.
    expect(parsed.totals.deep).toBe(51.5 * MINUTE)
    expect(parsed.timeAsleepMs).toBe(parsed.totals.rem + parsed.totals.light + parsed.totals.deep)
  })

  it('falls back to the interval span when the summary omits the period', () => {
    const parsed = parseSleepPayload({ ...payload, summary: {} }, 'n1', {})
    expect(parsed.timeInBedMs).toBe(478 * MINUTE)
  })

  it('reports no timeline for a night tracked without stages', () => {
    const parsed = parseSleepPayload(
      { interval: payload.interval, type: 'CLASSIC', summary: payload.summary },
      'n1',
      {},
    )
    expect(parsed.stagesAvailable).toBe(false)
    expect(parsed.trackingType).toBe('CLASSIC')
    // The summary still stands, so the night is not blank.
    expect(parsed.timeAsleepMs).toBe(468 * MINUTE)
  })

  it('treats a nap as a nap', () => {
    const parsed = parseSleepPayload(
      { ...payload, metadata: { ...payload.metadata, mainSleep: false } },
      'n1',
      {},
    )
    expect(parsed.isMainSleep).toBe(false)
  })

  it('survives a completely empty payload', () => {
    const parsed = parseSleepPayload(undefined, 'n1', {})
    expect(parsed.timeAsleepMs).toBe(0)
    expect(parsed.efficiency).toBeNull()
    expect(parsed.stagesAvailable).toBe(false)
    expect(parsed.utcOffsetSeconds).toBe(0)
  })

  it('drops zero-length and reversed segments', () => {
    const parsed = parseSleepPayload(
      {
        ...payload,
        stages: [
          { startTime: '2026-08-17T01:00:00Z', endTime: '2026-08-17T01:00:00Z', type: 'DEEP' },
          { startTime: '2026-08-17T03:00:00Z', endTime: '2026-08-17T02:00:00Z', type: 'REM' },
          { startTime: '2026-08-17T04:00:00Z', endTime: '2026-08-17T05:00:00Z', type: 'LIGHT' },
        ],
      },
      'n1',
      {},
    )
    expect(parsed.segments).toHaveLength(1)
    expect(parsed.segments[0].stage).toBe('light')
  })

  it('sorts segments oldest-first regardless of payload order', () => {
    const parsed = parseSleepPayload(
      { ...payload, stages: [...payload.stages].reverse() },
      'n1',
      {},
    )
    expect(parsed.segments[0].start.toISOString()).toBe('2026-08-16T20:18:00.000Z')
  })

  // Belt and braces: the proto reference claims these names, and if the API
  // ever actually sends them the view should not blank out again.
  it('also accepts the proto-reference field names', () => {
    const parsed = parseSleepPayload(
      {
        startTime: '2026-08-16T22:00:00Z',
        endTime: '2026-08-17T06:00:00Z',
        sleepStages: [
          {
            startTime: '2026-08-16T22:00:00Z',
            endTime: '2026-08-17T02:00:00Z',
            stageType: 'SLEEP_STAGE_DEEP',
          },
        ],
      },
      'n1',
      {},
    )
    expect(parsed.segments).toHaveLength(1)
    expect(parsed.segments[0].stage).toBe('deep')
    expect(parsed.timeInBedMs).toBe(8 * 60 * MINUTE)
  })
})

describe('parseStageType', () => {
  it('accepts the real bare form', () => {
    expect(parseStageType('DEEP')).toBe('deep')
    expect(parseStageType('AWAKE')).toBe('awake')
    expect(parseStageType('REM')).toBe('rem')
    expect(parseStageType('LIGHT')).toBe('light')
  })

  it('accepts the proto-reference form too', () => {
    expect(parseStageType('SLEEP_STAGE_DEEP')).toBe('deep')
  })

  it('drops an unrecognised stage rather than guessing', () => {
    expect(parseStageType('SLEEP_STAGE_TYPE_UNSPECIFIED')).toBeNull()
    expect(parseStageType('ASLEEP')).toBeNull()
    expect(parseStageType(undefined)).toBeNull()
  })
})

describe('parseOffsetSeconds', () => {
  it('reads the protobuf duration string', () => {
    expect(parseOffsetSeconds('7200s')).toBe(7200)
    expect(parseOffsetSeconds('-18000s')).toBe(-18000)
  })

  it('treats anything unreadable as no offset', () => {
    expect(parseOffsetSeconds('7200')).toBe(0)
    expect(parseOffsetSeconds(undefined)).toBe(0)
  })
})

describe('sleepNights', () => {
  const record = (key: string, raw: Record<string, unknown>, id = 'sleep'): HealthRecord => ({
    key,
    dataType: { ...SLEEP_TYPE, id },
    timestamp: null,
    summary: null,
    details: [],
    source: null,
    raw,
  })

  it('parses a real data point end to end', () => {
    const nights = sleepNights([record('a', FITBIT_SLEEP_NIGHT)])
    expect(nights).toHaveLength(1)
    expect(nights[0].timeAsleepMs).toBe(468 * MINUTE)
  })

  it('picks out only the sleep records', () => {
    const nights = sleepNights([
      record('a', FITBIT_SLEEP_NIGHT),
      record('b', { steps: {} }, 'steps'),
    ])
    expect(nights.map((n) => n.key)).toEqual(['a'])
  })

  it('sorts nights newest-first', () => {
    const older = {
      ...FITBIT_SLEEP_NIGHT,
      sleep: {
        ...payload,
        interval: { ...payload.interval, startTime: '2026-08-14T20:00:00Z' },
      },
    }
    const nights = sleepNights([record('old', older), record('new', FITBIT_SLEEP_NIGHT)])
    expect(nights.map((n) => n.key)).toEqual(['new', 'old'])
  })

  // The first version read `raw.sleep` and nothing else. A renamed key should
  // degrade, not blank every card.
  it('finds the payload even if the envelope key changes', () => {
    const renamed = { name: 'x', dataSource: {}, sleepSession: payload }
    expect(sleepNights([record('a', renamed)])[0].segments).toHaveLength(23)
  })
})

describe('stageShare', () => {
  it('reports each stage as a percentage of the whole session', () => {
    expect(stageShare(night, 'deep')).toBeCloseTo((51 / 477) * 100, 5)
    expect(stageShare(night, 'light')).toBeCloseTo((308 / 477) * 100, 5)
  })

  it('returns 0 rather than NaN when the night is empty', () => {
    expect(stageShare(parseSleepPayload({}, 'n1', {}), 'deep')).toBe(0)
  })
})

describe('formatDuration', () => {
  it('reads as hours and minutes', () => {
    expect(formatDuration(468 * MINUTE)).toBe('7 h 48 min')
    expect(formatDuration(120 * MINUTE)).toBe('2 h')
    expect(formatDuration(45 * MINUTE)).toBe('45 min')
    expect(formatDuration(0)).toBe('0 min')
  })
})
