/** One row from GET /bloodwork/data, as sent by the API (already camelCase). */
export interface BloodworkResultRow {
  /** Table Storage RowKey -- pass THIS to PUT /bloodwork/data/{date}/{analyte}, not analyse (they diverge when analyse needed sanitizing or deduping). */
  rowKey: string
  analyse: string
  bezeichnung: string
  ergebniswert: string
  flag: string
  einheit: string
  ergebnistext: string
  normbereich: string
  sourceDocumentId: string
  corrected: boolean
  correctedAt: string | null
}

/** Keyed by report date (ISO YYYY-MM-DD) -- the date round-trips straight into PUT. */
export type BloodworkResultsByDate = Record<string, BloodworkResultRow[]>

/**
 * The GET /bloodwork/data envelope. The rows used to be the whole body; the
 * wrapper exists so `truncated` has somewhere to live.
 *
 * `truncated` means the server capped the response (MAX_RESULT_ROWS) and older
 * reports were left behind -- not that the data is gone. A capped response that
 * looked identical to a complete one would read as "this is my whole history"
 * while being only the recent end of it, so it has to be said out loud. The
 * server also drops the oldest date group when it truncates, since that is the
 * one the cap cut into and a half-read report is worse than a missing one.
 */
export interface BloodworkResultsPage {
  results: BloodworkResultsByDate
  truncated: boolean
}

/** Mirrors BloodworkJobEntity.Status: "pending" | "processing" | "completed" | "failed". */
export type BloodworkJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface BloodworkJob {
  documentId: string
  status: BloodworkJobStatus
  /**
   * A stable reason code on failure -- a LayoutParser code
   * ("report_date_not_found", "results_table_not_found") or "processing_failed"
   * for everything else. Mirrors ParseException.Code.
   */
  errorCode: string | null
  /**
   * Safe to display: always text the API wrote for the user. It used to be the
   * caught exception's own message, which on the catch-all path carried the
   * storage or Document Intelligence endpoint host and the service's request id.
   */
  errorMessage: string | null
  reportDate: string | null
  rowCount: number | null
  createdAt: string
  updatedAt: string
}

/** The only fields CorrectionFunction accepts -- mirrors ResultsRepository.CorrectableFields. */
export type BloodworkCorrectableField =
  | 'ergebniswert'
  | 'flag'
  | 'einheit'
  | 'ergebnistext'
  | 'normbereich'

export type BloodworkCorrectionPatch = Partial<Record<BloodworkCorrectableField, string>>
