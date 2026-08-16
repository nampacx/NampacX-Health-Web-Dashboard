import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DATA_TYPES_BY_ID, DEFAULT_SELECTED_IDS } from '../api/dataTypes'
import { fetchLatestRecords } from '../api/healthApi'
import { useAuth } from '../auth/AuthContext'
import { useTimeRange } from '../state/timeRange'
import type { DataTypeDef, FetchOutcome, HealthRecord } from '../types'
import Controls, { type ControlsState } from './Controls'
import OutcomeSummary from './OutcomeSummary'
import RecordList from './RecordList'

const INITIAL_CONTROLS: ControlsState = {
  selectedIds: DEFAULT_SELECTED_IDS,
  pageSize: 10,
  query: '',
  showAll: false,
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

export default function Dashboard() {
  const { getAccessToken } = useAuth()
  const { lookbackDays } = useTimeRange()
  const [controls, setControls] = useState<ControlsState>(INITIAL_CONTROLS)
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
  }, [getAccessToken, selectedTypes, controls.pageSize, lookbackDays])

  // `query` is applied client-side, so it deliberately does not refetch.
  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    let filtered = records
    if (!controls.showAll) {
      filtered = filtered.filter(
        (record) => record.dataType.id === 'exercise' || record.dataType.id === 'sleep',
      )
    }
    const query = controls.query.trim().toLowerCase()
    if (!query) return filtered
    return filtered.filter((record) => matchesQuery(record, query))
  }, [records, controls.query, controls.showAll])

  return (
    <>
      <Controls state={controls} onChange={setControls} onRefresh={() => void load()} loading={loading} />

      {error && <p className="banner banner-error">{error}</p>}
      <OutcomeSummary outcomes={outcomes} />

      <div className="list-header">
        <h2>Latest activity &amp; sleep</h2>
        <span className="muted">
          {visible.length} {visible.length === 1 ? 'record' : 'records'}
          {loadedAt && ` · updated ${loadedAt.toLocaleTimeString()}`}
        </span>
      </div>

      <RecordList records={visible} loading={loading} />
    </>
  )
}
