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
import { getMeasureGroups } from '../api/withings/measureApi'
import { normalizeGetMeasResponse } from '../api/withings/normalize'
import type { MeasureGroup } from '../api/withings/types'
import { useWithingsAuth } from '../auth/withings/WithingsAuthContext'
import { useTimeRange } from './timeRange'

/** Withings' half of the same lift described in googleData.tsx. */
interface WithingsDataState {
  groups: MeasureGroup[]
  loading: boolean
  error: string | null
  loadedAt: Date | null
  reload: () => void
}

const WithingsDataContext = createContext<WithingsDataState | null>(null)

export function WithingsDataProvider({ children }: { children: ReactNode }) {
  const { status, getAccessToken } = useWithingsAuth()
  const { lookbackDays } = useTimeRange()
  const [groups, setGroups] = useState<MeasureGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  // Guards against a slow earlier request overwriting a newer result.
  const requestId = useRef(0)

  const load = useCallback(async () => {
    if (status !== 'connected') return

    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const accessToken = await getAccessToken()
      const raw = await getMeasureGroups({ accessToken, lookbackDays })
      if (id !== requestId.current) return
      setGroups(normalizeGetMeasResponse(raw))
      setLoadedAt(new Date())
    } catch (err) {
      if (id !== requestId.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [status, getAccessToken, lookbackDays])

  useEffect(() => {
    void load()
  }, [load])

  // Disconnecting must not leave weigh-ins readable on the technical tab.
  useEffect(() => {
    if (status === 'connected') return
    requestId.current++
    setGroups([])
    setLoadedAt(null)
    setError(null)
  }, [status])

  const value = useMemo<WithingsDataState>(
    () => ({ groups, loading, error, loadedAt, reload: () => void load() }),
    [groups, loading, error, loadedAt, load],
  )

  return <WithingsDataContext.Provider value={value}>{children}</WithingsDataContext.Provider>
}

export function useWithingsData(): WithingsDataState {
  const ctx = useContext(WithingsDataContext)
  if (!ctx) throw new Error('useWithingsData must be used inside <WithingsDataProvider>')
  return ctx
}
