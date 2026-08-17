import type { ExerciseSession } from '../api/google/exercise'
import { formatDuration } from '../api/google/sleep'
import { clockLabel, wallClock } from '../api/google/time'

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

export default function ExerciseCard({ session }: { session: ExerciseSession }) {
  const offset = session.utcOffsetSeconds
  const when = session.start ? dayFormat.format(wallClock(session.start, offset)) : null
  const window =
    session.start && session.end
      ? `${clockLabel(session.start, offset)} – ${clockLabel(session.end, offset)}`
      : null

  const shown = session.stats.slice(0, MAX_STATS)
  const hidden = session.stats.length - shown.length

  return (
    <li className="card exercise-card">
      <div className="exercise-head">
        <div>
          <h3>{session.title}</h3>
          <span className="muted">
            {[when, window].filter(Boolean).join(' · ')}
            {session.splits > 0 && ` · ${session.splits} laps`}
          </span>
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
