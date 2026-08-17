/**
 * Sleep-specific parsing, deliberately outside normalize.ts.
 *
 * normalize.ts is structural on purpose — it flattens an unknown payload into
 * label/value chips and never hard-codes a data type's shape. That is the right
 * default, and it is exactly why sleep read so thin: `stages` is an array of
 * objects, so the generic flattener collapses a whole night to
 * "Stages: 23 entries". A stage timeline cannot be recovered from a flattener,
 * so sleep gets a typed parser of its own here and normalize.ts is left alone.
 *
 * **Field names come from a real payload** (see sleepNight.fixture.ts), not from
 * the proto reference at developers.google.com. Those disagree, and the docs
 * lose: the RPC page documents `sleep_stages[].stage_type = "SLEEP_STAGE_DEEP"`
 * where the REST JSON actually sends `stages[].type = "DEEP"`. Alternate names
 * are accepted below where it is free to do so, but the fixture is the
 * authority. If a field ever needs adding, get a real payload first.
 */

import { parseInterval, parseTime } from './time'
import type { HealthRecord } from './types'

// Re-exported so sleep's own consumers keep one import; the implementations
// live in time.ts because exercise sessions need exactly the same handling.
export { clockLabel, localDateKey, parseOffsetSeconds, wallClock } from './time'

export type SleepStage = 'awake' | 'rem' | 'light' | 'deep'

/**
 * One order, used by the hypnogram lanes, the composition bar, the legend and
 * the totals alike. Top-to-bottom awake→deep is the conventional hypnogram
 * layout, and reusing it everywhere means the legend never has to be re-read.
 */
export const SLEEP_STAGES: readonly SleepStage[] = ['awake', 'rem', 'light', 'deep']

export const SLEEP_STAGE_LABELS: Record<SleepStage, string> = {
  awake: 'Awake',
  rem: 'REM',
  light: 'Light',
  deep: 'Deep',
}

export const SLEEP_STAGE_DESCRIPTIONS: Record<SleepStage, string> = {
  awake:
    'Brief awakenings are normal and do not significantly affect recovery. ' +
    'Frequent or prolonged waking can disrupt restorative sleep and leave you feeling tired.',
  rem:
    'REM (Rapid Eye Movement) sleep is when most dreaming occurs. ' +
    'It supports memory consolidation, emotional processing, and mental recovery. ' +
    'Adults typically spend 20–25 % of the night in REM.',
  light:
    'Light sleep (N1 and N2) is the transition between wakefulness and deeper sleep. ' +
    'It aids memory consolidation and helps the body relax. ' +
    'Most adults spend about half the night here.',
  deep:
    'Deep sleep (slow-wave sleep, N3) is the most physically restorative stage. ' +
    'The body repairs tissue, builds bone and muscle, and strengthens the immune system. ' +
    'More deep sleep generally means better physical recovery.',
}

export interface StageSegment {
  stage: SleepStage
  start: Date
  end: Date
  durationMs: number
}

export interface SleepNight {
  key: string
  /** True instants. Render them through `utcOffsetSeconds`, never raw. */
  start: Date | null
  end: Date | null
  /**
   * Offset in effect where the night was recorded, from `startUtcOffset`.
   *
   * Load-bearing: this night's `20:18Z` is a 22:18 bedtime at +02:00. Formatting
   * the instant in the *browser's* zone happens to agree only while the viewer
   * sits in the same offset the watch did, and silently lies after any travel.
   */
  utcOffsetSeconds: number
  /** `STAGES`, `CLASSIC`, … — how the device tracked the night. */
  trackingType: string | null
  /** False for a nap, per `metadata.mainSleep`. */
  isMainSleep: boolean
  stagesAvailable: boolean
  segments: StageSegment[]
  /** Milliseconds per stage. Absent stages are 0, never missing. */
  totals: Record<SleepStage, number>
  /** Episodes per stage, from `stagesSummary[].count`. 0 when not reported. */
  episodes: Record<SleepStage, number>
  timeAsleepMs: number
  /** The whole session including awake time (`minutesInSleepPeriod`). */
  timeInBedMs: number
  awakeMs: number
  /** `minutesToFallAsleep`, i.e. sleep latency. Null when not reported. */
  fallAsleepMs: number | null
  /** timeAsleep / timeInBed as a percentage, or null when unknowable. */
  efficiency: number | null
  /**
   * Count of `shortAwakenings` — brief arousals the device tracks separately
   * from the stage timeline. Not the same as the awake *episodes* in `totals`,
   * and the closest thing in the payload to the Sleep Score's "restlessness".
   */
  shortAwakenings: number
  raw: unknown
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** int64 and duration-minute fields arrive as JSON strings. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value)
  return null
}

/**
 * Accepts the real `"DEEP"` and the proto reference's `"SLEEP_STAGE_DEEP"`,
 * because the two spellings cost nothing to support together and the docs still
 * claim the latter.
 */
export function parseStageType(value: unknown): SleepStage | null {
  if (typeof value !== 'string') return null
  const name = value.toUpperCase().replace(/^SLEEP_STAGE_/, '').replace(/^SLEEP_/, '')
  switch (name) {
    case 'AWAKE':
    case 'WAKE':
      return 'awake'
    case 'REM':
      return 'rem'
    case 'LIGHT':
      return 'light'
    case 'DEEP':
      return 'deep'
    default:
      // UNSPECIFIED, ASLEEP (classic tracking), or something new. Dropped
      // rather than guessed -- a mislabelled stage is worse than a gap.
      return null
  }
}

function emptyTotals(): Record<SleepStage, number> {
  return { awake: 0, rem: 0, light: 0, deep: 0 }
}

