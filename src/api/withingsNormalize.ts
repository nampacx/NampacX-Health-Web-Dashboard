/**
 * Turns raw Withings measure groups into renderable `MeasureGroup`s.
 *
 * Deliberately independent of src/api/normalize.ts: Withings sends typed
 * `{value, type, unit}` triples, so there is no structural-inference problem
 * to solve, and normalize.ts's unit rules are keyed on Google's field-name
 * suffixes — reusing it would mean widening a Google-shaped API for nothing.
 */

import { BODY_COMPOSITION_TYPES, MEASURE_TYPES_BY_ID, labelFor, sortKeyFor } from './withingsMeasureTypes'
import type { Measure, MeasureGroup, MeasureProvenance, RawMeasureGroup } from './withingsTypes'

/**
 * `value * 10 ** unit` is the formula Withings documents, but `10 ** -unit`
 * is not exact in binary and produces artefacts like `2340 * 10 ** -2 ===
 * 23.400000000000002` (verified in Node). Dividing and rounding to the same
 * number of decimals avoids it.
 */
export function scaleValue(value: number, unit: number): number {
  if (unit >= 0) return value * 10 ** unit
  const scale = 10 ** -unit
  return Number((value / scale).toFixed(-unit))
}

/**
 * `attrib` encodes provenance. Withings' own documentation of the exact
 * enumeration is inconsistent across API versions, so this collapses it to
 * three buckets a user actually cares about, erring toward "device" — a
 * false "manual" label is more likely to make someone doubt real data than a
 * false "device" label is to hide something.
 */
export function provenanceFor(attrib: number): MeasureProvenance {
  if (attrib === 2 || attrib === 4) return 'manual'
  if (attrib === 0 || attrib === 1) return 'device'
  return 'auto'
}

function normalizeMeasure(raw: { value: number; type: number; unit: number }): Measure {
  const def = MEASURE_TYPES_BY_ID.get(raw.type)
  return {
    type: raw.type,
    label: labelFor(raw.type),
    unit: def?.unit ?? '',
    value: scaleValue(raw.value, raw.unit),
  }
}

/** A group belongs in the body-composition section if any measure does. */
export function isBodyCompositionGroup(group: RawMeasureGroup): boolean {
  return group.measures.some((m) => BODY_COMPOSITION_TYPES.has(m.type))
}

export function normalizeMeasureGroup(raw: RawMeasureGroup): MeasureGroup {
  const measures = raw.measures
    .map(normalizeMeasure)
    .sort((a, b) => sortKeyFor(a.type) - sortKeyFor(b.type))

  return {
    key: String(raw.grpid),
    date: new Date(raw.date * 1000),
    provenance: provenanceFor(raw.attrib),
    measures,
    raw,
  }
}

/**
 * Filters to real measurements in the body-composition family, normalizes,
 * dedupes by group id (paginated responses can overlap at the boundary), and
 * sorts newest-first.
 *
 * `category !== 1` is filtered here even though callers are expected to have
 * already requested `category=1` from the API — a weight *goal* must never
 * render as a weigh-in, and this makes that true regardless of what the
 * caller asked for.
 */
export function normalizeGetMeasResponse(groups: RawMeasureGroup[]): MeasureGroup[] {
  const byId = new Map<string, MeasureGroup>()

  for (const raw of groups) {
    if (raw.category !== 1) continue
    if (!isBodyCompositionGroup(raw)) continue
    const normalized = normalizeMeasureGroup(raw)
    byId.set(normalized.key, normalized)
  }

  return Array.from(byId.values()).sort((a, b) => b.date.getTime() - a.date.getTime())
}
