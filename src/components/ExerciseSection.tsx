import { useMemo } from 'react'
import { exerciseDailyTotals, exerciseTotals, groupSessionsByDay } from '../api/google/exercise'
import { formatDuration } from '../api/google/sleep'
import { useGoogleData } from '../state/googleData'
import ExerciseBarChart from '../charts/ExerciseBarChart'
import ExerciseDayGroup from './ExerciseDayGroup'

const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

export default function ExerciseSection() {
  const { controls, setControls, sessions, loading, loadedAt } = useGoogleData()

  const totals = useMemo(() => exerciseTotals(sessions), [sessions])
  const dailyTotals = useMemo(() => exerciseDailyTotals(sessions), [sessions])
  const dayGroups = useMemo(() => groupSessionsByDay(sessions), [sessions])

  const exerciseSelected = controls.selectedIds.includes('exercise')

  return (
    <>
      <div className="list-header">
        <h2>Exercise</h2>
        <span className="muted">
          {sessions.length} {sessions.length === 1 ? 'workout' : 'workouts'}
          {loadedAt && ` · updated ${loadedAt.toLocaleTimeString()}`}
        </span>
      </div>

      {!exerciseSelected && (
        <p className="banner banner-warn">
          The <code>exercise</code> data type is not selected, so nothing can show up here.{' '}
          <button
            type="button"
            className="btn btn-small"
            onClick={() =>
              setControls({ ...controls, selectedIds: [...controls.selectedIds, 'exercise'] })
            }
          >
            Load it
          </button>
        </p>
      )}

      {sessions.length > 0 && (
        <>
          <div className="exercise-totals">
            <div className="sleep-stat">
              <span className="sleep-stat-label">Workouts</span>
              <span className="sleep-stat-value">{sessions.length}</span>
            </div>
            <div className="sleep-stat">
              <span className="sleep-stat-label">Total time</span>
              <span className="sleep-stat-value">{formatDuration(totals.durationMs)}</span>
            </div>
            {/* Absent rather than zero when nothing reported calories -- a "0 kcal"
                total would read as a fact instead of a gap. */}
            {totals.caloriesKcal !== null && (
              <div className="sleep-stat">
                <span className="sleep-stat-label">Total energy</span>
                <span className="sleep-stat-value">
                  {whole.format(totals.caloriesKcal)} kcal
                </span>
              </div>
            )}
          </div>
          <ExerciseBarChart days={dailyTotals} />
        </>
      )}

      {loading && sessions.length === 0 ? (
        <p className="muted">Loading your workouts…</p>
      ) : sessions.length === 0 ? (
        <section className="card empty">
          <h2>No workouts</h2>
          <p className="muted">
            Nothing came back for this time range. Widen it, or check that the connected account has
            logged workouts — the API only returns what a watch or app has already synced.
          </p>
        </section>
      ) : (
        <ul className="exercise-list">
          {dayGroups.map((group) => (
            <ExerciseDayGroup key={group.dateKey} group={group} />
          ))}
        </ul>
      )}

      {/* Asked about directly, and the answer is not obvious from an empty card. */}
      <p className="muted sleep-footnote">
        Sets, reps and resistance are not part of the Google Health API. The old Google Fit API had
        them on its exercise data type; they did not survive into this one, and Health Connect —
        which feeds it — has no field for them either. A strength session arrives as a labelled time
        window.
      </p>

      <p className="muted sleep-footnote">
        A workout marked <span className="pill">GPS</span> has a route, but the coordinates are not in
        the workout: the API returns them only as a TCX file, per session, which is what the download
        button fetches. There is no lat/lon field to chart and no route data type to list, so a map
        would mean parsing the TCX. Open the file in any tool that reads Garmin exports.
      </p>
    </>
  )
}
