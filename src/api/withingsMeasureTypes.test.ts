import { describe, expect, it } from 'vitest'
import { formatDelta, formatMeasureValue, labelFor, sortKeyFor } from './withingsMeasureTypes'

// The number formatting here follows Intl.NumberFormat(undefined, ...), same
// as src/api/normalize.ts -- its separators depend on the runtime locale (this
// environment's Node reports en-DE, comma-decimal). Assertions below build
// their expectation the same way rather than hardcoding a separator, so the
// tests stay portable across CI locales.
const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

describe('labelFor', () => {
  it('labels a known type', () => {
    expect(labelFor(1)).toBe('Weight')
  })

  it('labels an unknown type as "Type N"', () => {
    expect(labelFor(9999)).toBe('Type 9999')
  })
})

describe('sortKeyFor', () => {
  it('orders known types by DISPLAY_ORDER', () => {
    expect(sortKeyFor(1)).toBeLessThan(sortKeyFor(6)) // weight before fat ratio
    expect(sortKeyFor(6)).toBeLessThan(sortKeyFor(88)) // fat ratio before bone mass
  })

  it('sorts unknown types after every known one', () => {
    const maxKnown = Math.max(sortKeyFor(1), sortKeyFor(168))
    expect(sortKeyFor(9999)).toBeGreaterThan(maxKnown)
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
