import { timeFilter, type FilterDialect } from './dataPointFilter'
import type { DataTypeDef, FetchOutcome, HealthRecord, ListDataPointsResponse } from './types'
import { normalizeDataPoint } from './normalize'

// health.googleapis.com returns Access-Control-Allow-Origin for arbitrary
// origins and permits the `authorization` header, so the browser can call it
// directly — no proxy required, in development or on a static host.
export const API_BASE = 'https://health.googleapis.com/v4'

export class HealthApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly dataTypeId?: string,
  ) {
    super(message)
    this.name = 'HealthApiError'
  }
}

/**
 * The human-readable part of an error response. Exported because the endpoints
 * outside the dataPoints collection (`profile.ts`, `exerciseTcx.ts`) need the
 * same unwrapping but say something different about the status code.
 */
export function readApiMessage(body: string): string {
  try {
    return (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? ''
  } catch {
    return body.slice(0, 200)
  }
}

function describeHttpError(status: number, body: string, dataTypeId: string): string {
  const apiMessage = readApiMessage(body)

  switch (status) {
    case 401:
      return 'Access token rejected (401). Sign out and sign in again.'
    case 403:
      return `Forbidden (403) for "${dataTypeId}". Check that the Google Health API is enabled in your Cloud project and that the matching scope was granted. ${apiMessage}`.trim()
    case 404:
      return `Data type "${dataTypeId}" not found (404). ${apiMessage}`.trim()
    case 429:
      return 'Rate limited by the Google Health API (429). Try again shortly.'
    default:
      return `HTTP ${status} for "${dataTypeId}". ${apiMessage}`.trim()
  }
}

async function getDataPoints(
  dataTypeId: string,
  accessToken: string,
  params: URLSearchParams,
): Promise<ListDataPointsResponse> {
  const url = `${API_BASE}/users/me/dataTypes/${encodeURIComponent(dataTypeId)}/dataPoints?${params}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })
  } catch (err) {
    throw new HealthApiError(
      `Network request failed — check your connection, or whether an extension is blocking requests to health.googleapis.com. (${
        err instanceof Error ? err.message : String(err)
      })`,
      0,
      dataTypeId,
    )
  }

  if (!response.ok) {
    const body = await response.text()
    throw new HealthApiError(describeHttpError(response.status, body, dataTypeId), response.status, dataTypeId)
  }

  return (await response.json()) as ListDataPointsResponse
}

export interface ListOptions {
  accessToken: string
  /**
   * How many records to return per data type. No longer a single request's page
   * size: pages are followed until this many have been collected, so it can
   * exceed the API's per-page cap (25 for `sleep` and `exercise`, 10000 for the
   * rest). Pass 0 to skip the time filter entirely.
   */
  pageSize: number
  /** Only look this far back. Pass 0 to skip the time filter entirely. */
  lookbackDays: number
}

/**
 * A runaway-loop backstop, not a real limit. `pageSize` bounds the collection;
 * this only matters if the API ever returns a `nextPageToken` alongside an empty
 * page, which would otherwise spin forever.
 */
const MAX_PAGES = 40

/**
 * Midnight at the start of `date`, in the viewer's zone.
 *
 * "Last 14 days" is snapped to a day boundary rather than run back exactly
 * 14×24 h from now, because every view that groups rows into days would
 * otherwise show a boundary day cut at whatever time of day it happens to be —
 * a half-day of food or steps, rendered identically to a whole one. Widening
 * the window by up to a day is the cheaper error, and it is what the label
 * already implies.
 */
function startOfLocalDay(date: Date): Date {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  return start
}

/**
 * Which spelling of the data type the filter grammar wants, once we know.
 *
 * Module-level rather than per-call because it is a property of the API, not of
 * a request: the first filtered fetch of the session pays at most one extra
 * round trip to find out, and every later one goes straight to the right form.
 * See `FilterDialect` in `dataPointFilter.ts` for why this is not simply known.
 */
let knownDialect: FilterDialect | null = null

function dialectsToTry(): FilterDialect[] {
  const all: FilterDialect[] = ['camel', 'snake']
  if (!knownDialect) return all
  return [knownDialect, ...all.filter((dialect) => dialect !== knownDialect)]
}

/** Exposed for tests, which need each case to start from no knowledge. */
export function resetFilterDialect(): void {
  knownDialect = null
}

/**
 * Fetches the first page, settling on a filter expression as it goes.
 *
 * The filter is applied optimistically and degrades in two steps. A rejected
 * *spelling* of the data type is retried in the other spelling; a rejected
 * *field* — or a data type with no time field at all — falls back to an
 * unfiltered request, so the type still contributes rows rather than dropping
 * out of the dashboard. The params that worked are returned so the remaining
 * pages reuse them verbatim.
 */
async function fetchFirstPage(
  dataType: DataTypeDef,
  { accessToken, pageSize, lookbackDays }: ListOptions,
): Promise<{ response: ListDataPointsResponse; params: URLSearchParams }> {
  const baseParams = { page_size: String(pageSize) }

  if (lookbackDays > 0) {
    const since = startOfLocalDay(new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000))

    for (const dialect of dialectsToTry()) {
      const filter = timeFilter(dataType, since, dialect)
      // Null means the data type has no filterable time field; no spelling of it
      // will help, so stop trying and go unfiltered.
      if (filter === null) break

      const params = new URLSearchParams({ ...baseParams, filter })
      try {
        const response = await getDataPoints(dataType.id, accessToken, params)
        knownDialect = dialect
        return { response, params }
      } catch (err) {
        if (!(err instanceof HealthApiError) || err.status !== 400) throw err
        // Try the other spelling, then fall through to unfiltered below.
      }
    }
  }

  const params = new URLSearchParams(baseParams)
  return { response: await getDataPoints(dataType.id, accessToken, params), params }
}

/**
 * Lists recent data points for one data type, following `nextPageToken` until
 * `pageSize` records have been collected or the data runs out.
 *
 * Paging is what lifts the ceiling on sleep and exercise, whose per-request page
 * size the API caps at 25 however much more is asked for.
 */
export async function listDataPoints(
  dataType: DataTypeDef,
  options: ListOptions,
): Promise<ListDataPointsResponse> {
  const { response: first, params } = await fetchFirstPage(dataType, options)

  const collected = [...(first.dataPoints ?? [])]
  let pageToken = first.nextPageToken

  for (let page = 1; page < MAX_PAGES; page++) {
    if (!pageToken || collected.length >= options.pageSize) break

    const next = new URLSearchParams(params)
    next.set('page_token', pageToken)
    const response = await getDataPoints(dataType.id, options.accessToken, next)

    const batch = response.dataPoints ?? []
    // An empty page with a token would otherwise loop to MAX_PAGES for nothing.
    if (batch.length === 0) break
    collected.push(...batch)
    pageToken = response.nextPageToken
  }

  return {
    // The last page can overshoot, since the API decides how much it returns.
    dataPoints: collected.slice(0, options.pageSize),
    nextPageToken: pageToken,
  }
}

/** Runs `worker` over `items` with a bounded number of in-flight requests. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index])
    }
  })

  await Promise.all(runners)
  return results
}

export interface LatestDataResult {
  records: HealthRecord[]
  outcomes: FetchOutcome[]
}

/**
 * Fetches the most recent data points across several data types and merges them
 * into one list sorted newest-first. A failure in one data type is reported in
 * `outcomes` rather than failing the whole load.
 */
export async function fetchLatestRecords(
  dataTypes: DataTypeDef[],
  options: ListOptions,
): Promise<LatestDataResult> {
  const outcomes = await mapWithConcurrency(dataTypes, 6, async (dataType): Promise<FetchOutcome & { records: HealthRecord[] }> => {
    try {
      const response = await listDataPoints(dataType, options)
      const records = (response.dataPoints ?? []).map((point, index) =>
        normalizeDataPoint(point, dataType, index),
      )
      return {
        dataType,
        status: 'ok',
        count: records.length,
        // A token left over means the row budget stopped the fetch, not the data.
        truncated: Boolean(response.nextPageToken),
        records,
      }
    } catch (err) {
      return {
        dataType,
        status: 'error',
        count: 0,
        error: err instanceof Error ? err.message : String(err),
        truncated: false,
        records: [],
      }
    }
  })

  const records = outcomes
    .flatMap((outcome) => outcome.records)
    .sort((a, b) => {
      // Undated records sink to the bottom rather than scrambling the order.
      const at = a.timestamp?.getTime() ?? -Infinity
      const bt = b.timestamp?.getTime() ?? -Infinity
      return bt - at
    })

  return {
    records,
    outcomes: outcomes.map(({ records: _records, ...outcome }) => outcome),
  }
}
