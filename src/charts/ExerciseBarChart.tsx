import { useMemo, useState } from 'react'
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

const TYPE_COLORS = [
  'var(--stage-deep)',
  'var(--stage-light)',
  'var(--stage-rem)',
  'var(--stage-awake)',
  'var(--macro-carbs)',
  'var(--macro-fat)',
  'var(--macro-protein)',
  'var(--series-weight)',
  'var(--series-fat)',
]

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
  const [activeDay, setActiveDay] = useState<number | null>(null)
  if (days.length === 0) return null

  const latest = days[days.length - 1]
  const maxDuration = Math.max(0, ...days.map((day) => day.durationMs))
  const width = Math.max(220, PAD_X * 2 + days.length * BAR_WIDTH + Math.max(0, days.length - 1) * BAR_GAP)
  const height = PAD_TOP + PLOT_HEIGHT + PAD_BOTTOM
  const labels = labelledIndices(days.length)
  const typeLegend = useMemo(() => {
    const totals = new Map<string, { label: string; durationMs: number }>()
    for (const day of days) {
      for (const type of day.byType) {
        const current = totals.get(type.typeKey)
        if (current) {
          current.durationMs += type.durationMs
        } else {
          totals.set(type.typeKey, { label: type.label, durationMs: type.durationMs })
        }
      }
    }
    return [...totals.entries()]
      .sort((a, b) => b[1].durationMs - a[1].durationMs || a[1].label.localeCompare(b[1].label))
      .map(([typeKey, value], index) => ({
        typeKey,
        label: value.label,
        color: TYPE_COLORS[index % TYPE_COLORS.length],
      }))
  }, [days])
  const colorByType = new Map(typeLegend.map((entry) => [entry.typeKey, entry.color]))
  const summaryDayIndex = activeDay ?? days.length - 1
  const summaryDay = days[summaryDayIndex]

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
        <div className="exercise-day-scroll">
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="chart-svg"
            role="img"
            aria-label={`Daily total workout time by exercise type for ${days.length} ${days.length === 1 ? 'day' : 'days'} from ${longDate.format(days[0].day)} to ${longDate.format(latest.day)}. The legend and table below list the same categories and totals in text.`}
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
              let nextY = y + barHeight
              const active = activeDay === index
              return (
                <g
                  key={day.dateKey}
                  onPointerEnter={() => setActiveDay(index)}
                  onPointerLeave={() => setActiveDay((current) => (current === index ? null : current))}
                >
                  {day.byType.map((type, typeIndex) => {
                    const segmentHeight =
                      day.durationMs <= 0
                        ? 0
                        : typeIndex === day.byType.length - 1
                          ? Math.max(0, nextY - y)
                          : (type.durationMs / day.durationMs) * barHeight
                    nextY -= segmentHeight
                    return (
                      <rect
                        key={type.typeKey}
                        className="exercise-day-bar"
                        x={x}
                        y={nextY}
                        width={BAR_WIDTH}
                        height={segmentHeight}
                        style={{ fill: colorByType.get(type.typeKey) }}
                      />
                    )
                  })}
                  {active && (
                    <rect
                      className="exercise-day-active-outline"
                      x={x - 1}
                      y={y - 1}
                      width={BAR_WIDTH + 2}
                      height={Math.max(16, barHeight) + 2}
                      rx={3}
                    />
                  )}
                  <rect className="exercise-day-hitbox" x={x} y={y} width={BAR_WIDTH} height={Math.max(16, barHeight)} />
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

        <div className="exercise-day-detail" role="status">
          <strong>{longDate.format(summaryDay.day)}</strong>
          <span className="muted">{formatDuration(summaryDay.durationMs)} total</span>
          <table>
            <tbody>
              {summaryDay.byType.map((type) => (
                <tr key={type.typeKey}>
                  <td>
                    <span className="exercise-day-legend-swatch" style={{ background: colorByType.get(type.typeKey) }} />
                    {type.label}
                  </td>
                  <td className="chart-table-value">{formatDuration(type.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {typeLegend.length > 0 && (
        <ul className="exercise-day-legend">
          {typeLegend.map((entry) => (
            <li key={entry.typeKey}>
              <span className="exercise-day-legend-swatch" style={{ background: entry.color }} />
              <span>{entry.label}</span>
            </li>
          ))}
        </ul>
      )}

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
