import { useMemo, useState } from 'react'
import {
  SLEEP_STAGE_DESCRIPTIONS,
  SLEEP_STAGE_LABELS,
  clockLabel,
  formatDuration,
  type SleepNight,
  type StageSegment,
} from '../api/google/sleep'
import { hypnogramLayout } from './hypnogramScale'
import { useElementWidth } from './useElementWidth'

const LANE_HEIGHT = 30
const PAD_TOP = 8
const PAD_LEFT = 52
const PAD_RIGHT = 12
const AXIS_HEIGHT = 22

/**
 * The night as a stage timeline: one lane per stage, each segment a bar placed
 * at its real clock position. This is the view the generic normalizer could
 * never produce — it collapses `stages` to "23 entries".
 */
export default function Hypnogram({ night }: { night: SleepNight }) {
  const [wrapRef, width] = useElementWidth()
  const [active, setActive] = useState<StageSegment | null>(null)

  const startMs = night.start?.getTime() ?? 0
  const endMs = night.end?.getTime() ?? 0
  const offset = night.utcOffsetSeconds

  const layout = useMemo(() => {
    if (width === 0 || !night.start || !night.end) return null
    return hypnogramLayout({
      segments: night.segments,
      startMs,
      endMs,
      offsetSeconds: offset,
      width,
      padLeft: PAD_LEFT,
      padRight: PAD_RIGHT,
      padTop: PAD_TOP,
      laneHeight: LANE_HEIGHT,
    })
  }, [night.segments, night.start, night.end, startMs, endMs, offset, width])

  if (!night.stagesAvailable) {
    return (
      <p className="muted hypnogram-empty">
        No stage timeline for this night
        {night.trackingType ? ` — tracked as ${night.trackingType.toLowerCase()}` : ''}. Stage
        detection needs a watch or band that supports it.
      </p>
    )
  }

  const height = (layout?.height ?? PAD_TOP + 4 * LANE_HEIGHT) + AXIS_HEIGHT

  return (
    <div className="hypnogram" ref={wrapRef}>
      {layout && (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="hypnogram-svg"
          role="img"
          aria-label={`Sleep stages from ${clockLabel(new Date(startMs), offset)} to ${clockLabel(new Date(endMs), offset)}: ${night.segments.length} segments. The stage totals below give the same data as text.`}
          onPointerLeave={() => setActive(null)}
        >
          {layout.lanes.map((lane) => (
            <g key={lane.stage}>
              <rect
                className="hypnogram-lane"
                x={PAD_LEFT}
                y={lane.y}
                width={layout.plotWidth}
                height={lane.height}
                rx="4"
              />
              <text
                className="hypnogram-lane-label"
                x={PAD_LEFT - 10}
                y={lane.y + lane.height / 2}
                textAnchor="end"
                dominantBaseline="middle"
              >
                <title>{SLEEP_STAGE_DESCRIPTIONS[lane.stage]}</title>
                {SLEEP_STAGE_LABELS[lane.stage]}
              </text>
            </g>
          ))}

          {layout.ticks.map((tick) => (
            <g key={tick.at}>
              <line
                className="hypnogram-grid"
                x1={tick.x}
                x2={tick.x}
                y1={PAD_TOP}
                y2={layout.height - 6}
              />
              <text
                className="hypnogram-tick"
                x={tick.x}
                y={layout.height + 10}
                textAnchor="middle"
              >
                {tick.label}
              </text>
            </g>
          ))}

          {layout.placed.map((item, index) => (
            <rect
              key={index}
              className={
                item.segment === active ? 'hypnogram-bar hypnogram-bar-active' : 'hypnogram-bar'
              }
              x={item.x}
              y={item.y}
              width={item.width}
              height={item.height}
              rx="3"
              style={{ ['--stage' as string]: `var(--stage-${item.segment.stage})` }}
              onPointerEnter={() => setActive(item.segment)}
            />
          ))}
        </svg>
      )}

      <p className="hypnogram-readout" role="status">
        {active && (
          <>
            <span
              className="stage-key"
              style={{ ['--stage' as string]: `var(--stage-${active.stage})` }}
              aria-hidden="true"
            />
            <strong>{SLEEP_STAGE_LABELS[active.stage]}</strong>
            <span className="muted">
              {clockLabel(active.start, offset)} – {clockLabel(active.end, offset)} ·{' '}
              {formatDuration(active.durationMs)}
            </span>
          </>
        )}
      </p>
    </div>
  )
}
