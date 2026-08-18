/**
 * Exercise sessions, for the Exercise sub-tab.
 *
 * **Deliberately not a typed schema.** Sleep needed one because a stage
 * timeline cannot survive the generic flattener; exercise does not have that
 * problem, and it has the opposite one — the fields differ per activity. A run
 * carries distance and pace, a swim carries lengths, a strength session carries
 * almost nothing. Pinning a shape would mean picking one activity to render
 * well and quietly dropping the rest.
 *
 * So this reads whatever `normalize.ts` already flattened out of the payload
 * and **ranks** it, rather than naming fields it requires. The documented names
 * (`metricsSummary.caloriesKcal`, `distanceMillimeters`, …) appear only in the
 * ranking patterns below, so if any of them is wrong the stat still shows up —
 * just further down the card. It cannot blank out the way the first sleep
 * parser did.
 */

import { exerciseDataPointId } from './exerciseTcx'
import { payloadLeaves, type PayloadLeaf } from './normalize'
import { localDateKey, parseDurationMs, parseInterval } from './time'
import type { HealthRecord, RawDataPoint } from './types'

export interface ExerciseStat extends PayloadLeaf {}

export interface ExerciseSession {
  key: string
  /** `displayName`, else a humanized `exerciseType`, else "Workout". */
  title: string
  exerciseType: string | null
  start: Date | null
  end: Date | null
  utcOffsetSeconds: number
  durationMs: number | null
  /** True when the duration came from `activeDuration`, which excludes pauses. */
  durationIsActive: boolean
  /** Most interesting first. */
  stats: ExerciseStat[]
  /** Lap / split count, 0 when the session has none. */
  splits: number
  /**
   * `metadata.hasGps`. The only trace of a route in the payload — the
   * coordinates themselves exist solely in the TCX export.
   */
  hasGps: boolean
  /**
   * Server-side id, for the TCX export. Null for a data point that arrived
   * without a resource name, which has nothing to export.
   */
  dataPointId: string | null
  raw: RawDataPoint
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * What a workout card leads with, most interesting first. Matched against the
 * leaf's path, so `metricsSummary.caloriesKcal` and a hypothetical
 * `summary.totalCalories` both land in the same slot.
 *
 * These are *hints*: an unmatched stat is not dropped, it sorts after the
 * matched ones in payload order.
 */
const STAT_ORDER: RegExp[] = [
  /calorie|kcal|energy/i,
  /distance/i,
  /(average|avg|mean).*heart|heart.*(average|avg|mean)/i,
  /(max|peak).*heart|heart.*(max|peak)/i,
  /heart|bpm/i,
  /pace|speed|velocity/i,
  /step/i,
  /zoneminutes|activeminutes/i,
  /elevation|ascent|descent|floor|altitude/i,
  /cadence/i,
  /power|watt/i,
  /lap|split|length|swolf|stroke/i,
]

function rankOf(path: string): number {
  const index = STAT_ORDER.findIndex((pattern) => pattern.test(path))
  return index === -1 ? STAT_ORDER.length : index
}

/**
 * Leaves that belong in the card's header rather than its stat grid, or that
 * carry no information at all.
 *
 * `flatten` renders an array of objects as `"3 entries"`, which is useless as a
 * stat — the interesting part of `splitSummaries` is its *count*, extracted
 * separately below.
 */
function isHeaderOrNoise(leaf: PayloadLeaf): boolean {
  const last = (leaf.path.split('.').pop() ?? '').toLowerCase()
  if (last === 'displayname' || last === 'exercisetype' || last === 'activeduration') return true
  // `hasGps` drives the route badge and the TCX button in the header. Left in the
  // grid it reads as "Has gps: No" on every treadmill session — a stat slot spent
  // on the absence of a feature.
  if (last === 'hasgps') return true
  if (/ entries$/.test(leaf.text)) return true
  return false
}

/** `RUNNING` -> `Running`, `HIGH_INTENSITY_INTERVAL_TRAINING` -> `High intensity…`. */
export function humanizeExerciseType(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Finds a leaf by the last segment of its path, case-insensitively. */
function leafBySegment(leaves: PayloadLeaf[], segment: string): PayloadLeaf | undefined {
  return leaves.find((leaf) => (leaf.path.split('.').pop() ?? '').toLowerCase() === segment)
}

/**
 * Counts laps. Looks for an array of objects under a key that reads like a
 * split rather than requiring `splitSummaries` exactly, so a renamed field
 * still counts.
 */
function countSplits(payload: Json): number {
  for (const [key, value] of Object.entries(payload)) {
    if (!/split|lap/i.test(key)) continue
    if (Array.isArray(value)) return value.length
  }
  return 0
}

/**
 * Whether the workout carries a GPS track. Tolerates the flag sitting at the
 * payload's top level as well as under `metadata`, the same latitude
 * `parseInterval` takes — the reference and the wire format have disagreed about
 * nesting before.
 */
function readHasGps(payload: Json): boolean {
  const metadata = isObject(payload.metadata) ? payload.metadata : {}
  const value = metadata.hasGps ?? payload.hasGps
  return value === true || value === 'true'
}

/** The payload object, with the same envelope fallback `sleepNights` uses. */
function extractPayload(raw: RawDataPoint): Json {
  if (isObject(raw.exercise)) return raw.exercise
  const found = Object.entries(raw).find(
    ([key, value]) => key !== 'name' && key !== 'dataSource' && isObject(value),
  )
  return found ? (found[1] as Json) : {}
}

export function parseExerciseRecord(record: HealthRecord): ExerciseSession {
  const payload = extractPayload(record.raw)
  const leaves = payloadLeaves(record.raw, record.dataType)

  const { start, end, offsetSeconds } = parseInterval(payload)

  const displayName =
    typeof payload.displayName === 'string' && payload.displayName
      ? payload.displayName
      : (leafBySegment(leaves, 'displayname')?.text ?? null)

  const exerciseType =
    typeof payload.exerciseType === 'string' && payload.exerciseType
      ? payload.exerciseType
      : (leafBySegment(leaves, 'exercisetype')?.text ?? null)

  // `activeDuration` excludes pauses, so it beats end - start when present.
  const activeMs = parseDurationMs(payload.activeDuration)
  const spanMs = start && end ? Math.max(0, end.getTime() - start.getTime()) : null

  const stats = leaves
    .filter((leaf) => !isHeaderOrNoise(leaf))
    // Stable by construction: `sort` is stable in every engine this runs on, so
    // equal ranks keep payload order.
    .sort((a, b) => rankOf(a.path) - rankOf(b.path))

  return {
    key: record.key,
    title: displayName ?? (exerciseType ? humanizeExerciseType(exerciseType) : 'Workout'),
    exerciseType,
    start,
    end,
    utcOffsetSeconds: offsetSeconds,
    durationMs: activeMs ?? spanMs,
    durationIsActive: activeMs !== null,
    stats,
    splits: countSplits(payload),
    hasGps: readHasGps(payload),
    dataPointId: exerciseDataPointId(record.raw.name),
    raw: record.raw,
  }
}

export interface ExerciseDayGroup {
  /** `2026-08-17` in the recording zone. */
  dateKey: string
  /** Midnight of that day, as a UTC-faced wall clock for formatting. */
  day: Date
  sessions: ExerciseSession[]
}

/** The exercise records, parsed and sorted newest-first. */
export function exerciseSessions(records: HealthRecord[]): ExerciseSession[] {
  return records
    .filter((record) => record.dataType.id === 'exercise')
    .map(parseExerciseRecord)
    .sort((a, b) => (b.start?.getTime() ?? 0) - (a.start?.getTime() ?? 0))
}

export interface ExerciseTotals {
  sessions: number
  durationMs: number
  /** Null when no session reported a calorie figure. */
  caloriesKcal: number | null
}

export interface ExerciseDayTotal {
  /** `2026-08-17` in the recording zone. */
  dateKey: string
  /** Midnight of that day, as a UTC-faced wall clock for formatting. */
  day: Date
  sessions: number
  durationMs: number
  byType: ExerciseDayTypeTotal[]
}

export interface ExerciseDayTypeTotal {
  typeKey: string
  label: string
  sessions: number
  durationMs: number
}

function dateFromKey(dateKey: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return new Date(0)
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

/**
 * Window totals for the strip above the cards.
 *
 * Calories are summed only from leaves whose path says `kcal` — the one unit
 * the field name reliably carries. A joules field would otherwise be added to a
 * kcal one and the total would be nonsense, which is worse than no total.
 */
export function exerciseTotals(sessions: ExerciseSession[]): ExerciseTotals {
  let durationMs = 0
  let calories = 0
  let sawCalories = false

  for (const session of sessions) {
    durationMs += session.durationMs ?? 0
    for (const stat of session.stats) {
      if (stat.numeric === null || !/kcal/i.test(stat.path)) continue
      calories += stat.numeric
      sawCalories = true
      // One calorie figure per session; a splits breakdown would double-count.
      break
    }
  }

  return {
    sessions: sessions.length,
    durationMs,
    caloriesKcal: sawCalories ? calories : null,
  }
}

/**
 * Daily workout totals for the summary chart.
 *
 * A day is the session's own recording day, through `startUtcOffset`, not the
 * viewer's current time zone. Multiple workouts on the same day collapse into
 * one bar by summing the same duration the cards show.
 */
export function exerciseDailyTotals(sessions: ExerciseSession[]): ExerciseDayTotal[] {
  const byDate = new Map<string, ExerciseDayTotal>()
  const byDateType = new Map<string, Map<string, ExerciseDayTypeTotal>>()

  for (const session of [...sessions].sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0))) {
    if (!session.start) continue
    const dateKey = localDateKey(session.start, session.utcOffsetSeconds)
    const typeKey = session.exerciseType ?? 'unknown'
    const typeLabel = session.exerciseType ? humanizeExerciseType(session.exerciseType) : 'Other workouts'
    const durationMs = session.durationMs ?? 0
    const current = byDate.get(dateKey)
    if (current) {
      current.sessions += 1
      current.durationMs += durationMs
    } else {
      byDate.set(dateKey, {
        dateKey,
        day: dateFromKey(dateKey),
        sessions: 1,
        durationMs,
        byType: [],
      })
    }
    const typeTotals = byDateType.get(dateKey) ?? new Map<string, ExerciseDayTypeTotal>()
    const currentType = typeTotals.get(typeKey)
    if (currentType) {
      currentType.sessions += 1
      currentType.durationMs += durationMs
    } else {
      typeTotals.set(typeKey, {
        typeKey,
        label: typeLabel,
        sessions: 1,
        durationMs,
      })
    }
    byDateType.set(dateKey, typeTotals)
  }

  return [...byDate.values()].map((day) => ({
    ...day,
    byType: [...(byDateType.get(day.dateKey)?.values() ?? [])].sort(
      (a, b) => b.durationMs - a.durationMs || b.sessions - a.sessions || a.label.localeCompare(b.label),
    ),
  }))
}

/**
 * Groups sessions (newest-first) into per-day buckets, preserving order.
 *
 * The day key is derived from the session's own recording zone, so the same
 * midnight rule as `exerciseDailyTotals` applies.
 */
export function groupSessionsByDay(sessions: ExerciseSession[]): ExerciseDayGroup[] {
  const byDate = new Map<string, ExerciseDayGroup>()
  // Preserve insertion order (newest first) while grouping.
  for (const session of sessions) {
    if (!session.start) continue
    const dateKey = localDateKey(session.start, session.utcOffsetSeconds)
    const current = byDate.get(dateKey)
    if (current) {
      current.sessions.push(session)
    } else {
      byDate.set(dateKey, {
        dateKey,
        day: dateFromKey(dateKey),
        sessions: [session],
      })
    }
  }
  return [...byDate.values()]
}
