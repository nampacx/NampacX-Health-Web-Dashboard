/**
 * Geometry for the stage timeline. Pure, so the things you would otherwise
 * only catch by looking — segments escaping the plot, hour ticks landing
 * outside the night, slivers collapsing to nothing — are testable.
 */

import type { SleepStage, StageSegment } from '../api/google/sleep'
import { SLEEP_STAGES } from '../api/google/sleep'

export interface HypnogramInput {
  segments: StageSegment[]
  /** Session bounds. Segments are clamped to these. */
  startMs: number
  endMs: number
  width: number
  padLeft: number
  padRight: number
  padTop: number
  /** Height of one stage lane, including the gap below it. */
  laneHeight: number
}

export interface PlacedSegment {
  segment: StageSegment
  x: number
  width: number
  y: number
  height: number
}

export interface HypnogramLayout {
  placed: PlacedSegment[]
  lanes: Array<{ stage: SleepStage; y: number; height: number }>
  ticks: Array<{ at: number; x: number; label: string }>
  plotWidth: number
  height: number
}

/** 2px of surface between a lane's fill and the next, per the mark spec. */
const LANE_GAP = 6
/** Below this a segment is invisible; widen it so a 30-second wake still reads. */
const MIN_SEGMENT_WIDTH = 2

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `23:40` — 24-hour, because a hypnogram crosses midnight and am/pm doubles up. */
export function clockLabel(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Whole-hour marks inside the session, thinned so they never crowd. A short nap
 * can contain no whole hour at all, in which case the session bounds are
 * labelled instead — an axis with no ticks reads as a broken chart.
 */
export function hourTicks(startMs: number, endMs: number, maxTicks = 7): number[] {
  if (!(endMs > startMs)) return []

  const first = new Date(startMs)
  first.setMinutes(0, 0, 0)
  if (first.getTime() < startMs) first.setHours(first.getHours() + 1)

  const hours: number[] = []
  for (let at = first.getTime(); at <= endMs; at += 3_600_000) hours.push(at)

  if (hours.length === 0) return [startMs, endMs]
  if (hours.length <= maxTicks) return hours

  // Keep every Nth hour rather than the first N, so the labels span the night.
  const stride = Math.ceil(hours.length / maxTicks)
  return hours.filter((_, index) => index % stride === 0)
}

export function hypnogramLayout({
  segments,
  startMs,
  endMs,
  width,
  padLeft,
  padRight,
  padTop,
  laneHeight,
}: HypnogramInput): HypnogramLayout {
  const plotWidth = Math.max(1, width - padLeft - padRight)
  // A zero-length session would divide by zero; give it a nominal span so the
  // lanes still draw and the caller does not have to special-case it.
  const span = endMs > startMs ? endMs - startMs : 1

  const xFor = (at: number) => padLeft + ((at - startMs) / span) * plotWidth

  const lanes = SLEEP_STAGES.map((stage, index) => ({
    stage,
    y: padTop + index * laneHeight,
    height: laneHeight - LANE_GAP,
  }))
  const laneByStage = new Map(lanes.map((lane) => [lane.stage, lane]))

  const placed: PlacedSegment[] = []
  for (const segment of segments) {
    const lane = laneByStage.get(segment.stage)
    if (!lane) continue

    // Clamp to the session: a stage array occasionally runs a few seconds past
    // endTime, and an unclamped bar would hang off the right edge.
    const from = Math.max(startMs, Math.min(endMs, segment.start.getTime()))
    const to = Math.max(startMs, Math.min(endMs, segment.end.getTime()))
    const x = xFor(from)
    const rawWidth = xFor(to) - x

    placed.push({
      segment,
      x: Math.min(x, padLeft + plotWidth - MIN_SEGMENT_WIDTH),
      width: Math.max(MIN_SEGMENT_WIDTH, rawWidth),
      y: lane.y,
      height: lane.height,
    })
  }

  const ticks = hourTicks(startMs, endMs).map((at) => ({
    at,
    x: xFor(at),
    label: clockLabel(new Date(at)),
  }))

  return {
    placed,
    lanes,
    ticks,
    plotWidth,
    height: padTop + SLEEP_STAGES.length * laneHeight,
  }
}
