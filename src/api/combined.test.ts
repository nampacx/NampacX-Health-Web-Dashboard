import { describe, expect, it } from 'vitest'
import { toCombinedEntries } from './combined'
import type { DataTypeDef, HealthRecord } from './google/types'
import type { MeasureGroup } from './withings/types'

const dataType: DataTypeDef = {
  id: 'steps',
  label: 'Steps',
  category: 'Activity',
  scope: 'activity_and_fitness.readonly',
}

function record(overrides: Partial<HealthRecord> = {}): HealthRecord {
  return {
    key: 'r1',
    dataType,
    timestamp: new Date('2026-08-17T10:00:00Z'),
    summary: '8,412 steps',
    details: [],
    source: null,
    raw: { steps: { count: 8412 } },
    ...overrides,
  }
}

function group(overrides: Partial<MeasureGroup> = {}): MeasureGroup {
  return {
    key: 'g1',
    date: new Date('2026-08-17T07:00:00Z'),
    provenance: 'device',
    measures: [{ type: 1, label: 'Weight', unit: 'kg', value: 82.4 }],
    raw: { grpid: 1 },
    ...overrides,
  } as MeasureGroup
}

describe('toCombinedEntries', () => {
  it('interleaves both providers newest-first', () => {
    const result = toCombinedEntries(
      [record({ key: 'a', timestamp: new Date('2026-08-15T10:00:00Z') })],
      [group({ key: 'b', date: new Date('2026-08-16T10:00:00Z') })],
    )
    expect(result.map((entry) => entry.provider)).toEqual(['Withings', 'Google'])
  })

  it('namespaces keys so the two providers cannot collide', () => {
    const result = toCombinedEntries([record({ key: '1' })], [group({ key: '1' })])
    expect(result.map((entry) => entry.key).sort()).toEqual(['google:1', 'withings:1'])
  })

  it('sinks undated records below dated ones', () => {
    const result = toCombinedEntries(
      [record({ key: 'undated', timestamp: null }), record({ key: 'dated' })],
      [],
    )
    expect(result.map((entry) => entry.key)).toEqual(['google:dated', 'google:undated'])
  })

  it('falls back to a readable summary when a record has none', () => {
    const [entry] = toCombinedEntries([record({ summary: null })], [])
    expect(entry.summary).toBe('No readable value')
  })

  it('summarises a weigh-in from its measures', () => {
    const [entry] = toCombinedEntries([], [group()])
    expect(entry.summary).toBe('82.4 kg')
  })

  it('handles a weigh-in with no measures', () => {
    const [entry] = toCombinedEntries([], [group({ measures: [] })])
    expect(entry.summary).toBe('No measures')
  })
})
