import type { ExerciseDayGroup as DayGroup } from '../api/google/exercise'
import { formatDuration } from '../api/google/sleep'
import ExerciseCard from './ExerciseCard'

// timeZone: 'UTC' is not a bug — the date handed in is already shifted into the
// recording zone, so its UTC face *is* the local calendar day.
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})

export default function ExerciseDayGroup({ group }: { group: DayGroup }) {
  const label = dayFormat.format(group.day)
  const count = group.sessions.length
  const totalMs = group.sessions.reduce((sum, s) => sum + (s.durationMs ?? 0), 0)

  return (
    <li className="exercise-day-group">
      <details>
        <summary className="exercise-day-summary">
          <span className="exercise-day-label">{label}</span>
          <span className="exercise-day-meta muted">
            {count} {count === 1 ? 'workout' : 'workouts'}
            {totalMs > 0 && <> · {formatDuration(totalMs)} total</>}
          </span>
        </summary>
        <ul className="exercise-day-sessions">
          {group.sessions.map((session) => (
            <ExerciseCard key={session.key} session={session} />
          ))}
        </ul>
      </details>
    </li>
  )
}
