/**
 * Time handling shared by the session data types (sleep, exercise).
 *
 * The one rule here: **a session carries the UTC offset it was recorded at, and
 * it must be rendered through it.** A `20:18Z` bedtime is 22:18 at +02:00.
 * Formatting the raw instant in the browser's zone agrees only while the viewer
 * happens to sit at the same offset the device did, and lies silently after any
 * travel — which is the failure mode you never notice, because every timestamp
 * is wrong by the same amount and so they all still look consistent.
 */

export interface SessionInterval {
  start: Date | null
  end: Date | null
  /** Offset in effect where the session was recorded, in seconds. */
  offsetSeconds: number
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `"7200s"` -> 7200. Absent or unparseable means "no offset known". */
export function parseOffsetSeconds(value: unknown): number {
  if (typeof value !== 'string') return 0
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(value.trim())
  return match ? Number(match[1]) : 0
}

/** Protobuf durations serialise as `"1800s"`. Returns milliseconds. */
export function parseDurationMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(value.trim())
  return match ? Number(match[1]) * 1000 : null
}

export function parseTime(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * The wall clock the user saw, as a Date whose **UTC** getters read as local
 * time at the recording site. Only ever formatted with `getUTC*` (or an
 * `Intl` formatter pinned to `timeZone: 'UTC'`); treating it as an instant
 * would be wrong by exactly the offset.
 */
export function wallClock(instant: Date, offsetSeconds: number): Date {
  return new Date(instant.getTime() + offsetSeconds * 1000)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `22:18` in the recording zone. 24-hour: a session can cross midnight. */
export function clockLabel(instant: Date, offsetSeconds: number): string {
  const shifted = wallClock(instant, offsetSeconds)
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
}

/** `2026-08-17` in the recording zone — the key daily metrics are filed under. */
export function localDateKey(instant: Date, offsetSeconds: number): string {
  const shifted = wallClock(instant, offsetSeconds)
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

/**
 * Reads the session bounds, whether nested under `interval` (what the API
 * sends) or sitting at the payload's top level (what the RPC reference claims).
 */
export function parseInterval(payload: unknown): SessionInterval {
  const source = isObject(payload) ? payload : {}
  const interval = isObject(source.interval) ? source.interval : source
  return {
    start: parseTime(interval.startTime),
    end: parseTime(interval.endTime),
    offsetSeconds: parseOffsetSeconds(interval.startUtcOffset),
  }
}
