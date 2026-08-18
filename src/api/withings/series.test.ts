import { describe, expect, it } from 'vitest'
import { calendarWeekLabel, toSeries } from './series'
import type { MeasureGroup } from './types'

function group(key: string, date: string, measures: Array<[number, number]>): MeasureGroup {
  return {
    key,
    date: new Date(date),
    provenance: 'device',
    measures: measures.map(([type, value]) => ({ type, label: `Type ${type}`, unit: '', value })),
    raw: { grpid: Number(key) },
  } as MeasureGroup
}

describe('toSeries', () => {
  it('reverses the newest-first input into oldest-first', () => {
    const points = toSeries(
      [
        group('2', '2026-08-17T07:00:00Z', [[1, 82.4]]),
        group('1', '2026-08-15T07:00:00Z', [[1, 83.1]]),
      ],
      1,
    )
    expect(points.map((point) => point.value)).toEqual([83.1, 82.4])
  })

  it('skips groups that lack the requested type rather than plotting a zero', () => {
    const points = toSeries(
      [
        group('1', '2026-08-15T07:00:00Z', [
          [1, 83.1],
          [6, 21.4],
        ]),
        group('2', '2026-08-16T07:00:00Z', [[1, 82.9]]), // weight only, no fat ratio
      ],
      6,
    )
    expect(points).toHaveLength(1)
    expect(points[0].value).toBe(21.4)
  })

  it('returns nothing when no group carries the type', () => {
    expect(toSeries([group('1', '2026-08-15T07:00:00Z', [[1, 83.1]])], 226)).toEqual([])
  })

  it('handles an empty input', () => {
    expect(toSeries([], 1)).toEqual([])
  })

  it('aggregates to weekly calendar-week averages in week mode', () => {
    const points = toSeries(
      [
        group('4', '2026-08-20T07:00:00Z', [[1, 81.8]]),
        group('3', '2026-08-18T07:00:00Z', [[1, 82.2]]),
        group('2', '2026-08-12T07:00:00Z', [[1, 81.2]]),
        group('1', '2026-08-10T07:00:00Z', [[1, 82.4]]),
      ],
      1,
      'week',
    )

    expect(points).toHaveLength(2)
    expect(points[0].value).toBeCloseTo((82.4 + 81.2) / 2)
    expect(points[1].value).toBeCloseTo((82.2 + 81.8) / 2)
    expect(points.map((point) => calendarWeekLabel(point.at))).toEqual(['CW 33/2026', 'CW 34/2026'])
  })
})

describe('calendarWeekLabel', () => {
  it('uses ISO week-year around January boundaries', () => {
    expect(calendarWeekLabel(new Date('2027-01-01T12:00:00Z'))).toBe('CW 53/2026')
    expect(calendarWeekLabel(new Date('2027-01-04T12:00:00Z'))).toBe('CW 1/2027')
  })
})
