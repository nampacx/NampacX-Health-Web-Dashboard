/**
 * Daily rollups, for the data types that **cannot be listed at all**.
 *
 * `floors`, `total-calories` and `calories-in-heart-rate-zone` document only
 * `rollup` / `dailyRollUp` — asking `dataPoints.list` for them returns a 400
 * saying so in as many words. Two of the three sit in `DEFAULT_SELECTED_IDS`, so
 * until this existed the dashboard opened with two guaranteed errors in
 * `OutcomeSummary` and no floors or calories anywhere.
 *
 * This is a different endpoint, not a flag on the old one:
 *
 * - **`POST`, with a JSON body.** Everything else here is a GET with query
 *   parameters.
 * - **The range is civil and closed-open**, `{date:{year,month,day}}` per end,
 *   with the time omitted so it defaults to midnight. The start "must be aligned
 *   with the aggregation window", which for `windowSizeDays: 1` means a day
 *   boundary — the same midnight snapping the list filter already does.
 * - **The range is capped, and not uniformly.** 14 days for `total-calories`,
 *   `calories-in-heart-rate-zone`, `heart-rate` and `active-minutes`; 90 for
 *   everything else. Asking for the 90-day window against a 14-day type is a
 *   400, so the request is clamped and the outcome reports itself truncated —
 *   which is exactly what it is: more data exists than was fetched.
 * - **The response is `{rollupDataPoints}`**, each carrying `civilStartTime`,
 *   `civilEndTime` and one union member named after the data type in camelCase
 *   (`floors`, `totalCalories`, …). That is the same key `normalize.ts` already
 *   looks for, so a rollup point can go through the ordinary flattener unchanged
 *   and only its timestamp needs supplying.
 *
 * One trap in the response: **a window with no data omits the value entirely**
 * rather than sending a zero. Such a point still has `civilStartTime`, and
 * `extractPayload`'s "first object that is not envelope" fallback would happily
 * flatten *that* into a row reading "Year: 2,026". Valueless windows are dropped
 * before they ever reach the normalizer.
 */

import { API_BASE, HealthApiError, readApiMessage } from './apiCore'
import { normalizeDataPoint } from './normalize'
import type { DataTypeDef, HealthRecord } from './types'

