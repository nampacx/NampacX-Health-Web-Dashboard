/**
 * Withings measure-type catalog. Not exhaustive by design: this labels and
 * orders known types, it does not filter — a type absent here still renders,
 * as `Type <n>`, so a firmware update that adds a metric shows up instead of
 * silently vanishing. See normalize.ts for how the catalog is used.
 */

import type { Measure } from './types'

export interface MeasureTypeDef {
  type: number
  label: string
  unit: string
  /** Decimal places for display, chosen per unit's natural precision. */
  decimals: number
}

export const MEASURE_TYPES: MeasureTypeDef[] = [
  { type: 1, label: 'Weight', unit: 'kg', decimals: 1 },
  { type: 4, label: 'Height', unit: 'm', decimals: 2 },
  { type: 5, label: 'Fat-free mass', unit: 'kg', decimals: 1 },
  { type: 6, label: 'Fat ratio', unit: '%', decimals: 1 },
  { type: 8, label: 'Fat mass', unit: 'kg', decimals: 1 },
  { type: 11, label: 'Heart pulse', unit: 'bpm', decimals: 0 },
  { type: 76, label: 'Muscle mass', unit: 'kg', decimals: 1 },
  { type: 77, label: 'Hydration', unit: 'kg', decimals: 1 },
  { type: 88, label: 'Bone mass', unit: 'kg', decimals: 1 },
  { type: 91, label: 'Pulse wave velocity', unit: 'm/s', decimals: 1 },
  { type: 122, label: 'Visceral fat', unit: '', decimals: 1 },
  { type: 155, label: 'Vascular age', unit: 'yr', decimals: 0 },
  { type: 168, label: 'VO2 max', unit: 'ml/min/kg', decimals: 1 },
]

export const MEASURE_TYPES_BY_TYPE = new Map(MEASURE_TYPES.map((m) => [m.type, m]))

/**
 * Presentation order, independent of whatever order the API returns measures
 * in. Weight leads, then body composition, then the advanced/derived metrics.
 */
export const MEASURE_TYPE_ORDER: number[] = MEASURE_TYPES.map((m) => m.type)

/**
 * Types that belong under "Body composition". `user.metrics` returns every
 * measurement the account has — a paired blood-pressure monitor's readings
 * would otherwise show up here too, so section membership is: does this group
 * contain at least one of these.
 *
 * Deliberately its own list rather than being derived from MEASURE_TYPES. The
 * catalog above exists to *label* types and explicitly does not filter, so any
 * type added there purely to get a nicer label would otherwise silently join
 * this set. Two types in the catalog are excluded on exactly that basis:
 *
 * - 11 (heart pulse) is reported by the blood-pressure monitor in the same
 *   group as systolic/diastolic, so treating it as a marker would admit every
 *   BP reading as a weigh-in.
 * - 4 (height) is recorded once at setup, not as part of a weigh-in.
 */
export const BODY_COMPOSITION_TYPES = new Set([
  1, // weight
  5, // fat-free mass
  6, // fat ratio
  8, // fat mass
  76, // muscle mass
  77, // hydration
  88, // bone mass
  122, // visceral fat
])

export function measureLabel(type: number): string {
  return MEASURE_TYPES_BY_TYPE.get(type)?.label ?? `Type ${type}`
}

export function measureSortKey(type: number): number {
  const index = MEASURE_TYPE_ORDER.indexOf(type)
  // Unknown types sort after every known one, in a stable (numeric) order.
  return index === -1 ? MEASURE_TYPE_ORDER.length + type : index
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

function decimalsFor(type: number): number {
  return MEASURE_TYPES_BY_TYPE.get(type)?.decimals ?? 1
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
