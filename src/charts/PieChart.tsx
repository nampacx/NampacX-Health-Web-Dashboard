/**
 * A part-to-whole pie.
 *
 * Deliberately narrow: a pie is only the right form for a small number of
 * segments read at a glance, which is why this takes a handful of slices and has
 * no "other" bucket, no cycling palette and no legend of its own. Anything that
 * needs more than about six segments wants a bar chart or a table — and the
 * table beside this one is where the exact numbers live, so the pie is free to
 * be the shape rather than the data.
 *
 * Colour is never the only encoding: each slice carries a direct percentage
 * label when it is big enough to hold one, the caller renders a legend, and the
 * same values appear in the table underneath.
 */

import { arcPath, isFullCircle, pieArcs, polarPoint } from './pieGeometry'

export interface PieSlice {
  id: string
  label: string
  /** Any non-negative magnitude; shares are computed from the total. */
  value: number
  /** A CSS colour, typically a `var(--macro-…)` token. */
  color: string
}

interface Props {
  slices: PieSlice[]
  /** Width and height in px. */
  size?: number
  /** Describes the whole figure to a screen reader. */
  ariaLabel: string
}

const percentFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

/** Below this share a slice is too thin to hold a legible label. */
const MIN_LABELLED_SHARE = 0.08

export default function PieChart({ slices, size = 168, ariaLabel }: Props) {
  const arcs = pieArcs(slices, (slice) => slice.value)
  if (arcs.length === 0) return null

  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - 2

  return (
    <svg
      className="pie"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={ariaLabel}
    >
      {arcs.map(({ item: slice, share, from, to }) => (
        <g key={slice.id}>
          {/* A lone slice is a full circle: an arc whose start and end coincide
              renders as nothing at all. */}
          {isFullCircle(share) ? (
            <circle cx={cx} cy={cy} r={radius} fill={slice.color} />
          ) : (
            <path
              d={arcPath(cx, cy, radius, from, to)}
              fill={slice.color}
              // A 2px gap in the surface colour, so neighbouring fills read as
              // separate marks rather than one blended shape.
              stroke="var(--surface)"
              strokeWidth={2}
            />
          )}
          <title>{`${slice.label}: ${percentFormat.format(share * 100)} %`}</title>
        </g>
      ))}

      {arcs
        .filter(({ share }) => share >= MIN_LABELLED_SHARE)
        .map(({ item: slice, share, from, to }) => {
          const mid = polarPoint(cx, cy, radius * 0.62, (from + to) / 2)
          return (
            <text
              key={slice.id}
              className="pie-label"
              x={mid.x}
              y={mid.y}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {percentFormat.format(share * 100)}%
            </text>
          )
        })}
    </svg>
  )
}
