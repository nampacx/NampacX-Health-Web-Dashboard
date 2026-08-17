import { describe, expect, it } from 'vitest'
import {
  isBodyCompositionGroup,
  normalizeGetMeasResponse,
  normalizeMeasureGroup,
  provenanceFor,
  scaleValue,
} from './normalize'
import type { RawMeasureGroup } from './types'

function group(overrides: Partial<RawMeasureGroup> = {}): RawMeasureGroup {
  return {
    grpid: 1,
    attrib: 0,
    date: 1_700_000_000,
    created: 1_700_000_000,
    category: 1,
    deviceid: 'dev-1',
    measures: [{ value: 78500, type: 1, unit: -3 }],
    ...overrides,
  }
}

describe('scaleValue', () => {
  it('scales positive and negative units', () => {
    expect(scaleValue(78500, -3)).toBe(78.5)
    expect(scaleValue(78, 0)).toBe(78)
    expect(scaleValue(5, 2)).toBe(500)
  })

  it('avoids the binary-float artefact from naive value * 10 ** unit', () => {
    // Regression case: 2340 * 10 ** -2 === 23.400000000000002 in raw JS.
    expect(2340 * 10 ** -2).not.toBe(23.4) // sanity check the bug exists
    expect(scaleValue(2340, -2)).toBe(23.4)
    expect(scaleValue(1755, -3)).toBe(1.755)
    expect(scaleValue(9999, -2)).toBe(99.99)
  })

  it('every result is a clean decimal string, not a float tail', () => {
    const cases: Array<[number, number]> = [
      [78500, -3], [1850, -2], [2340, -2], [6120, -2], [1755, -3], [12345, -3], [9999, -2],
    ]
    for (const [value, unit] of cases) {
      const result = scaleValue(value, unit)
      expect(String(result)).not.toMatch(/\.\d{4,}/)
    }
  })
})

describe('provenanceFor', () => {
  it('maps known attrib codes', () => {
    expect(provenanceFor(0)).toBe('device')
    expect(provenanceFor(1)).toBe('device')
    expect(provenanceFor(2)).toBe('manual')
    expect(provenanceFor(4)).toBe('manual')
  })

  it('falls back to auto for unknown codes', () => {
    expect(provenanceFor(8)).toBe('auto')
    expect(provenanceFor(99)).toBe('auto')
  })
})

describe('normalizeMeasureGroup', () => {
  it('converts epoch seconds to a Date', () => {
    const result = normalizeMeasureGroup(group({ date: 1_700_000_000 }))
    expect(result.date.getTime()).toBe(1_700_000_000_000)
  })

  it('labels a known type and scales its value', () => {
    const result = normalizeMeasureGroup(group({ measures: [{ value: 78500, type: 1, unit: -3 }] }))
    expect(result.measures[0]).toEqual({ type: 1, label: 'Weight', unit: 'kg', value: 78.5 })
  })

  it('labels an unknown type as "Type N" rather than dropping it', () => {
    const result = normalizeMeasureGroup(group({ measures: [{ value: 100, type: 9999, unit: 0 }] }))
    expect(result.measures[0].label).toBe('Type 9999')
    expect(result.measures[0].unit).toBe('')
  })

  it('sorts measures by display order, not API order', () => {
    const result = normalizeMeasureGroup(
      group({
        measures: [
          { value: 1, type: 88, unit: 0 }, // bone mass, late in MEASURE_TYPE_ORDER
          { value: 1, type: 1, unit: 0 }, // weight, first
          { value: 1, type: 6, unit: 0 }, // fat ratio
        ],
      }),
    )
    expect(result.measures.map((m) => m.type)).toEqual([1, 6, 88])
  })

  it('preserves the raw group', () => {
    const raw = group()
    expect(normalizeMeasureGroup(raw).raw).toBe(raw)
  })
})

describe('isBodyCompositionGroup', () => {
  it('is true when any measure is a body-composition type', () => {
    expect(isBodyCompositionGroup(group({ measures: [{ value: 1, type: 1, unit: 0 }] }))).toBe(true)
  })

  it('is false for a foreign device type, e.g. blood pressure', () => {
    // 9 = systolic, 10 = diastolic in Withings' catalog; neither is in ours.
    expect(
      isBodyCompositionGroup(
        group({ measures: [{ value: 120, type: 9, unit: 0 }, { value: 80, type: 10, unit: 0 }] }),
      ),
    ).toBe(false)
  })

  it('is false for a blood-pressure reading that also carries heart pulse', () => {
    // The real shape a Withings BPM emits: 11 (heart pulse) rides along in the
    // same group as 9/10. 11 is in the label catalog, so deriving membership
    // from that catalog would misfile every BP reading as a weigh-in.
    expect(
      isBodyCompositionGroup(
        group({
          measures: [
            { value: 120, type: 9, unit: 0 },
            { value: 80, type: 10, unit: 0 },
            { value: 62, type: 11, unit: 0 },
          ],
        }),
      ),
    ).toBe(false)
  })
})

describe('normalizeGetMeasResponse', () => {
  it('drops category !== 1 goals even if the caller forgot to filter server-side', () => {
    const groups = [group({ grpid: 1, category: 1 }), group({ grpid: 2, category: 2 })]
    const result = normalizeGetMeasResponse(groups)
    expect(result.map((g) => g.key)).toEqual(['1'])
  })

  it('drops groups with no body-composition measures', () => {
    const groups = [group({ grpid: 1, measures: [{ value: 120, type: 9, unit: 0 }] })]
    expect(normalizeGetMeasResponse(groups)).toHaveLength(0)
  })

  it('dedupes overlapping pages by grpid, keeping one entry', () => {
    const page1 = group({ grpid: 5, date: 1_700_000_100 })
    const page2 = group({ grpid: 5, date: 1_700_000_100 }) // same group, returned twice
    const result = normalizeGetMeasResponse([page1, page2])
    expect(result).toHaveLength(1)
  })

  it('sorts newest first', () => {
    const older = group({ grpid: 1, date: 1_000 })
    const newer = group({ grpid: 2, date: 2_000 })
    const result = normalizeGetMeasResponse([older, newer])
    expect(result.map((g) => g.key)).toEqual(['2', '1'])
  })
})
