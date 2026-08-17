import { useMemo } from 'react'
import {
  FAT_RATIO_TYPE,
  MEASURE_TYPES_BY_TYPE,
  WEIGHT_TYPE,
} from '../api/withings/measureTypes'
import { toSeries } from '../api/withings/series'
import { useWithingsAuth } from '../auth/withings/WithingsAuthContext'
import LineChart from '../charts/LineChart'
import { useWithingsData } from '../state/withingsData'
import WithingsGroupCard from './WithingsGroupCard'

/** Title, unit and precision all come from the catalog, so they cannot drift. */
function chartMeta(type: number) {
  const def = MEASURE_TYPES_BY_TYPE.get(type)
  return {
    title: def?.label ?? `Type ${type}`,
    unit: def?.unit ?? '',
    decimals: def?.decimals ?? 1,
  }
}

export default function WithingsSection() {
  const { disconnect } = useWithingsAuth()
  const { groups, loading, error, loadedAt, reload } = useWithingsData()

  const weight = useMemo(() => toSeries(groups, WEIGHT_TYPE), [groups])
  const fatRatio = useMemo(() => toSeries(groups, FAT_RATIO_TYPE), [groups])

  return (
    <>
      <div className="list-header">
        <h2>Body composition</h2>
        <div className="list-header-actions">
          <span className="muted">
            {groups.length} {groups.length === 1 ? 'weigh-in' : 'weigh-ins'}
            {loadedAt && ` · updated ${loadedAt.toLocaleTimeString()}`}
          </span>
          <button type="button" className="btn btn-small" onClick={reload} disabled={loading}>
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
        <>
          {/* Two charts rather than one with two y-scales: kg and % share no
              scale, and overlaying them would invent a correlation. */}
          <div className="charts">
            <LineChart
              {...chartMeta(WEIGHT_TYPE)}
              colorVar="--series-weight"
              points={weight}
              loading={loading}
            />
            <LineChart
              {...chartMeta(FAT_RATIO_TYPE)}
              colorVar="--series-fat"
              points={fatRatio}
              loading={loading}
            />
          </div>

          <ul className="records">
            {groups.map((group, index) => (
              <WithingsGroupCard key={group.key} group={group} previous={groups[index + 1]} />
            ))}
          </ul>
        </>
      )}
    </>
  )
}
