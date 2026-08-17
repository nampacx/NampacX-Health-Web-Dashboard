import { useMemo } from 'react'
import { SLEEP_METRIC_IDS } from '../api/google/dataTypes'
import { metricsForNight, nightMetricsByDate } from '../api/google/sleepMetrics'
import { useGoogleData } from '../state/googleData'
import SleepNightCard from './SleepNightCard'

export default function SleepSection() {
  // Nights are parsed once in the provider; Dashboard needs the same list for
  // the sub-tab badge, and parsing it twice would be pure waste.
  const { controls, setControls, records, nights, loading, loadedAt } = useGoogleData()

  const byDate = useMemo(() => nightMetricsByDate(records), [records])

  // The cardio types live in the Metrics category, so a trimmed selection can
  // leave the stage timeline present and every HRV row missing. Say so, and
  // offer the fix, rather than rendering a silently poorer card.
  const missingMetricIds = SLEEP_METRIC_IDS.filter((id) => !controls.selectedIds.includes(id))

  function enableMetricTypes() {
    setControls({
      ...controls,
      selectedIds: [...controls.selectedIds, ...missingMetricIds],
    })
  }

  return (
    <>
      {/* No Refresh button here: Controls sits directly above both sub-tabs and
          already has one. Two would just be two. */}
      <div className="list-header">
        <h2>Sleep</h2>
        <span className="muted">
          {nights.length} {nights.length === 1 ? 'night' : 'nights'}
          {loadedAt && ` · updated ${loadedAt.toLocaleTimeString()}`}
        </span>
      </div>

      {missingMetricIds.length > 0 && (
        <p className="banner banner-warn">
          Overnight HRV and heart rate come from separate data types that are not currently
          selected.{' '}
          <button type="button" className="btn btn-small" onClick={enableMetricTypes}>
            Load them
          </button>
        </p>
      )}

      {loading && nights.length === 0 ? (
        <p className="muted">Loading your sleep data…</p>
      ) : nights.length === 0 ? (
        <section className="card empty">
          <h2>No sleep sessions</h2>
          <p className="muted">
            Nothing came back for this time range. Widen it, or check that the Google account has
            sleep data — the API only returns what a watch or band has already synced.
          </p>
        </section>
      ) : (
        <ul className="sleep-nights">
          {nights.map((night) => (
            <SleepNightCard key={night.key} night={night} metrics={metricsForNight(byDate, night)} />
          ))}
        </ul>
      )}

      {/* Asked for repeatedly, so it is worth stating on the page rather than
          leaving it to look like a bug. */}
      <p className="muted sleep-footnote">
        Sleep Score and recovery are not part of the Google Health API. No data type exposes them
        and no message carries a score field — they are computed in the Google Health app and on
        the watch, and stay there. Everything above is built from the fields the API does return.
      </p>
    </>
  )
}
