/**
 * Withings `measure` endpoint client.
 *
 * Two things make this unlike healthApi.ts: the access token goes in the
 * POST *body*, not an Authorization header — that keeps every request a CORS
 * "simple request" (no preflight) — and Withings never uses HTTP status codes
 * to signal API errors. A 401-shaped failure still comes back as `HTTP 200`
 * with `{"status": 401, ...}` in the JSON, so `response.ok` is meaningless
 * here; every path below checks `body.status !== 0` first.
 */

import type { GetMeasBody, RawMeasureGroup, WithingsEnvelope } from './withingsTypes'

const MEASURE_ENDPOINT = 'https://wbsapi.withings.net/measure'

/** Withings never documents a stable status-code table; message it plainly. */
const STATUS_MESSAGES: Record<number, string> = {
  401: 'Access token rejected. Reconnect Withings.',
  403: 'Forbidden — the granted scope does not cover this data.',
  429: 'Rate limited by Withings. Try again shortly.',
  503: 'Withings rejected the request parameters.',
}

export class WithingsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly apiError?: string,
  ) {
    super(message)
    this.name = 'WithingsApiError'
  }
}

function describeStatus(status: number, apiError?: string): string {
  const known = STATUS_MESSAGES[status]
  if (known) return apiError ? `${known} (${apiError})` : known
  return `Withings error ${status}${apiError ? `: ${apiError}` : ''}`
}

async function postForm(params: Record<string, string>): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(MEASURE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    })
  } catch (err) {
    throw new WithingsApiError(
      `Network request to Withings failed. (${err instanceof Error ? err.message : String(err)})`,
      0,
    )
  }

  // Withings does use real HTTP codes for transport-level failures (5xx from
  // its edge, etc.) even though API-level errors are always HTTP 200.
  if (!response.ok) {
    throw new WithingsApiError(`Withings returned HTTP ${response.status}.`, response.status)
  }

  try {
    return await response.json()
  } catch (err) {
    throw new WithingsApiError(
      `Malformed JSON from Withings: ${err instanceof Error ? err.message : String(err)}`,
      response.status,
    )
  }
}

/** One page of `getmeas`. Throws WithingsApiError on any `status !== 0`. */
async function getMeasPage(
  accessToken: string,
  params: Record<string, string>,
): Promise<GetMeasBody> {
  const json = (await postForm({
    action: 'getmeas',
    access_token: accessToken,
    ...params,
  })) as WithingsEnvelope<GetMeasBody>

  if (json.status !== 0) {
    throw new WithingsApiError(describeStatus(json.status, json.error), json.status, json.error)
  }
  return json.body ?? { updatetime: 0, timezone: 'UTC', measuregrps: [] }
}

export interface GetMeasureGroupsOptions {
  accessToken: string
  /** 0 disables the date filter entirely. */
  lookbackDays: number
  /** Hard cap on pagination rounds — a malformed `more` must not loop forever. */
  maxPages?: number
  now?: Date
}

/**
 * Fetches every measure group in the window, following `more`/`offset`.
 * Real-measurement filtering (`category`), body-composition membership, and
 * dedup/sort all happen downstream in withingsNormalize.ts — this function's
 * job is purely "get all the raw groups Withings has for this window".
 */
export async function getMeasureGroups({
  accessToken,
  lookbackDays,
  maxPages = 20,
  now = new Date(),
}: GetMeasureGroupsOptions): Promise<RawMeasureGroup[]> {
  const baseParams: Record<string, string> = { category: '1' }
  if (lookbackDays > 0) {
    const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000)
    baseParams.startdate = String(Math.floor(since.getTime() / 1000))
    baseParams.enddate = String(Math.floor(now.getTime() / 1000))
  }

  const groups: RawMeasureGroup[] = []
  let offset: number | undefined
  let page = 0

  do {
    const params = offset !== undefined ? { ...baseParams, offset: String(offset) } : baseParams
    const body = await getMeasPage(accessToken, params)
    groups.push(...body.measuregrps)

    if (!body.more) break
    offset = body.offset
    page += 1
  } while (page < maxPages)

  return groups
}
