/**
 * Wire shapes for the Withings Public Health Data API and the normalized
 * shapes the UI renders. Kept out of `types.ts`, which is Google-flavoured.
 *
 * Withings' own envelope is unusual: errors come back as HTTP 200 with a
 * non-zero `status` in the body, so every caller must check `status !== 0`
 * before trusting `body`. See withingsApi.ts.
 */

/** https://wbsapi.withings.net/measure, action=getmeas */
export interface WithingsEnvelope<T> {
  status: number
  body?: T
  error?: string
}

export interface RawMeasure {
  value: number
  type: number
  unit: number
  /** Present on some device types; not relied on structurally. */
  algo?: number
  fm?: number
}

/** `category`: 1 = a real measurement, 2 = a user-set goal. Goals are dropped. */
export interface RawMeasureGroup {
  grpid: number
  attrib: number
  date: number // epoch seconds
  created: number
  modified?: number
  category: number
  deviceid: string | null
  measures: RawMeasure[]
}

export interface GetMeasBody {
  updatetime: number
  timezone: string
  measuregrps: RawMeasureGroup[]
  more?: 0 | 1
  offset?: number
}

/** A single normalized measurement, value already scaled by `10 ** unit`. */
export interface Measure {
  type: number
  label: string
  unit: string
  value: number
}

/** Provenance, derived from `attrib`. See withingsMeasureTypes.ts for the mapping. */
export type MeasureProvenance = 'device' | 'manual' | 'auto'

/** One weigh-in: several measures recorded together. The renderable unit. */
export interface MeasureGroup {
  key: string
  date: Date
  provenance: MeasureProvenance
  measures: Measure[]
  raw: RawMeasureGroup
}

export interface WithingsOAuthTokens {
  accessToken: string
  refreshToken: string
  /** Epoch milliseconds. */
  expiresAt: number
  userId: string
  scope: string
}
