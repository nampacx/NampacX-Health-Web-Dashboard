import { useState } from 'react'
import type { ExerciseSession } from '../api/google/exercise'
import { fetchExerciseTcx, tcxFileName } from '../api/google/exerciseTcx'
import { formatDuration } from '../api/google/sleep'
import { clockLabel, wallClock } from '../api/google/time'
import { useGoogleAuth } from '../auth/google/GoogleAuthContext'

// timeZone: 'UTC' is not a bug — the date handed in is already shifted into the
// recording zone, so its UTC face *is* the local calendar day.
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

/** How many stats fit on a card before it stops being a summary. */
const MAX_STATS = 6

/**
 * Hands the TCX to the browser as a file.
 *
 * Kept in the component rather than in `exerciseTcx.ts` so that module stays
 * DOM-free: the test suite runs without jsdom, and a `document` reference in the
 * API layer would put it out of reach of a plain unit test.
 */
function saveText(text: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
  } finally {
    // Revoking synchronously is safe: the click has already handed the blob off.
    URL.revokeObjectURL(url)
  }
}

export default function ExerciseCard({ session }: { session: ExerciseSession }) {
  const { getAccessToken } = useGoogleAuth()
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const offset = session.utcOffsetSeconds
  const when = session.start ? dayFormat.format(wallClock(session.start, offset)) : null
  const window =
    session.start && session.end
      ? `${clockLabel(session.start, offset)} – ${clockLabel(session.end, offset)}`
      : null

  const shown = session.stats.slice(0, MAX_STATS)
  const hidden = session.stats.length - shown.length

  // Only offered when the session says it has a track *and* carries a resource
  // name to export it by. Without both, the call would 404 on a button that
  // looked like it should work.
  const canExportRoute = session.hasGps && session.dataPointId !== null

  async function exportRoute() {
    const dataPointId = session.dataPointId
    if (!dataPointId) return
    const accessToken = getAccessToken()
    if (!accessToken) {
      setExportError('No valid access token. Please sign in again.')
      return
    }

    setExporting(true)
    setExportError(null)
    try {
      const tcx = await fetchExerciseTcx(dataPointId, accessToken)
      saveText(tcx, tcxFileName(session.title, session.start, offset), 'application/vnd.garmin.tcx+xml')
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  return (
    <li className="card exercise-card">
      <div className="exercise-head">
        <div>
          <h3>{session.title}</h3>
          <span className="muted">
            {[when, window].filter(Boolean).join(' · ')}
            {session.splits > 0 && ` · ${session.splits} laps`}
          </span>
          {session.hasGps && (
            <div className="exercise-route">
              <span className="pill">GPS</span>
              {canExportRoute && (
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => void exportRoute()}
                  disabled={exporting}
                >
                  {exporting ? 'Exporting…' : 'Download route (TCX)'}
                </button>
              )}
            </div>
          )}
        </div>
        {session.durationMs !== null && (
          <div className="exercise-duration">
            <strong>{formatDuration(session.durationMs)}</strong>
            {/* Worth distinguishing: `activeDuration` excludes paused time, so
                it can be visibly shorter than the wall-clock window above. */}
            <span className="muted"> {session.durationIsActive ? 'active' : 'elapsed'}</span>
          </div>
        )}
      </div>

      {exportError && <p className="banner banner-error exercise-export-error">{exportError}</p>}

      {shown.length > 0 ? (
        <div className="exercise-stats">
          {shown.map((stat) => (
            <div key={stat.path} className="sleep-stat">
              <span className="sleep-stat-label">{stat.label}</span>
              <span className="sleep-stat-value">{stat.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted exercise-empty">
          This session carries no metrics beyond its type and duration — Google files the numbers
          under the separate activity data types rather than inside the workout.
        </p>
      )}

      <details className="raw">
        <summary>
          Raw JSON{hidden > 0 && <span className="muted"> · {hidden} more fields</span>}
        </summary>
        <pre>{JSON.stringify(session.raw, null, 2)}</pre>
      </details>
    </li>
  )
}
