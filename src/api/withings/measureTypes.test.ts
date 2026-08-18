import { describe, expect, it } from 'vitest'
import {
  BODY_COMPOSITION_TYPES,
  CARD_MEASURE_TYPES,
  FAT_MASS_TYPE,
  cardMeasures,
  formatDelta,
  formatMeasureValue,
  MUSCLE_MASS_TYPE,
  measureLabel,
  measureSortKey,
  FAT_RATIO_TYPE,
  WEIGHT_TYPE,
} from './measureTypes'
import { normalizeMeasureGroup } from './normalize'
import type { RawMeasureGroup } from './types'

// The number formatting here follows Intl.NumberFormat(undefined, ...), same
// as src/api/normalize.ts -- its separators depend on the runtime locale (this
// environment's Node reports en-DE, comma-decimal). Assertions below build
// their expectation the same way rather than hardcoding a separator, so the
// tests stay portable across CI locales.
const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

describe('measureLabel', () => {
  it('labels a known type', () => {
    expect(measureLabel(1)).toBe('Weight')
  })

  it('labels an unknown type as "Type N"', () => {
    expect(measureLabel(9999)).toBe('Type 9999')
  })

  // Showed up in live data as the bare "Type 226" fallback before being added.
  it('labels basal metabolic rate', () => {
    expect(measureLabel(226)).toBe('Basal metabolic rate (avg)')
    expect(formatMeasureValue({ type: 226, label: 'x', unit: 'kcal', value: 1748.6 })).toBe(
      `${fmt.format(1749)} kcal`,
    )
  })
})

describe('measureSortKey', () => {
  it('orders known types by MEASURE_TYPE_ORDER', () => {
    expect(measureSortKey(1)).toBeLessThan(measureSortKey(6)) // weight before fat ratio
    expect(measureSortKey(6)).toBeLessThan(measureSortKey(88)) // fat ratio before bone mass
  })

  it('sorts unknown types after every known one', () => {
    const maxKnown = Math.max(measureSortKey(1), measureSortKey(168))
    expect(measureSortKey(9999)).toBeGreaterThan(maxKnown)
  })
})

describe('chart type constants', () => {
  it('point to the intended charted measures', () => {
    expect(WEIGHT_TYPE).toBe(1)
    expect(FAT_RATIO_TYPE).toBe(6)
    expect(MUSCLE_MASS_TYPE).toBe(76)
    expect(FAT_MASS_TYPE).toBe(8)
  })
})

describe('cardMeasures', () => {
  // A full smart-scale group as it arrives from getmeas, plus a type the card
  // does not list (122) and one nothing in the catalog knows (9999).
  const scaleGroup: RawMeasureGroup = {
    grpid: 1,
    date: 1_700_000_000,
    created: 1_700_000_000,
    category: 1,
    attrib: 0,
    deviceid: 'scale-1',
    measures: [
      { value: 1748, type: 226, unit: 0 },
      { value: 9999, type: 9999, unit: 0 },
      { value: 8, type: 122, unit: 0 },
      { value: 2340, type: 88, unit: -2 },
      { value: 4012, type: 77, unit: -2 },
      { value: 6120, type: 76, unit: -2 },
      { value: 1850, type: 8, unit: -2 },
      { value: 2356, type: 6, unit: -2 },
      { value: 6100, type: 5, unit: -2 },
      { value: 78500, type: 1, unit: -3 },
    ],
  }

  it('shows exactly the eight card measures, in order', () => {
    const measures = cardMeasures(normalizeMeasureGroup(scaleGroup).measures)
    expect(measures.map((m) => m.label)).toEqual([
      'Weight',
      'Fat-free mass',
      'Fat ratio',
      'Fat mass',
      'Muscle mass',
      'Hydration',
      'Bone mass',
      'Basal metabolic rate (avg)',
    ])
  })

  it('drops types the card does not list, known or not', () => {
    const types = cardMeasures(normalizeMeasureGroup(scaleGroup).measures).map((m) => m.type)
    expect(types).not.toContain(122) // in the catalog, and a body-composition marker
    expect(types).not.toContain(9999) // not in the catalog at all
  })

  it('leads with weight, which the card renders as the headline', () => {
    expect(cardMeasures(normalizeMeasureGroup(scaleGroup).measures)[0].type).toBe(1)
  })

  it('returns nothing rather than throwing when a group has no card measures', () => {
    expect(cardMeasures([{ type: 11, label: 'Heart pulse', unit: 'bpm', value: 62 }])).toEqual([])
  })

  // The two lists answer different questions, so they are allowed to disagree
  // -- and do. This pins that they are not quietly derived from one another.
  it('is not the body-composition marker set', () => {
    expect(BODY_COMPOSITION_TYPES.has(122)).toBe(true) // marks a group as a weigh-in...
    expect(CARD_MEASURE_TYPES.has(122)).toBe(false) // ...but is not shown on the card
    expect(CARD_MEASURE_TYPES.has(226)).toBe(true) // shown on the card...
    expect(BODY_COMPOSITION_TYPES.has(226)).toBe(false) // ...but never marks a group alone
  })
})

describe('formatMeasureValue', () => {
  it('formats with the type-specific decimal precision and unit', () => {
    expect(formatMeasureValue({ type: 1, label: 'Weight', unit: 'kg', value: 78.5 })).toBe(
      `${fmt.format(78.5)} kg`,
    )
    expect(formatMeasureValue({ type: 6, label: 'Fat ratio', unit: '%', value: 23.456 })).toBe(
      `${fmt.format(23.5)} %`, // rounded to fat ratio's 1-decimal precision first
    )
  })

  it('omits a trailing space when the unit is empty', () => {
    expect(formatMeasureValue({ type: 122, label: 'Visceral fat', unit: '', value: 8 })).toBe('8')
  })
})

describe('formatDelta', () => {
  it('prefixes a positive change with +', () => {
    expect(formatDelta(0.3, 1, 'kg')).toBe(`+${fmt.format(0.3)} kg`)
  })

  it('prefixes a negative change with the minus sign, not a double sign', () => {
    const result = formatDelta(-0.3, 1, 'kg')
    expect(result).toBe(`−${fmt.format(0.3)} kg`)
    expect(result).not.toContain('--')
    expect(result).not.toMatch(/−-/)
  })

  it('uses ± for no change', () => {
    expect(formatDelta(0, 1, 'kg')).toBe('±0 kg')
  })

  it('rounds to the type-specific decimal count before deciding the sign', () => {
    // Rounds to 0 at 1 decimal place -> must not show "+0.0".
    expect(formatDelta(0.04, 1, 'kg')).toBe('±0 kg')
  })
})
