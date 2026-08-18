import { describe, expect, it } from 'vitest'
import { exerciseSessions, exerciseTotals, humanizeExerciseType } from './exercise'
import { normalizeDataPoint } from './normalize'
import type { DataTypeDef, HealthRecord, RawDataPoint } from './types'

const EXERCISE: DataTypeDef = {
  id: 'exercise',
  label: 'Exercise',
  category: 'Activity',
  recordType: 'session',
  scope: 'activity_and_fitness.readonly',
  summaryKeys: ['displayName', 'exerciseType'],
}

/**
 * Shaped after the example in Google's own workouts guide (the camelCase REST
 * one, not the snake_case RPC reference — that page is what misled the first
 * sleep parser). Nothing here is *required* by the code under test: the ranking
 * is pattern-based, so a renamed field reorders a card instead of emptying it,
 * and that property is asserted below.
 */
function point(exercise: Record<string, unknown>, name = 'e1'): RawDataPoint {
  return { name, dataSource: { platform: 'FITBIT' }, exercise }
}

function record(raw: RawDataPoint, dataType: DataTypeDef = EXERCISE): HealthRecord {
  return normalizeDataPoint(raw, dataType, 0)
}

const RUN = point({
  interval: {
    startTime: '2026-08-17T06:00:00Z',
    startUtcOffset: '7200s',
    endTime: '2026-08-17T06:35:00Z',
    endUtcOffset: '7200s',
  },
  exerciseType: 'RUNNING',
  displayName: 'Morning Trail Run',
  activeDuration: '1800s',
  metricsSummary: {
    steps: '4120',
    caloriesKcal: 312,
    distanceMillimeters: '6100000',
    averageHeartRateBeatsPerMinute: 148,
  },
  splitSummaries: [{ splitType: 'LAP' }, { splitType: 'LAP' }, { splitType: 'LAP' }],
})

describe('exerciseSessions', () => {
  const [run] = exerciseSessions([record(RUN)])

  it('leads with the display name', () => {
    expect(run.title).toBe('Morning Trail Run')
  })

  it('falls back to the humanized exercise type when unnamed', () => {
    const { displayName: _drop, ...rest } = RUN.exercise as Record<string, unknown>
    const [session] = exerciseSessions([record(point(rest))])
    expect(session.title).toBe('Running')
  })

  it('falls back again to "Workout" when there is nothing to go on', () => {
    expect(exerciseSessions([record(point({}))])[0].title).toBe('Workout')
  })

  // activeDuration excludes paused time, so a 35-minute window can hold a
  // 30-minute workout. Showing the window would overstate the session.
  it('prefers activeDuration over the wall-clock window', () => {
    expect(run.durationMs).toBe(1_800_000)
    expect(run.durationIsActive).toBe(true)
  })

  it('falls back to end - start when activeDuration is absent', () => {
    const { activeDuration: _drop, ...rest } = RUN.exercise as Record<string, unknown>
    const [session] = exerciseSessions([record(point(rest))])
    expect(session.durationMs).toBe(35 * 60_000)
    expect(session.durationIsActive).toBe(false)
  })

  it('reads the interval and its recording offset', () => {
    expect(run.start?.toISOString()).toBe('2026-08-17T06:00:00.000Z')
    expect(run.utcOffsetSeconds).toBe(7200)
  })

  it('counts laps', () => {
    expect(run.splits).toBe(3)
  })

  it('ranks energy and distance ahead of heart rate and steps', () => {
    const order = run.stats.map((stat) => stat.path)
    expect(order.indexOf('metricsSummary.caloriesKcal')).toBeLessThan(
      order.indexOf('metricsSummary.averageHeartRateBeatsPerMinute'),
    )
    expect(order.indexOf('metricsSummary.distanceMillimeters')).toBeLessThan(
      order.indexOf('metricsSummary.steps'),
    )
  })

  it('keeps the header fields out of the stat grid', () => {
    const paths = run.stats.map((stat) => stat.path)
    expect(paths).not.toContain('displayName')
    expect(paths).not.toContain('exerciseType')
    expect(paths).not.toContain('activeDuration')
  })

  // `flatten` renders an array of objects as "3 entries", which is noise as a
  // stat -- the useful part of splitSummaries is its count, taken separately.
  it('drops the "N entries" placeholder arrays leave behind', () => {
    expect(run.stats.every((stat) => !/ entries$/.test(stat.text))).toBe(true)
  })

  it('formats values with their units', () => {
    const byPath = new Map(run.stats.map((stat) => [stat.path, stat.text]))
    expect(byPath.get('metricsSummary.caloriesKcal')).toContain('kcal')
    expect(byPath.get('metricsSummary.distanceMillimeters')).toContain('km')
    expect(byPath.get('metricsSummary.averageHeartRateBeatsPerMinute')).toContain('bpm')
  })

  it('sorts sessions newest-first', () => {
    const older = point(
      { interval: { startTime: '2026-08-15T06:00:00Z', endTime: '2026-08-15T06:20:00Z' } },
      'old',
    )
    expect(exerciseSessions([record(older), record(RUN)]).map((s) => s.key)).toEqual([
      'e1',
      'old',
    ])
  })

  it('ignores records that are not exercise', () => {
    const steps = record({ name: 's', steps: { steps: 900 } }, { ...EXERCISE, id: 'steps' })
    expect(exerciseSessions([steps])).toEqual([])
  })
})

/**
 * `metadata.hasGps` is the only trace of a route in the payload — the whole
 * DataPoint union has no lat/lon anywhere, so this boolean is what decides
 * whether a TCX export is worth offering.
 */
