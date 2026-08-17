import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { SeriesPoint } from '../api/withings/series'
import { chartLayout, shortDate } from './scale'
import { useElementWidth } from './useElementWidth'

interface Props {
  title: string
  unit: string
  decimals: number
  /** Name of the CSS custom property holding this series' colour. */
  colorVar: string
  /** Oldest first. */
  points: SeriesPoint[]
  /** Holds the previous render at reduced opacity instead of flashing a skeleton. */
  loading?: boolean
}

const PLOT_HEIGHT = 150
const PAD_TOP = 14
const PAD_BOTTOM = 26
const PAD_LEFT = 44
const MIN_LABEL_GAP = 34

const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function LineChart({
  title,
  unit,
  decimals,
  colorVar,
  points,
  loading = false,
}: Props) {
  const [wrapRef, width] = useElementWidth()
  const [active, setActive] = useState<number | null>(null)

  const format = useMemo(
    () => new Intl.NumberFormat(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
    [decimals],
  )

  const latest = points.at(-1)
  const latestText = latest ? `${format.format(latest.value)} ${unit}`.trim() : ''
  // Reserve room for the end label rather than letting it clip at the edge.
  const padRight = Math.max(24, 14 + latestText.length * 7.2)

  const geometry = useMemo(() => {
    if (points.length === 0 || width === 0) return null
    return chartLayout({
      times: points.map((point) => point.at.getTime()),
      values: points.map((point) => point.value),
      width,
      padLeft: PAD_LEFT,
      padRight,
      padTop: PAD_TOP,
      plotHeight: PLOT_HEIGHT,
      minLabelGap: MIN_LABEL_GAP,
    })
  }, [points, width, padRight])

  if (points.length === 0) {
    return (
      <figure className="chart chart-empty">
        <figcaption className="chart-head">
          <h3>{title}</h3>
        </figcaption>
        <p className="muted">No {title.toLowerCase()} readings in this time range.</p>
      </figure>
    )
  }

  const height = PAD_TOP + PLOT_HEIGHT + PAD_BOTTOM
  const activePoint = active === null ? null : points[active]
  const activeCoord = active === null || !geometry ? null : geometry.coords[active]

  function moveActive(delta: number) {
    setActive((current) => {
      const next = (current ?? points.length - 1) + delta
      return Math.min(points.length - 1, Math.max(0, next))
    })
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      moveActive(1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      moveActive(-1)
    } else if (event.key === 'Escape') {
      setActive(null)
    }
  }

  // Nearest-point rather than hit-testing the dots: the pointer only has to be
  // closest, never dead-centre on an 8px circle.
  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!geometry) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - bounds.left
    let nearest = 0
    let best = Infinity
    geometry.coords.forEach((coord, index) => {
      const distance = Math.abs(coord.x - x)
      if (distance < best) {
        best = distance
        nearest = index
      }
    })
    setActive(nearest)
  }

  return (
    <figure className={loading ? 'chart chart-loading' : 'chart'}>
      <figcaption className="chart-head">
        <h3>{title}</h3>
        <span className="chart-latest">
          {latestText}
          <span className="muted"> latest</span>
        </span>
      </figcaption>

      <div className="chart-plot" ref={wrapRef}>
        {geometry && (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="chart-svg"
            style={{ ['--series' as string]: `var(${colorVar})` }}
            role="img"
            aria-label={`${title}: ${points.length} readings from ${shortDate(points[0].at)} to ${shortDate(points[points.length - 1].at)}, latest ${latestText}. Use arrow keys to read each value.`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActive(null)}
            onBlur={() => setActive(null)}
          >
            {geometry.ticks.map((tick) => (
              <g key={tick.value}>
                <line className="chart-grid" x1={PAD_LEFT} x2={width - 4} y1={tick.y} y2={tick.y} />
                <text
                  className="chart-tick"
                  x={PAD_LEFT - 8}
                  y={tick.y}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {tick.value}
                </text>
              </g>
            ))}

            {geometry.labels.map(({ index, x }) => (
              <text
                key={index}
                className="chart-tick"
                x={x}
                y={PAD_TOP + PLOT_HEIGHT + 16}
                textAnchor="middle"
              >
                {shortDate(points[index].at)}
              </text>
            ))}

            {activeCoord && (
              <line
                className="chart-crosshair"
                x1={activeCoord.x}
                x2={activeCoord.x}
                y1={PAD_TOP}
                y2={PAD_TOP + PLOT_HEIGHT}
              />
            )}

            <path
              className="chart-line"
              d={geometry.coords.map((coord, index) => `${index === 0 ? 'M' : 'L'}${coord.x} ${coord.y}`).join(' ')}
            />

            {geometry.coords.map((coord, index) => (
              <circle
                key={index}
                className="chart-dot"
                cx={coord.x}
                cy={coord.y}
                r={index === active ? 5.5 : 4}
              />
            ))}

            {/* Direct label on the endpoint, so the headline value is readable
                without hovering anything. */}
            <text
              className="chart-end-label"
              x={geometry.coords[geometry.coords.length - 1].x + 9}
              y={geometry.coords[geometry.coords.length - 1].y}
              dominantBaseline="middle"
            >
              {latestText}
            </text>
          </svg>
        )}

        {activePoint && activeCoord && (
          <div
            className="chart-tooltip"
            style={{
              // Centred on the point, but clamped so the first and last
              // readings do not push it past the card edge.
              left: `${Math.min(Math.max(activeCoord.x, 78), Math.max(78, width - 78))}px`,
              top: `${activeCoord.y}px`,
              ['--series' as string]: `var(${colorVar})`,
            }}
            role="status"
          >
            <span className="chart-tooltip-key" aria-hidden="true" />
            <strong>
              {format.format(activePoint.value)} {unit}
            </strong>
            <span className="muted">{longDate.format(activePoint.at)}</span>
          </div>
        )}
      </div>

      {/* The tooltip enhances; it never gates. Every value is here too. */}
      <details className="chart-table">
        <summary>Show {points.length} readings as a table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">{title}</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((point) => (
              <tr key={point.at.toISOString()}>
                <td>{longDate.format(point.at)}</td>
                <td className="chart-table-value">
                  {format.format(point.value)} {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
