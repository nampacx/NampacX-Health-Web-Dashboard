/** Scopes exposed by the Google Health API that grant read access. */
export type ReadScope =
  | 'activity_and_fitness.readonly'
  | 'health_metrics_and_measurements.readonly'
  | 'sleep.readonly'
  | 'nutrition.readonly'
  | 'ecg.readonly'
  | 'irn.readonly'
  | 'profile.readonly'
  | 'settings.readonly'
  | 'location.readonly'

/**
 * How the API times a data type, which decides the `filter` field that
 * `dataPoints.list` will accept for it. Taken from the "Record type" column of
 * https://developers.google.com/health/data-types — it is not inferable from the
 * payload, and guessing it means the time range is silently ignored. See
 * `dataPointFilter.ts`.
 */
export type RecordType = 'interval' | 'sample' | 'daily' | 'session' | 'food'

export interface DataTypeDef {
  /** Kebab-case identifier used in the endpoint path, e.g. `body-fat`. */
  id: string
  label: string
  category: string
  scope: ReadScope
  recordType: RecordType
  /**
   * Field names preferred for the headline value, most interesting first,
   * matched against the last segment of a payload path. Purely a hint: if none
   * are present the generic "first numeric leaf" heuristic still applies, so a
   * wrong guess here degrades rather than breaks.
   */
  summaryKeys?: string[]
}

/** Raw shape returned by GET /users/me/dataTypes/{dataType}/dataPoints. */
export interface RawDataPoint {
  name?: string
  dataSource?: {
    recordingMethod?: string
    platform?: string
    [key: string]: unknown
  }
  /** The payload lives under a key named after the data type, e.g. `exercise`. */
  [key: string]: unknown
}

export interface ListDataPointsResponse {
  dataPoints?: RawDataPoint[]
  nextPageToken?: string
}

/** A data point flattened into something the list view can render directly. */
export interface HealthRecord {
  /** Stable key for React — the resource name, or a synthesised fallback. */
  key: string
  dataType: DataTypeDef
  /** Best-effort observation time; null when no timestamp could be found. */
  timestamp: Date | null
  /** Headline value, e.g. "8,412 steps". Null when nothing sensible was found. */
  summary: string | null
  /** Secondary key/value pairs worth showing as chips. */
  details: Array<{ label: string; value: string }>
  source: string | null
  raw: RawDataPoint
}

export interface UserProfile {
  sub: string
  name?: string
  email?: string
  picture?: string
}

/** One data type's fetch outcome, so partial failures stay visible. */
export interface FetchOutcome {
  dataType: DataTypeDef
  status: 'ok' | 'error'
  count: number
  error?: string
  /**
   * The row budget ran out before the data did — the API still had a
   * `nextPageToken` to give. Load-bearing for any view that groups rows into a
   * larger unit: results come back newest-first, so the *oldest* thing on screen
   * is built from a partial set of rows and understates itself. Nutrition is the
   * case that bites, where one row is one logged food and a card is a whole day.
   */
  truncated: boolean
}
