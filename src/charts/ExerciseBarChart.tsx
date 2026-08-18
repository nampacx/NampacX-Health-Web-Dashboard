import type { ExerciseDayTotal } from '../api/google/exercise'
import { formatDuration } from '../api/google/sleep'
import { labelledIndices } from './scale'

interface Props {
  days: ExerciseDayTotal[]
}

const PLOT_HEIGHT = 136
const PAD_TOP = 8
const PAD_BOTTOM = 26
const PAD_X = 8
const BAR_WIDTH = 18
const BAR_GAP = 10

const axisLabel = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

const longDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

export default function ExerciseBarChart({ days }: Props) {
  if (days.length === 0) return null

  const latest = days[days.length - 1]
  const maxDuration = Math.max(0, ...days.map((day) => day.durationMs))
  const width = Math.max(220, PAD_X * 2 + days.length * BAR_WIDTH + Math.max(0, days.length - 1) * BAR_GAP)
  const height = PAD_TOP + PLOT_HEIGHT + PAD_BOTTOM
  const labels = labelledIndices(days.length)

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <h3>Daily total time</h3>
        <span className="chart-latest">
          {formatDuration(latest.durationMs)}
          <span className="muted"> latest day</span>
        </span>
      </figcaption>

      <div className="chart-plot exercise-day-plot">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="chart-svg"
          role="img"
          aria-label={`Daily total workout time for ${days.length} ${days.length === 1 ? 'day' : 'days'} from ${longDate.format(days[0].day)} to ${longDate.format(latest.day)}. The table below lists the same totals in text.`}
        >
          <line
            className="chart-grid"
            x1={PAD_X}
            x2={width - PAD_X}
            y1={PAD_TOP + PLOT_HEIGHT}
            y2={PAD_TOP + PLOT_HEIGHT}
          />

          {days.map((day, index) => {
            const x = PAD_X + index * (BAR_WIDTH + BAR_GAP)
            const barHeight =
              maxDuration <= 0 || day.durationMs <= 0 ? 0 : Math.max(1, (day.durationMs / maxDuration) * PLOT_HEIGHT)
            const y = PAD_TOP + PLOT_HEIGHT - barHeight
            return (
              <g key={day.dateKey}>
                <rect className="exercise-day-bar" x={x} y={y} width={BAR_WIDTH} height={barHeight} rx="4" />
                <title>
                  {`${longDate.format(day.day)}: ${formatDuration(day.durationMs)} across ${day.sessions} ${day.sessions === 1 ? 'workout' : 'workouts'}`}
                </title>
                {labels.includes(index) && (
                  <text
                    className="chart-tick"
                    x={x + BAR_WIDTH / 2}
                    y={PAD_TOP + PLOT_HEIGHT + 16}
                    textAnchor="middle"
                  >
                    {axisLabel.format(day.day)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <details className="chart-table">
        <summary>Show {days.length} daily totals as a table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Workouts</th>
              <th scope="col">Total time</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((day) => (
              <tr key={day.dateKey}>
                <td>{longDate.format(day.day)}</td>
                <td className="chart-table-value">{day.sessions}</td>
                <td className="chart-table-value">{formatDuration(day.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
