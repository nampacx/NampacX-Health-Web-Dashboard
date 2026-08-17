import { useCallback, useEffect, useRef, useState } from 'react'
import { getMeasureGroups } from '../api/withings/measureApi'
import { normalizeGetMeasResponse } from '../api/withings/normalize'
import type { MeasureGroup } from '../api/withings/types'
import { useWithingsAuth } from '../auth/withings/WithingsAuthContext'
import WithingsGroupCard from './WithingsGroupCard'

interface Props {
  lookbackDays: number
}

export default function WithingsSection({ lookbackDays }: Props) {
  const { getAccessToken, disconnect } = useWithingsAuth()
  const [groups, setGroups] = useState<MeasureGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  // Guards against a slow earlier request overwriting a newer result.
  const requestId = useRef(0)

  const load = useCallback(async () => {
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
  }, [getAccessToken, lookbackDays])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <div className="list-header">
        <h2>Body composition</h2>
        <div className="list-header-actions">
          <span className="muted">
            {groups.length} {groups.length === 1 ? 'weigh-in' : 'weigh-ins'}
            {loadedAt && ` · updated ${loadedAt.toLocaleTimeString()}`}
          </span>
          <button type="button" className="btn btn-small" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button type="button" className="btn btn-small btn-ghost" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      </div>

      {error && <p className="banner banner-error">{error}</p>}

      {loading && groups.length === 0 ? (
        <p className="muted">Loading your Withings measurements…</p>
      ) : groups.length === 0 ? (
        <section className="card empty">
          <h2>Nothing to show</h2>
          <p className="muted">
            No weigh-ins came back. Widen the time range, or confirm the connected Withings
            account actually has body-composition data.
          </p>
        </section>
      ) : (
        <ul className="records">
          {groups.map((group, index) => (
            <WithingsGroupCard key={group.key} group={group} previous={groups[index + 1]} />
          ))}
        </ul>
      )}
    </>
  )
}