function parseSegments(value: unknown): StageSegment[] {
  if (!Array.isArray(value)) return []
  const segments: StageSegment[] = []

  for (const entry of value) {
    if (!isObject(entry)) continue
    const stage = parseStageType(entry.type ?? entry.stageType)
    const start = parseTime(entry.startTime)
    const end = parseTime(entry.endTime)
    if (!stage || !start || !end) continue
    const durationMs = end.getTime() - start.getTime()
    // A zero- or negative-length segment would render as an invisible sliver
    // and skew the totals; there is nothing to show.
    if (durationMs <= 0) continue
    segments.push({ stage, start, end, durationMs })
  }

  return segments.sort((a, b) => a.start.getTime() - b.start.getTime())
}

interface SummaryTotals {
  totals: Record<SleepStage, number>
  episodes: Record<SleepStage, number>
  matched: boolean
}

/**
 * `summary.stagesSummary[]` gives per-stage minutes and an episode count.
 *
 * Preferring it over summing the segments means the numbers match what the
 * Google Health app shows, which is the comparison anyone will actually make.
 * On the fixture night the two differ by half a minute per stage — the segments
 * carry :30 boundaries and the summary is whole minutes.
 */
function parseStagesSummary(summary: unknown): SummaryTotals {
  const totals = emptyTotals()
  const episodes = emptyTotals()

  const rows = isObject(summary) ? (summary.stagesSummary ?? summary.stageSummaries) : undefined
  if (!Array.isArray(rows)) return { totals, episodes, matched: false }

  let matched = false
  for (const row of rows) {
    if (!isObject(row)) continue
    const stage = parseStageType(row.type ?? row.stageType)
    if (!stage) continue
    const minutes = asNumber(row.minutes)
    if (minutes !== null) {
      totals[stage] += minutes * 60_000
      matched = true
    }
    episodes[stage] += asNumber(row.count) ?? 0
  }

  return { totals, episodes, matched }
}

/** Parses one `sleep` payload — the object under the data point's `sleep` key. */
export function parseSleepPayload(payload: unknown, key: string, raw: unknown): SleepNight {
  const sleep = isObject(payload) ? payload : {}

  const { start, end, offsetSeconds } = parseInterval(sleep)
  const segments = parseSegments(sleep.stages ?? sleep.sleepStages)

  const summary = isObject(sleep.summary)
    ? sleep.summary
    : isObject(sleep.sleepSummary)
      ? sleep.sleepSummary
      : {}
  const fromSummary = parseStagesSummary(summary)

  const totals = fromSummary.matched ? fromSummary.totals : emptyTotals()
  if (!fromSummary.matched) {
    for (const segment of segments) totals[segment.stage] += segment.durationMs
  }

  const metadata = isObject(sleep.metadata)
    ? sleep.metadata
    : isObject(sleep.sleepMetadata)
      ? sleep.sleepMetadata
      : {}

  const spanMs = start && end ? Math.max(0, end.getTime() - start.getTime()) : 0
  const minutesInBed = asNumber(summary.minutesInSleepPeriod)
  const timeInBedMs = minutesInBed !== null ? minutesInBed * 60_000 : spanMs

  const minutesAsleep = asNumber(summary.minutesAsleep)
  const timeAsleepMs =
    minutesAsleep !== null
      ? minutesAsleep * 60_000
      : totals.rem + totals.light + totals.deep

  const minutesAwake = asNumber(summary.minutesAwake)
  const minutesToFallAsleep = asNumber(summary.minutesToFallAsleep)

  return {
    key,
    start,
    end,
    utcOffsetSeconds: offsetSeconds,
    trackingType: typeof sleep.type === 'string' ? sleep.type : null,
    // Absent `mainSleep` means "not a device that distinguishes naps", which
    // reads better as a main sleep than as a nap.
    isMainSleep: metadata.mainSleep !== false,
    stagesAvailable: segments.length > 0,
    segments,
    totals,
    episodes: fromSummary.episodes,
    timeAsleepMs,
    timeInBedMs,
    awakeMs: minutesAwake !== null ? minutesAwake * 60_000 : totals.awake,
    fallAsleepMs: minutesToFallAsleep !== null ? minutesToFallAsleep * 60_000 : null,
    efficiency: timeInBedMs > 0 && timeAsleepMs > 0 ? (timeAsleepMs / timeInBedMs) * 100 : null,
    shortAwakenings: Array.isArray(sleep.shortAwakenings) ? sleep.shortAwakenings.length : 0,
    raw,
  }
}

/**
 * Pulls the sleep nights out of a mixed record list, newest first.
 *
 * Reads `record.raw` rather than the normalized chips: the chips have already
 * lost the stage array by the time they exist. Falls back to searching the
 * envelope for a payload object, so a renamed key degrades instead of blanking
 * every card — which is precisely how the first version failed.
 */
export function sleepNights(records: HealthRecord[]): SleepNight[] {
  return records
    .filter((record) => record.dataType.id === 'sleep')
    .map((record, index) => {
      const direct = record.raw.sleep
      const payload = isObject(direct)
        ? direct
        : Object.entries(record.raw).find(
            ([envelopeKey, value]) =>
              envelopeKey !== 'name' && envelopeKey !== 'dataSource' && isObject(value),
          )?.[1]
      return parseSleepPayload(payload, record.key || `sleep:${index}`, record.raw)
    })
    .sort((a, b) => (b.start?.getTime() ?? 0) - (a.start?.getTime() ?? 0))
}

/** `7 h 48 min`, the format every duration on the sleep view uses. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
  return `${minutes} min`
}

/** Share of the session spent in a stage, as a 0–100 percentage. */
export function stageShare(night: SleepNight, stage: SleepStage): number {
  const total = SLEEP_STAGES.reduce((sum, each) => sum + night.totals[each], 0)
  return total > 0 ? (night.totals[stage] / total) * 100 : 0
}
