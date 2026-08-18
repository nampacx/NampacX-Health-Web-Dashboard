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
import { nutritionDays, type NutritionDay } from '../api/google/nutrition'
import { fetchHealthProfile, type HealthProfile } from '../api/google/profile'
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
  /** The nutrition logs, summed per civil day, newest-first. */
  nutrition: NutritionDay[]
  outcomes: FetchOutcome[]
  loading: boolean
  error: string | null
  loadedAt: Date | null
  reload: () => void
  /**
   * `users/me/profile`. Its own endpoint rather than a data type, so it is
   * fetched once per sign-in and deliberately ignores the controls — no lookback
   * window or data-type selection applies to an age and a stride length.
   */
  profile: HealthProfile | null
  profileError: string | null
  profileLoading: boolean
}

const INITIAL_CONTROLS: GoogleControlsState = {
  selectedIds: DEFAULT_SELECTED_IDS,
  // 25 rather than 10: for sleep and exercise this is one row per night or
  // workout and still a single request, but nutrition logs several rows a day,
  // so 10 ran out inside two days.
  pageSize: 25,
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
  const [profile, setProfile] = useState<HealthProfile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)

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

  // The profile depends on the token and nothing else, so it sits in its own
  // effect: reloading it whenever the lookback window or the data-type selection
  // changes would be a request per keystroke on the controls for a value that
  // cannot have changed.
  useEffect(() => {
    if (status !== 'signed-in') return
    const accessToken = getAccessToken()
    if (!accessToken) return

    let cancelled = false
    setProfileLoading(true)
    setProfileError(null)
    fetchHealthProfile(accessToken)
      .then((next) => {
        if (!cancelled) setProfile(next)
      })
      .catch((err: unknown) => {
        // A 403 here is the expected shape of "the profile scope was never
        // consented to", so it is reported in the profile view alone. Letting it
        // reach the page-level banner would make a missing optional scope look
        // like a failed load of everything.
        if (!cancelled) setProfileError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [status, getAccessToken])

  // Signing out must not leave the previous account's records readable on the
  // technical tab.
  useEffect(() => {
    if (status === 'signed-in') return
    requestId.current++
    setRecords([])
    setOutcomes([])
    setLoadedAt(null)
    setError(null)
    setProfile(null)
    setProfileError(null)
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
  // The nutrition grouping needs to know whether the fetch ran out of rows, so
  // it can mark the day that got cut in half rather than drawing it as a whole.
  const nutritionTruncated = useMemo(
    () =>
      outcomes.some(
        (outcome) => outcome.dataType.id === 'nutrition-log' && outcome.truncated,
      ),
    [outcomes],
  )
  const nutrition = useMemo(
    () => nutritionDays(records, { truncated: nutritionTruncated }),
    [records, nutritionTruncated],
  )

  const value = useMemo<GoogleDataState>(
    () => ({
      controls,
      setControls,
      records,
      visible,
      nights,
      sessions,
      nutrition,
      outcomes,
      loading,
      error,
      loadedAt,
      reload: () => void load(),
      profile,
      profileError,
      profileLoading,
    }),
    [
      controls,
      records,
      visible,
      nights,
      sessions,
      nutrition,
      outcomes,
      loading,
      error,
      loadedAt,
      load,
      profile,
      profileError,
      profileLoading,
    ],
  )

  return <GoogleDataContext.Provider value={value}>{children}</GoogleDataContext.Provider>
}

export function useGoogleData(): GoogleDataState {
  const ctx = useContext(GoogleDataContext)
  if (!ctx) throw new Error('useGoogleData must be used inside <GoogleDataProvider>')
  return ctx
}
