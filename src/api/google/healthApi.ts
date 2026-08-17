import type { DataTypeDef, FetchOutcome, HealthRecord, ListDataPointsResponse } from './types'
import { normalizeDataPoint } from './normalize'

// health.googleapis.com returns Access-Control-Allow-Origin for arbitrary
// origins and permits the `authorization` header, so the browser can call it
// directly — no proxy required, in development or on a static host.
const API_BASE = 'https://health.googleapis.com/v4'

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

/** `body-fat` -> `body_fat`, which is what the filter grammar expects. */
function toSnakeCase(dataTypeId: string): string {
  return dataTypeId.replace(/-/g, '_')
}

/** The filter grammar wants a civil (offset-free) timestamp. */
function toCivilString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

function describeHttpError(status: number, body: string, dataTypeId: string): string {
  let apiMessage = ''
  try {
    apiMessage = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? ''
  } catch {
    apiMessage = body.slice(0, 200)
  }

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
  pageSize: number
  /** Only look this far back. Pass 0 to skip the time filter entirely. */
  lookbackDays: number
}

/**
 * Lists recent data points for one data type.
 *
 * The time filter is applied optimistically: not every data type exposes an
 * `interval.civil_start_time` field, and an unknown field is rejected with a
 * 400. When that happens the call is retried unfiltered so the data type still
 * contributes rows instead of dropping out of the dashboard.
 */
export async function listDataPoints(
  dataType: DataTypeDef,
  { accessToken, pageSize, lookbackDays }: ListOptions,
): Promise<ListDataPointsResponse> {
  const baseParams = { page_size: String(pageSize) }

  if (lookbackDays > 0) {
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    const filtered = new URLSearchParams({
      ...baseParams,
      filter: `${toSnakeCase(dataType.id)}.interval.civil_start_time >= "${toCivilString(since)}"`,
    })
    try {
      return await getDataPoints(dataType.id, accessToken, filtered)
    } catch (err) {
      if (!(err instanceof HealthApiError) || err.status !== 400) throw err
      // Fall through to the unfiltered request below.
    }
  }

  return getDataPoints(dataType.id, accessToken, new URLSearchParams(baseParams))
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
      return { dataType, status: 'ok', count: records.length, records }
    } catch (err) {
      return {
        dataType,
        status: 'error',
        count: 0,
        error: err instanceof Error ? err.message : String(err),
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
