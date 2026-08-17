/**
 * The one place the two providers meet.
 *
 * Everything else is deliberately split into api/google and api/withings, which
 * share nothing. The technical-details view is the exception: it lists every
 * observation from both, newest first, so the raw payloads can be compared. It
 * flattens both shapes to the least common denominator on purpose — the
 * provider tabs render each properly.
 */

import type { HealthRecord } from './google/types'
import { formatMeasureValue } from './withings/measureTypes'
import type { MeasureGroup } from './withings/types'

export interface CombinedEntry {
  key: string
  provider: 'Google' | 'Withings'
  label: string
  summary: string
  at: Date | null
  raw: unknown
}

export function toCombinedEntries(
  records: HealthRecord[],
  groups: MeasureGroup[],
): CombinedEntry[] {
  const fromGoogle = records.map<CombinedEntry>((record) => ({
    // Both providers mint their own keys, so namespace them before merging.
    key: `google:${record.key}`,
    provider: 'Google',
    label: record.dataType.label,
    summary: record.summary ?? 'No readable value',
    at: record.timestamp,
    raw: record.raw,
  }))

  const fromWithings = groups.map<CombinedEntry>((group) => ({
    key: `withings:${group.key}`,
    provider: 'Withings',
    label: 'Weigh-in',
    summary: group.measures.map(formatMeasureValue).join(' · ') || 'No measures',
    at: group.date,
    raw: group.raw,
  }))

  return [...fromGoogle, ...fromWithings].sort((a, b) => {
    // Undated entries sink to the bottom rather than scrambling the order,
    // matching how healthApi.ts sorts its own records.
    const at = a.at?.getTime() ?? -Infinity
    const bt = b.at?.getTime() ?? -Infinity
    return bt - at
  })
}
