import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { DATA_TYPES_BY_ID, DEFAULT_SELECTED_IDS } from '../api/google/dataTypes'
import { fetchLatestRecords } from '../api/google/healthApi'
import { exerciseSessions, type ExerciseSession } from '../api/google/exercise'
import { sleepNights, type SleepNight } from '../api/google/sleep'
import type { DataTypeDef, FetchOutcome, HealthRecord } from '../api/google/types'
import { useGoogleAuth } from '../auth/google/GoogleAuthContext'
import { useTimeRange } from './timeRange'

/**
 * The fetch used to live inside Dashboard, which was fine while Dashboard was
 * the only thing rendering it. The technical-details tab needs the same records
 * (and the fetch outcomes, which Dashboard only ever surfaced on failure), and
 * tab panels unmount when you switch away — so keeping it there would refetch
 * on every tab change. Lifted here instead: one fetch, three readers.
 */
export interface GoogleControlsState {
  selectedIds: string[]
  pageSize: number
  query: string
}

interface GoogleDataState {
  controls: GoogleControlsState
  setControls: (next: GoogleControlsState) => void
  /** Everything that came back, ignoring the query filter. */
  records: HealthRecord[]
  /** `records` with the query filter applied. */
  visible: HealthRecord[]
  /**
   * The sleep and exercise records, parsed. Lifted here so each sub-tab and the
   * badge counting its rows share one parse rather than each doing their own.
   */
  nights: SleepNight[]
  sessions: ExerciseSession[]
  outcomes: FetchOutcome[]
  loading: boolean
  error: string | null
  loadedAt: Date | null
  reload: () => void
}

const INITIAL_CONTROLS: GoogleControlsState = {
  selectedIds: DEFAULT_SELECTED_IDS,
  pageSize: 10,
  query: '',
}

function matchesQuery(record: HealthRecord, query: string): boolean {
  const haystack = [
    record.dataType.label,
    record.dataType.category,
    record.summary ?? '',
    record.source ?? '',
    record.timestamp?.toISOString() ?? '',
    ...record.details.flatMap((detail) => [detail.label, detail.value]),
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(query)
}

const GoogleDataContext = createContext<GoogleDataState | null>(null)

export function GoogleDataProvider({ children }: { children: ReactNode }) {
  const { status, getAccessToken } = useGoogleAuth()
  const { lookbackDays } = useTimeRange()
  const [controls, setControls] = useState<GoogleControlsState>(INITIAL_CONTROLS)
  const [records, setRecords] = useState<HealthRecord[]>([])
  const [outcomes, setOutcomes] = useState<FetchOutcome[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  // Guards against a slow earlier request overwriting a newer result.
  const requestId = useRef(0)

  const selectedTypes = useMemo(
    () =>
      controls.selectedIds
        .map((id) => DATA_TYPES_BY_ID.get(id))
        .filter((dataType): dataType is DataTypeDef => dataType !== undefined),
    [controls.selectedIds],
  )

  const load = useCallback(async () => {
    // The provider is mounted for the whole session now, not just while the
    // dashboard is on screen, so it has to check for itself.
    if (status !== 'signed-in') return

    const accessToken = getAccessToken()
    if (!accessToken) {
      setError('No valid access token. Please sign in again.')
      return
    }
    if (selectedTypes.length === 0) {
      setRecords([])
      setOutcomes([])
      return
    }

    const id = ++requestId.current
    setLoading(true)
    setError(null)

    try {
      const result = await fetchLatestRecords(selectedTypes, {
        accessToken,
        pageSize: controls.pageSize,
        lookbackDays,
      })
      if (id !== requestId.current) return
      setRecords(result.records)
      setOutcomes(result.outcomes)
      setLoadedAt(new Date())
    } catch (err) {
      if (id !== requestId.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [status, getAccessToken, selectedTypes, controls.pageSize, lookbackDays])

  // `query` is applied client-side, so it deliberately does not refetch.
  useEffect(() => {
    void load()
  }, [load])

  // Signing out must not leave the previous account's records readable on the
  // technical tab.
  useEffect(() => {
    if (status === 'signed-in') return
    requestId.current++
    setRecords([])
    setOutcomes([])
    setLoadedAt(null)
    setError(null)
  }, [status])

  // The list used to be filtered to exercise + sleep unless a "show all
  // activities" checkbox was ticked. Sleep has its own sub-tab now, so the
  // activity list is simply everything -- the checkbox had become a way to hide
  // most of what you had just asked the API for.
  const visible = useMemo(() => {
    const query = controls.query.trim().toLowerCase()
    if (!query) return records
    return records.filter((record) => matchesQuery(record, query))
  }, [records, controls.query])

  const nights = useMemo(() => sleepNights(records), [records])
  const sessions = useMemo(() => exerciseSessions(records), [records])

  const value = useMemo<GoogleDataState>(
    () => ({
      controls,
      setControls,
      records,
      visible,
      nights,
      sessions,
      outcomes,
      loading,
      error,
      loadedAt,
      reload: () => void load(),
    }),
    [controls, records, visible, nights, sessions, outcomes, loading, error, loadedAt, load],
  )

  return <GoogleDataContext.Provider value={value}>{children}</GoogleDataContext.Provider>
}

export function useGoogleData(): GoogleDataState {
  const ctx = useContext(GoogleDataContext)
  if (!ctx) throw new Error('useGoogleData must be used inside <GoogleDataProvider>')
  return ctx
}
