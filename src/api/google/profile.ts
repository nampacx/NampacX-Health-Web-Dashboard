/**
 * The user's Google Health profile — `GET users/me/profile`, behind
 * `googlehealth.profile.readonly`.
 *
 * **Not a data point**, so none of the `dataPoints` machinery applies: it lives
 * at its own endpoint, there is exactly one of it, it has no observation time,
 * and it never appears in a `FetchOutcome`. It also gets a typed parser rather
 * than the structural flattener, which is not a contradiction of the rule in
 * `normalize.ts` — that rule exists because data-type payloads are undocumented
 * and grow new fields. This resource is five documented fields and cannot sprout
 * an array of stage segments.
 *
 * Two field-level surprises worth keeping in mind:
 *
 * - **The stride lengths are gated on a second scope.** `profile.readonly` gets
 *   you the resource, but every `*StrideLengthMm` field additionally requires an
 *   `activity_and_fitness` scope. We ask for both, so they arrive — but a token
 *   holding only `profile.readonly` gets a profile with the strides silently
 *   absent, not a 403. Hence `null` rather than an error for a missing stride.
 * - **`membershipStartDate` is a civil date, not an instant.** It is
 *   `{year, month, day}` with no zone, so it must never go through
 *   `new Date(y, m, d)` in the browser's zone — west of UTC that renders the day
 *   before. `formatCivilDate` pins the formatter to UTC, the same trick
 *   `time.ts` uses for session wall clocks.
 */

import { API_BASE, HealthApiError, readApiMessage } from './healthApi'

/** A `google.type.Date`: a calendar date with no time zone attached. */
export interface CivilDate {
  year: number
  month: number
  day: number
}

export interface StrideLength {
  /** What the user entered in the Google Health app. Null when they never did. */
  configuredMm: number | null
  /** What the device derived from GPS. Null when it never had enough to go on. */
  autoMm: number | null
}

export interface HealthProfile {
  /** Age in years, derived by Google from the birth date. Never the birth date. */
  ageYears: number | null
  /** The day the account was created. */
  memberSince: CivilDate | null
  walking: StrideLength
  running: StrideLength
  raw: unknown
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The reference types the stride lengths as `integer`, but int64 fields elsewhere
 * in this API arrive as strings, so both are accepted — the same latitude
 * `normalize.ts` takes.
 */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value)
  return null
}

/**
 * A `google.type.Date` may legitimately zero out parts it does not know (a
 * year-only date, say). Anything short of a full y/m/d is treated as absent
 * rather than guessed at.
 */
function parseCivilDate(value: unknown): CivilDate | null {
  if (!isObject(value)) return null
  const year = asNumber(value.year)
  const month = asNumber(value.month)
  const day = asNumber(value.day)
  if (year === null || month === null || day === null) return null
  if (year <= 0 || month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

export function parseHealthProfile(body: unknown): HealthProfile {
  const source = isObject(body) ? body : {}
  return {
    ageYears: asNumber(source.age),
    memberSince: parseCivilDate(source.membershipStartDate),
    walking: {
      configuredMm: asNumber(source.userConfiguredWalkingStrideLengthMm),
      autoMm: asNumber(source.autoWalkingStrideLengthMm),
    },
    running: {
      configuredMm: asNumber(source.userConfiguredRunningStrideLengthMm),
      autoMm: asNumber(source.autoRunningStrideLengthMm),
    },
    raw: body,
  }
}

/** True when the profile came back but every field in it was empty. */
export function isProfileEmpty(profile: HealthProfile): boolean {
  return (
    profile.ageYears === null &&
    profile.memberSince === null &&
    profile.walking.configuredMm === null &&
    profile.walking.autoMm === null &&
    profile.running.configuredMm === null &&
    profile.running.autoMm === null
  )
}

// timeZone: 'UTC' against a UTC-constructed instant, so the calendar date the
// API sent is the calendar date rendered — in every viewer's zone.
const civilDateFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})

export function formatCivilDate(date: CivilDate): string {
  return civilDateFormat.format(new Date(Date.UTC(date.year, date.month - 1, date.day)))
}

const strideFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

/** Strides run 50–200 cm, so centimetres keep it one readable number. */
export function formatStrideLength(millimeters: number): string {
  return `${strideFormat.format(millimeters / 10)} cm`
}

export const PROFILE_ENDPOINT = `${API_BASE}/users/me/profile`

function describeProfileError(status: number, body: string): string {
  const apiMessage = readApiMessage(body)
  switch (status) {
    case 401:
      return 'Access token rejected (401). Sign out and sign in again.'
    case 403:
      return `Forbidden (403) reading your health profile. The googlehealth.profile.readonly scope has to be granted on the OAuth client and consented to at sign-in. ${apiMessage}`.trim()
    case 404:
      return `No health profile found (404). ${apiMessage}`.trim()
    default:
      return `HTTP ${status} reading your health profile. ${apiMessage}`.trim()
  }
}

/**
 * Reads the profile. Throws `HealthApiError` so callers can tell a missing scope
 * (403 — expected until consent is re-granted) from a real fault.
 */
export async function fetchHealthProfile(accessToken: string): Promise<HealthProfile> {
  let response: Response
  try {
    response = await fetch(PROFILE_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
  } catch (err) {
    throw new HealthApiError(
      `Network request failed reading your health profile. (${
        err instanceof Error ? err.message : String(err)
      })`,
      0,
    )
  }

  if (!response.ok) {
    const body = await response.text()
    throw new HealthApiError(describeProfileError(response.status, body), response.status)
  }

  return parseHealthProfile(await response.json())
}
