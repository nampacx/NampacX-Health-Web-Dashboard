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

/** Keyed by report date (ISO YYYY-MM-DD) -- the PartitionKey round-trips straight into PUT. */
export type BloodworkResultsByDate = Record<string, BloodworkResultRow[]>

/** Mirrors BloodworkJobEntity.Status: "pending" | "processing" | "completed" | "failed". */
export type BloodworkJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface BloodworkJob {
  documentId: string
  status: BloodworkJobStatus
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
