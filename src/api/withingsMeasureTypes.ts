/**
 * Withings measure-type catalog. Not exhaustive by design: this labels and
 * orders known types, it does not filter — a type absent here still renders,
 * as `Type <n>`, so a firmware update that adds a metric shows up instead of
 * silently vanishing. See withingsNormalize.ts for how the catalog is used.
 */

import type { Measure } from './withingsTypes'

export interface MeasureTypeDef {
  type: number
  key: string
  label: string
  unit: string
  /** Decimal places for display, chosen per unit's natural precision. */
  decimals: number
}

export const MEASURE_TYPES: MeasureTypeDef[] = [
  { type: 1, key: 'weight', label: 'Weight', unit: 'kg', decimals: 1 },
  { type: 4, key: 'height', label: 'Height', unit: 'm', decimals: 2 },
  { type: 5, key: 'fatFreeMass', label: 'Fat-free mass', unit: 'kg', decimals: 1 },
  { type: 6, key: 'fatRatio', label: 'Fat ratio', unit: '%', decimals: 1 },
  { type: 8, key: 'fatMass', label: 'Fat mass', unit: 'kg', decimals: 1 },
  { type: 11, key: 'heartPulse', label: 'Heart pulse', unit: 'bpm', decimals: 0 },
  { type: 76, key: 'muscleMass', label: 'Muscle mass', unit: 'kg', decimals: 1 },
  { type: 77, key: 'hydration', label: 'Hydration', unit: 'kg', decimals: 1 },
  { type: 88, key: 'boneMass', label: 'Bone mass', unit: 'kg', decimals: 1 },
  { type: 91, key: 'pulseWaveVelocity', label: 'Pulse wave velocity', unit: 'm/s', decimals: 1 },
  { type: 122, key: 'visceralFat', label: 'Visceral fat', unit: '', decimals: 1 },
  { type: 155, key: 'vascularAge', label: 'Vascular age', unit: 'yr', decimals: 0 },
  { type: 168, key: 'vo2Max', label: 'VO2 max', unit: 'ml/min/kg', decimals: 1 },
]

export const MEASURE_TYPES_BY_ID = new Map(MEASURE_TYPES.map((m) => [m.type, m]))

/**
 * Presentation order, independent of whatever order the API returns measures
 * in. Weight leads, then body composition, then the advanced/derived metrics.
 */
export const DISPLAY_ORDER: number[] = MEASURE_TYPES.map((m) => m.type)

/**
 * Types that belong under "Body composition". `user.metrics` returns every
 * measurement the account has — a paired blood-pressure monitor's readings
 * would otherwise show up here too, so section membership is: does this group
 * contain at least one of these.
 */
export const BODY_COMPOSITION_TYPES = new Set(DISPLAY_ORDER)

export function labelFor(type: number): string {
  return MEASURE_TYPES_BY_ID.get(type)?.label ?? `Type ${type}`
}

export function sortKeyFor(type: number): number {
  const index = DISPLAY_ORDER.indexOf(type)
  // Unknown types sort after every known one, in a stable (numeric) order.
  return index === -1 ? DISPLAY_ORDER.length + type : index
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

function decimalsFor(type: number): number {
  return MEASURE_TYPES_BY_ID.get(type)?.decimals ?? 1
}

export function formatMeasureValue(measure: Measure): string {
  const decimals = decimalsFor(measure.type)
  const text = numberFormat.format(Number(measure.value.toFixed(decimals)))
  return measure.unit ? `${text} ${measure.unit}` : text
}

/** A signed "+0.3 kg" / "−0.3 kg" for a change since the previous weigh-in. */
export function formatDelta(delta: number, type: number, unit: string): string {
  const decimals = decimalsFor(type)
  const rounded = Number(delta.toFixed(decimals))
  const text = numberFormat.format(Math.abs(rounded))
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '±'
  return unit ? `${sign}${text} ${unit}` : `${sign}${text}`
}
