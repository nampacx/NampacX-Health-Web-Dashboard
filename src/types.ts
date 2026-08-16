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

export interface DataTypeDef {
  /** Kebab-case identifier used in the endpoint path, e.g. `body-fat`. */
  id: string
  label: string
  category: string
  scope: ReadScope
  /** Unit shown next to the primary value, when the API does not carry one. */
  unit?: string
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
}