/** `daily-resting-heart-rate` -> `dailyRestingHeartRate` */
function toCamelCase(dataTypeId: string): string {
  return dataTypeId.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

interface CivilDate {
  year: number
  month: number
  day: number
}

interface RollupPoint {
  civilStartTime?: { date?: Partial<CivilDate> }
  civilEndTime?: { date?: Partial<CivilDate> }
  [key: string]: unknown
}

interface RollupResponse {
  rollupDataPoints?: RollupPoint[]
  nextPageToken?: string
}

/**
 * Types whose rollup range the API caps at 14 days rather than 90. Named here
 * because the cap is a property of the endpoint, not of the data type — nothing
 * in the catalog would carry it usefully.
 */
const SHORT_RANGE_IDS = new Set([
  'total-calories',
  'calories-in-heart-rate-zone',
  'heart-rate',
  'active-minutes',
])

const LONG_RANGE_DAYS = 90
const SHORT_RANGE_DAYS = 14

export function maxRangeDays(dataType: DataTypeDef): number {
  return SHORT_RANGE_IDS.has(dataType.id) ? SHORT_RANGE_DAYS : LONG_RANGE_DAYS
}

function toCivilDate(date: Date): CivilDate {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfLocalDay(date: Date): Date {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  return start
}

export interface RollupWindow {
  start: CivilDate
  end: CivilDate
  /** True when the caller asked for a longer span than the API allows. */
  clamped: boolean
}

/**
 * The civil day range to roll up over.
 *
 * The end is exclusive and sits at tomorrow's midnight so that today is
 * included — a closed-open range ending today would stop at this morning.
 * `lookbackDays: 0` means "no time filter" everywhere else in the app, but this
 * endpoint requires a range, so it becomes the largest the type allows.
 */
export function rollupWindow(dataType: DataTypeDef, lookbackDays: number, now: Date): RollupWindow {
  const allowed = maxRangeDays(dataType)
  const wanted = lookbackDays > 0 ? lookbackDays : allowed
  const days = Math.min(wanted, allowed)

  const end = addDays(startOfLocalDay(now), 1)
  return {
    start: toCivilDate(addDays(end, -days)),
    end: toCivilDate(end),
    clamped: wanted > allowed,
  }
}

function describeRollupError(status: number, body: string, dataTypeId: string): string {
  const apiMessage = readApiMessage(body)
  switch (status) {
    case 400:
      return `Rollup rejected (400) for "${dataTypeId}". ${apiMessage}`.trim()
    case 401:
      return 'Access token rejected (401). Sign out and sign in again.'
    case 403:
      return `Forbidden (403) rolling up "${dataTypeId}". Check that the matching read scope was granted. ${apiMessage}`.trim()
    case 429:
      return 'Rate limited by the Google Health API (429). Try again shortly.'
    default:
      return `HTTP ${status} rolling up "${dataTypeId}". ${apiMessage}`.trim()
  }
}

export interface RollupOptions {
  accessToken: string
  pageSize: number
  lookbackDays: number
  /** Injectable for tests; defaults to the current instant. */
  now?: Date
}

export interface RollupResult {
  records: HealthRecord[]
  /** The window was cut to the endpoint's cap, so earlier days exist unfetched. */
  truncated: boolean
}

/**
 * Rolls one data type up into a record per civil day, newest-first.
 *
 * Records are shaped exactly like listed ones — the caller cannot tell the
 * difference, which is the point: `floors` should appear in the activity list
 * beside `steps` rather than in some parallel structure.
 */
export async function fetchDailyRollup(
  dataType: DataTypeDef,
  { accessToken, pageSize, lookbackDays, now = new Date() }: RollupOptions,
): Promise<RollupResult> {
  const window = rollupWindow(dataType, lookbackDays, now)

  const body = JSON.stringify({
    range: { start: { date: window.start }, end: { date: window.end } },
    windowSizeDays: 1,
    pageSize,
  })

  let response: Response
  try {
    response = await fetch(
      `${API_BASE}/users/me/dataTypes/${encodeURIComponent(dataType.id)}/dataPoints:dailyRollUp`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
      },
    )
  } catch (err) {
    throw new HealthApiError(
      `Network request failed rolling up "${dataType.id}". (${
        err instanceof Error ? err.message : String(err)
      })`,
      0,
      dataType.id,
    )
  }

  if (!response.ok) {
    const text = await response.text()
    throw new HealthApiError(
      describeRollupError(response.status, text, dataType.id),
      response.status,
      dataType.id,
    )
  }

  const payload = (await response.json()) as RollupResponse
  const valueKey = toCamelCase(dataType.id)

  const records = (payload.rollupDataPoints ?? [])
    // A window with no data omits the union member rather than sending zero.
    // Without this the normalizer would flatten `civilStartTime` into the row.
    .filter((point) => point[valueKey] !== undefined && point[valueKey] !== null)
    .map((point, index) => toRecord(point, dataType, index, valueKey))
    .sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0))

  return { records, truncated: window.clamped || Boolean(payload.nextPageToken) }
}

/** A civil date read as local, the same reading `normalize.ts` gives civil times. */
function civilDateToLocal(date: Partial<CivilDate> | undefined): Date | null {
  if (!date || !date.year || !date.month || !date.day) return null
  return new Date(date.year, date.month - 1, date.day)
}

function toRecord(
  point: RollupPoint,
  dataType: DataTypeDef,
  index: number,
  valueKey: string,
): HealthRecord {
  // The union member sits under the camelCase data-type name, which is exactly
  // what `extractPayload` looks for — so the ordinary flattener does the
  // formatting and only the timestamp has to be supplied.
  const record = normalizeDataPoint(point, dataType, index)
  const day = civilDateToLocal(point.civilStartTime?.date)

  return {
    ...record,
    key: day ? `${dataType.id}:rollup:${day.toDateString()}` : `${dataType.id}:rollup:${index}`,
    timestamp: day,
    // Named so a row that looks unfamiliar explains itself rather than looking
    // like a listed data point that lost its fields.
    source: `daily rollup · ${valueKey}`,
  }
}
