/**
 * Sleep-specific parsing, deliberately outside normalize.ts.
 *
 * normalize.ts is structural on purpose — it flattens an unknown payload into
 * label/value chips and never hard-codes a data type's shape. That is the right
 * default, and it is exactly why sleep reads so thin today: `sleepStages` is an
 * array of objects, so the generic flattener collapses the whole night to
 * "Sleep stages: 34 entries". A stage timeline cannot be recovered from a
 * flattener, so sleep gets a typed parser of its own here and normalize.ts is
 * left alone.
 *
 * Field names follow the v4 REST JSON (camelCase) of
 * google.devicesandservices.health.v4.Sleep.
 */

import type { HealthRecord } from './types'

export type SleepStage = 'awake' | 'rem' | 'light' | 'deep'

/**
 * One order, used by the hypnogram lanes, the composition bar, the legend and
 * the table alike. Top-to-bottom awake→deep is the conventional hypnogram
 * layout, and reusing it everywhere means the legend never has to be re-read.
 */
export const SLEEP_STAGES: readonly SleepStage[] = ['awake', 'rem', 'light', 'deep']

export const SLEEP_STAGE_LABELS: Record<SleepStage, string> = {
  awake: 'Awake',
  rem: 'REM',
  light: 'Light',
  deep: 'Deep',
}

/** The three that count as asleep. Awake time inside the session does not. */
export const ASLEEP_STAGES: readonly SleepStage[] = ['rem', 'light', 'deep']

export interface StageSegment {
  stage: SleepStage
  start: Date
  end: Date
  durationMs: number
}

export interface SleepNight {
  key: string
  start: Date | null
  end: Date | null
  /** SLEEP / SLEEP_NAP / … lower-cased for display, or null. */
  sleepType: string | null
  /**
   * False when the device reported STAGES_UNAVAILABLE, or when no stages came
   * back at all. A phone-tracked night has a duration and nothing else, and
   * must not be drawn as an empty hypnogram.
   */
  stagesAvailable: boolean
  segments: StageSegment[]
  /** Milliseconds per stage. Absent stages are 0, never missing. */
  totals: Record<SleepStage, number>
  /** REM + light + deep. */
  timeAsleepMs: number
  /** end − start, i.e. the whole session including awake time. */
  timeInBedMs: number
  /** timeAsleep / timeInBed as a percentage, or null when unknowable. */
  efficiency: number | null
  /**
   * Awake segments longer than five minutes. Derived here, not reported by the
   * API — Google's own Sleep Score uses the same five-minute threshold for a
   * "full awakening", so this is the closest honest reconstruction.
   */
  fullAwakenings: number
  outOfBedMs: number
  raw: unknown
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `SLEEP_STAGE_DEEP` and a bare `DEEP` both appear in the wild; accept either. */
export function parseStageType(value: unknown): SleepStage | null {
  if (typeof value !== 'string') return null
  const name = value.toUpperCase().replace(/^SLEEP_STAGE_/, '').replace(/^SLEEP_/, '')
  switch (name) {
    case 'AWAKE':
      return 'awake'
    case 'REM':
      return 'rem'
    case 'LIGHT':
      return 'light'
    case 'DEEP':
      return 'deep'
    default:
      // UNSPECIFIED, UNKNOWN, or something new. Dropped rather than guessed --
      // a mislabelled stage is worse than a gap in the timeline.
      return null
  }
}

/** Protobuf durations serialise as `"1800s"` or `"1800.5s"`. */
export function parseDurationMs(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value * 1000 : 0
  if (typeof value !== 'string') return 0
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(value.trim())
  return match ? Number(match[1]) * 1000 : 0
}

function parseTime(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function emptyTotals(): Record<SleepStage, number> {
  return { awake: 0, rem: 0, light: 0, deep: 0 }
}

function parseSegments(value: unknown): StageSegment[] {
  if (!Array.isArray(value)) return []
  const segments: StageSegment[] = []

  for (const entry of value) {
    if (!isObject(entry)) continue
    const stage = parseStageType(entry.stageType)
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

/**
 * Totals come from `sleepSummary.stageSummaries` when the API sent it, and are
 * summed from the segments otherwise.
 *
 * Preferring the API's own summary means the numbers here match what the Google
 * Health app shows, which is the comparison anyone will actually make. It does
 * mean the totals and the hypnogram are computed from different fields; if they
 * ever disagree the raw JSON is on the card to settle it.
 */
function parseTotals(summary: unknown, segments: StageSegment[]): Record<SleepStage, number> {
  const totals = emptyTotals()

  const stageSummaries = isObject(summary) ? summary.stageSummaries : undefined
  if (Array.isArray(stageSummaries) && stageSummaries.length > 0) {
    let matched = 0
    for (const entry of stageSummaries) {
      if (!isObject(entry)) continue
      const stage = parseStageType(entry.stageType)
      if (!stage) continue
      totals[stage] += parseDurationMs(entry.duration)
      matched++
    }
    if (matched > 0) return totals
  }

  for (const segment of segments) totals[segment.stage] += segment.durationMs
  return totals
}

function sumOutOfBed(value: unknown): number {
  if (!Array.isArray(value)) return 0
  let total = 0
  for (const entry of value) {
    if (!isObject(entry)) continue
    const start = parseTime(entry.startTime)
    const end = parseTime(entry.endTime)
    if (start && end && end > start) total += end.getTime() - start.getTime()
  }
  return total
}

const FULL_AWAKENING_MS = 5 * 60 * 1000

/** Parses one `sleep` payload — the object under the data point's `sleep` key. */
export function parseSleepPayload(payload: unknown, key: string, raw: unknown): SleepNight {
  const sleep = isObject(payload) ? payload : {}

  const start = parseTime(sleep.startTime)
  const end = parseTime(sleep.endTime)
  const segments = parseSegments(sleep.sleepStages)
  const totals = parseTotals(sleep.sleepSummary, segments)

  const metadata = isObject(sleep.sleepMetadata) ? sleep.sleepMetadata : {}
  const stagesUnavailable = metadata.stagesState === 'STAGES_UNAVAILABLE'

  const timeAsleepMs = ASLEEP_STAGES.reduce((total, stage) => total + totals[stage], 0)
  const timeInBedMs = start && end ? Math.max(0, end.getTime() - start.getTime()) : 0

  return {
    key,
    start,
    end,
    sleepType: typeof sleep.sleepType === 'string' ? sleep.sleepType : null,
    stagesAvailable: !stagesUnavailable && segments.length > 0,
    segments,
    totals,
    timeAsleepMs,
    timeInBedMs,
    efficiency: timeInBedMs > 0 && timeAsleepMs > 0 ? (timeAsleepMs / timeInBedMs) * 100 : null,
    fullAwakenings: segments.filter(
      (segment) => segment.stage === 'awake' && segment.durationMs > FULL_AWAKENING_MS,
    ).length,
    outOfBedMs: sumOutOfBed(sleep.outOfBedSegments),
    raw,
  }
}

/**
 * Pulls the sleep nights out of a mixed record list, newest first.
 *
 * Reads `record.raw` rather than the normalized chips: the chips have already
 * lost the stage array by the time they exist.
 */
export function sleepNights(records: HealthRecord[]): SleepNight[] {
  return records
    .filter((record) => record.dataType.id === 'sleep')
    .map((record, index) =>
      parseSleepPayload(record.raw.sleep, record.key || `sleep:${index}`, record.raw),
    )
    .sort((a, b) => (b.start?.getTime() ?? 0) - (a.start?.getTime() ?? 0))
}

/** `7 h 42 min`, the format every duration on the sleep view uses. */
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