describe('exerciseSessions, GPS', () => {
  const withGps = point(
    {
      interval: { startTime: '2026-08-17T06:00:00Z', endTime: '2026-08-17T06:30:00Z' },
      metadata: { hasGps: true, poolLengthMillimeters: '25000' },
    },
    'users/1234/dataTypes/exercise/dataPoints/987',
  )

  it('reads the flag and the exportable data point id', () => {
    const [session] = exerciseSessions([record(withGps)])
    expect(session.hasGps).toBe(true)
    expect(session.dataPointId).toBe('987')
  })

  it('reports no GPS when the flag is false or absent', () => {
    const treadmill = point({ metadata: { hasGps: false } })
    expect(exerciseSessions([record(treadmill)])[0].hasGps).toBe(false)
    expect(exerciseSessions([record(point({}))])[0].hasGps).toBe(false)
  })

  // Same latitude parseInterval takes: the reference and the wire format have
  // disagreed about nesting before.
  it('accepts the flag at the payload top level too', () => {
    expect(exerciseSessions([record(point({ hasGps: true }))])[0].hasGps).toBe(true)
  })

  // A session with no resource name has no server-side id, so there is nothing to
  // export and the button must not appear.
  it('has no data point id when the record carries no resource name', () => {
    const nameless: RawDataPoint = { exercise: { metadata: { hasGps: true } } }
    const [session] = exerciseSessions([record(nameless)])
    expect(session.hasGps).toBe(true)
    expect(session.dataPointId).toBeNull()
  })

  // It drives a badge and a button in the header, so as a stat it would read
  // "Has gps: No" on every indoor session — a slot spent on an absence.
  it('keeps hasGps out of the stat grid but keeps poolLength in', () => {
    const paths = exerciseSessions([record(withGps)])[0].stats.map((stat) => stat.path)
    expect(paths).not.toContain('metadata.hasGps')
    expect(paths).toContain('metadata.poolLengthMillimeters')
  })
})

/**
 * The property that matters most: this is why the ranking is pattern-based
 * rather than a schema. An unrecognised payload still produces a full card.
 */
describe('exerciseSessions, unknown shapes', () => {
  it('still surfaces stats when every field name is unfamiliar', () => {
    const odd = point({
      interval: { startTime: '2026-08-17T06:00:00Z', endTime: '2026-08-17T06:30:00Z' },
      displayName: 'Something New',
      quantumFlux: 42,
      wibbleCount: '7',
    })
    const [session] = exerciseSessions([record(odd)])
    expect(session.title).toBe('Something New')
    expect(session.stats.map((s) => s.path)).toEqual(
      expect.arrayContaining(['quantumFlux', 'wibbleCount']),
    )
  })

  it('survives a session carrying nothing but a time window', () => {
    const bare = point({
      interval: { startTime: '2026-08-17T06:00:00Z', endTime: '2026-08-17T06:30:00Z' },
      exerciseType: 'STRENGTH_TRAINING',
    })
    const [session] = exerciseSessions([record(bare)])
    expect(session.stats).toEqual([])
    expect(session.durationMs).toBe(30 * 60_000)
    expect(session.title).toBe('Strength training')
  })

  it('survives an empty payload entirely', () => {
    const [session] = exerciseSessions([record({ name: 'x', exercise: {} })])
    expect(session.durationMs).toBeNull()
    expect(session.splits).toBe(0)
  })
})

describe('exerciseTotals', () => {
  const sessions = exerciseSessions([
    record(RUN),
    record(
      point(
        {
          interval: { startTime: '2026-08-16T06:00:00Z', endTime: '2026-08-16T06:40:00Z' },
          metricsSummary: { caloriesKcal: 200 },
        },
        'e2',
      ),
    ),
  ])

  it('adds up sessions, time and energy', () => {
    const totals = exerciseTotals(sessions)
    expect(totals.sessions).toBe(2)
    expect(totals.durationMs).toBe(1_800_000 + 40 * 60_000)
    expect(totals.caloriesKcal).toBe(512)
  })

  // A "0 kcal" total reads as a fact; absence reads as a gap, which is true.
  it('reports null rather than 0 when nothing had calories', () => {
    const noEnergy = exerciseSessions([
      record(point({ interval: { startTime: '2026-08-16T06:00:00Z', endTime: '2026-08-16T06:10:00Z' } })),
    ])
    expect(exerciseTotals(noEnergy).caloriesKcal).toBeNull()
  })

  // Only fields whose name carries `kcal` are summed: adding a joules figure to
  // a kcal one would produce a confident, wrong number.
  it('ignores energy fields in units it cannot confirm', () => {
    const joules = exerciseSessions([
      record(
        point({
          interval: { startTime: '2026-08-16T06:00:00Z', endTime: '2026-08-16T06:10:00Z' },
          metricsSummary: { energyJoules: 900000 },
        }),
      ),
    ])
    expect(exerciseTotals(joules).caloriesKcal).toBeNull()
  })

  it('handles an empty list', () => {
    expect(exerciseTotals([])).toEqual({ sessions: 0, durationMs: 0, caloriesKcal: null })
  })
})

describe('humanizeExerciseType', () => {
  it('turns the enum into a sentence', () => {
    expect(humanizeExerciseType('RUNNING')).toBe('Running')
    expect(humanizeExerciseType('HIGH_INTENSITY_INTERVAL_TRAINING')).toBe(
      'High intensity interval training',
    )
  })
})
