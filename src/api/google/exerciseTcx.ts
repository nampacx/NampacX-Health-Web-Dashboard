/**
 * The GPS route of a workout, behind `googlehealth.location.readonly`.
 *
 * **There is no `location` data type, and no coordinate anywhere in the data
 * point JSON.** This is the one thing to know before looking for one: the entire
 * `DataPoint` union contains exactly two location-adjacent fields, and both are
 * in `exercise.metadata` — `hasGps` (a boolean) and `poolLengthMillimeters`.
 * Granting the location scope does not add a `route` array to the exercise
 * payload, and it does not make a new data type listable. What it unlocks is a
 * single custom method, `dataPoints.exportExerciseTcx`, which returns the track
 * as a TCX file — so the route can be handed to the user or to another tool, but
 * it cannot be flattened into a stat chip, and a map would mean parsing XML.
 *
 * Two contract details that are easy to get wrong:
 *
 * - **`?alt=media` is mandatory.** Without it the method returns JSON wrapping a
 *   `tcxData` string rather than the file, which for a proto `bytes` field means
 *   a base64 payload to undo. Asking for media sidesteps the ambiguity.
 * - **It needs two scopes, not one.** The reference lists the accepted scopes as
 *   "one of", then contradicts itself in a note: the call wants an
 *   `activity_and_fitness` scope *and* a `location` scope together. A token
 *   holding only one of the two gets a 403, which is why a failure here says so
 *   rather than reading as a missing route.
 */

import { API_BASE, HealthApiError, readApiMessage } from './healthApi'
import { localDateKey } from './time'

/**
 * `users/1234/dataTypes/exercise/dataPoints/987` -> `987`.
 *
 * Returns null rather than guessing when the resource name is absent or shaped
 * differently — a data point synthesised without a `name` has no server-side id
 * to export, and inventing one would 404.
 */
export function exerciseDataPointId(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const match = /(?:^|\/)dataPoints\/([^/]+)\/?$/.exec(name.trim())
  return match ? match[1] : null
}

export interface TcxOptions {
  /**
   * Return a TCX even when the GPS track is missing, i.e. a file of heart-rate
   * and lap data with no coordinates. Off by default, matching the API — and
   * because the UI only offers the export when `hasGps` is set.
   */
  partialData?: boolean
}

export function exerciseTcxUrl(dataPointId: string, { partialData = false }: TcxOptions = {}): string {
  const params = new URLSearchParams({ alt: 'media' })
  if (partialData) params.set('partialData', 'true')
  // The `:exportExerciseTcx` suffix is gRPC-transcoding syntax, so the colon has
  // to survive un-escaped — only the id is encoded.
  return `${API_BASE}/users/me/dataTypes/exercise/dataPoints/${encodeURIComponent(
    dataPointId,
  )}:exportExerciseTcx?${params}`
}

function describeTcxError(status: number, body: string): string {
  const apiMessage = readApiMessage(body)
  switch (status) {
    case 401:
      return 'Access token rejected (401). Sign out and sign in again.'
    case 403:
      return `Forbidden (403) exporting the GPS route. This call needs the googlehealth.location.readonly scope in addition to an activity_and_fitness one — both have to be granted on the OAuth client and consented to at sign-in. ${apiMessage}`.trim()
    case 404:
      return `No route stored for this workout (404). ${apiMessage}`.trim()
    default:
      return `HTTP ${status} exporting the GPS route. ${apiMessage}`.trim()
  }
}

/** Fetches one workout's route as TCX (XML) text. */
export async function fetchExerciseTcx(
  dataPointId: string,
  accessToken: string,
  options: TcxOptions = {},
): Promise<string> {
  let response: Response
  try {
    response = await fetch(exerciseTcxUrl(dataPointId, options), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch (err) {
    throw new HealthApiError(
      `Network request failed exporting the GPS route. (${
        err instanceof Error ? err.message : String(err)
      })`,
      0,
    )
  }

  if (!response.ok) {
    const body = await response.text()
    throw new HealthApiError(describeTcxError(response.status, body), response.status)
  }

  return response.text()
}

/**
 * `2026-08-17-morning-trail-run.tcx`.
 *
 * Dated through the recording offset, not the viewer's zone: a 23:30 ride at
 * +02:00 belongs to the 17th even when the file is downloaded from a browser
 * sitting in UTC, where the instant reads 21:30 — same day here, but not for a
 * ride an hour later.
 */
export function tcxFileName(title: string, start: Date | null, offsetSeconds: number): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'workout'
  const day = start ? localDateKey(start, offsetSeconds) : null
  return `${day ? `${day}-` : ''}${slug}.tcx`
}
