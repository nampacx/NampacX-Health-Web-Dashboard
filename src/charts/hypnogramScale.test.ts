import { describe, expect, it } from 'vitest'
import type { StageSegment } from '../api/google/sleep'
import { clockLabel, hourTicks, hypnogramLayout } from './hypnogramScale'

const BOX = { width: 600, padLeft: 52, padRight: 12, padTop: 8, laneHeight: 30 }

const START = new Date(2026, 7, 16, 23, 0).getTime()
const END = new Date(2026, 7, 17, 6, 0).getTime()

function segment(stage: StageSegment['stage'], fromMs: number, toMs: number): StageSegment {
  return {
    stage,
    start: new Date(fromMs),
    end: new Date(toMs),
    durationMs: toMs - fromMs,
  }
}

const HOUR = 3_600_000

describe('hourTicks', () => {
  it('marks the whole hours inside the session', () => {
    const ticks = hourTicks(START, START + 3 * HOUR)
    expect(ticks.map((at) => clockLabel(new Date(at)))).toEqual(['23:00', '00:00', '01:00', '02:00'])
  })

  it('starts at the first whole hour after a ragged start', () => {
    const ragged = new Date(2026, 7, 16, 23, 40).getTime()
    expect(clockLabel(new Date(hourTicks(ragged, ragged + 2 * HOUR)[0]))).toBe('00:00')
  })

  it('thins a long night rather than crowding the axis', () => {
    expect(hourTicks(START, START + 14 * HOUR).length).toBeLessThanOrEqual(7)
  })

  // A 40-minute nap contains no whole hour; an axis with no ticks reads broken.
  it('labels the bounds when the session contains no whole hour', () => {
    const from = new Date(2026, 7, 17, 13, 10).getTime()
    const to = from + 40 * 60_000
    expect(hourTicks(from, to)).toEqual([from, to])
  })

  it('returns nothing for a zero-length or reversed session', () => {
    expect(hourTicks(START, START)).toEqual([])
    expect(hourTicks(END, START)).toEqual([])
  })
})

// The hypnogram cannot be rendered here (no DOM), so the geometry carries the
// checks you would otherwise make by looking at it.
describe('hypnogramLayout', () => {
  const segments = [
    segment('light', START, START + 2 * HOUR),
    segment('deep', START + 2 * HOUR, START + 3.5 * HOUR),
    segment('awake', START + 3.5 * HOUR, START + 4 * HOUR),
    segment('rem', START + 4 * HOUR, END),
  ]

  it('keeps every bar inside the plot box', () => {
    const layout = hypnogramLayout({ segments, startMs: START, endMs: END, ...BOX })
    const right = BOX.width - BOX.padRight
    for (const item of layout.placed) {
      expect(item.x).toBeGreaterThanOrEqual(BOX.padLeft)
      expect(item.x + item.width).toBeLessThanOrEqual(right + 0.01)
    }
  })

  it('puts each stage in its own lane, awake at the top and deep at the bottom', () => {
    const layout = hypnogramLayout({ segments, startMs: START, endMs: END, ...BOX })
    expect(layout.lanes.map((lane) => lane.stage)).toEqual(['awake', 'rem', 'light', 'deep'])
    const laneY = new Map(layout.lanes.map((lane) => [lane.stage, lane.y]))
    for (const item of layout.placed) {
      expect(item.y).toBe(laneY.get(item.segment.stage))
    }
  })

  it('places bars in clock order across the night', () => {
    const layout = hypnogramLayout({ segments, startMs: START, endMs: END, ...BOX })
    const xs = layout.placed.map((item) => item.x)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
  })

  // A stage array occasionally runs a few seconds past endTime.
  it('clamps a segment that overruns the session end', () => {
    const layout = hypnogramLayout({
      segments: [segment('light', START, END + 10 * 60_000)],
      startMs: START,
      endMs: END,
      ...BOX,
    })
    const item = layout.placed[0]
    expect(item.x + item.width).toBeLessThanOrEqual(BOX.width - BOX.padRight + 0.01)
  })

  it('widens a sliver so a 30-second wake is still visible', () => {
    const layout = hypnogramLayout({
      segments: [segment('awake', START + HOUR, START + HOUR + 30_000)],
      startMs: START,
      endMs: END,
      ...BOX,
    })
    expect(layout.placed[0].width).toBeGreaterThanOrEqual(2)
  })

  it('drops nothing and divides by nothing when start equals end', () => {
    const layout = hypnogramLayout({
      segments: [segment('light', START, START)],
      startMs: START,
      endMs: START,
      ...BOX,
    })
    expect(layout.lanes).toHaveLength(4)
    expect(layout.placed.every((item) => Number.isFinite(item.x) && Number.isFinite(item.width))).toBe(
      true,
    )
  })

  it('handles an empty night without collapsing the lanes', () => {
    const layout = hypnogramLayout({ segments: [], startMs: START, endMs: END, ...BOX })
    expect(layout.placed).toEqual([])
    expect(layout.lanes).toHaveLength(4)
    expect(layout.height).toBe(BOX.padTop + 4 * BOX.laneHeight)
  })
})

describe('clockLabel', () => {
  it('is 24-hour and zero-padded, because a night crosses midnight', () => {
    expect(clockLabel(new Date(2026, 7, 16, 23, 5))).toBe('23:05')
    expect(clockLabel(new Date(2026, 7, 17, 0, 40))).toBe('00:40')
  })
})
