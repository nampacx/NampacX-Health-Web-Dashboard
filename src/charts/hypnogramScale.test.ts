import { describe, expect, it } from 'vitest'
import { clockLabel, type StageSegment } from '../api/google/sleep'
import { hourTicks, hypnogramLayout } from './hypnogramScale'

const BOX = { width: 600, padLeft: 52, padRight: 12, padTop: 8, laneHeight: 30 }
const HOUR = 3_600_000
const OFFSET = 7200 // +02:00, as on the captured fixture night

// Built from UTC instants with an explicit offset rather than local Dates, so
// the assertions mean the same thing on a CI runner in any zone.
const START = Date.UTC(2026, 7, 16, 20, 18) // 22:18 local
const END = Date.UTC(2026, 7, 17, 4, 16) //  06:16 local

function segment(stage: StageSegment['stage'], fromMs: number, toMs: number): StageSegment {
  return { stage, start: new Date(fromMs), end: new Date(toMs), durationMs: toMs - fromMs }
}

const SEGMENTS = [
  segment('awake', START, START + 7 * 60_000),
  segment('light', START + 7 * 60_000, START + 2 * HOUR),
  segment('deep', START + 2 * HOUR, START + 3.5 * HOUR),
  segment('rem', START + 3.5 * HOUR, END),
]

describe('hourTicks', () => {
  // The load-bearing case: hours must be whole in the *recording* zone. At
  // +02:00 the first mark after a 22:18 bedtime is 23:00 local = 21:00Z.
  it('lands on whole hours in the recording zone, not in UTC', () => {
    const ticks = hourTicks(START, START + 3 * HOUR, OFFSET)
    expect(ticks.map((at) => clockLabel(new Date(at), OFFSET))).toEqual([
      '23:00',
      '00:00',
      '01:00',
    ])
  })

  it('agrees with UTC hours when there is no offset', () => {
    const ticks = hourTicks(START, START + 2 * HOUR, 0)
    expect(ticks.map((at) => clockLabel(new Date(at), 0))).toEqual(['21:00', '22:00'])
  })

  it('handles a negative offset', () => {
    const ticks = hourTicks(START, START + 2 * HOUR, -18000) // -05:00
    expect(clockLabel(new Date(ticks[0]), -18000)).toBe('16:00')
  })

  it('thins a long night rather than crowding the axis', () => {
    expect(hourTicks(START, START + 14 * HOUR, OFFSET).length).toBeLessThanOrEqual(7)
  })

  // A 40-minute nap contains no whole hour; an axis with no ticks reads broken.
  it('labels the bounds when the session contains no whole hour', () => {
    const from = Date.UTC(2026, 7, 17, 13, 10)
    const to = from + 40 * 60_000
    expect(hourTicks(from, to, OFFSET)).toEqual([from, to])
  })

  it('returns nothing for a zero-length or reversed session', () => {
    expect(hourTicks(START, START, OFFSET)).toEqual([])
    expect(hourTicks(END, START, OFFSET)).toEqual([])
  })
})

// The hypnogram cannot be rendered here (no DOM), so the geometry carries the
// checks you would otherwise make by looking at it.
describe('hypnogramLayout', () => {
  const layout = hypnogramLayout({
    segments: SEGMENTS,
    startMs: START,
    endMs: END,
    offsetSeconds: OFFSET,
    ...BOX,
  })

  it('keeps every bar inside the plot box', () => {
    const right = BOX.width - BOX.padRight
    for (const item of layout.placed) {
      expect(item.x).toBeGreaterThanOrEqual(BOX.padLeft)
      expect(item.x + item.width).toBeLessThanOrEqual(right + 0.01)
    }
  })

  it('puts each stage in its own lane, awake at the top and deep at the bottom', () => {
    expect(layout.lanes.map((lane) => lane.stage)).toEqual(['awake', 'rem', 'light', 'deep'])
    const laneY = new Map(layout.lanes.map((lane) => [lane.stage, lane.y]))
    for (const item of layout.placed) {
      expect(item.y).toBe(laneY.get(item.segment.stage))
    }
  })

  it('places bars in clock order across the night', () => {
    const xs = layout.placed.map((item) => item.x)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
  })

  it('labels the axis in local time', () => {
    expect(layout.ticks[0].label).toBe('23:00')
  })

  // A stage array occasionally runs a few seconds past endTime.
  it('clamps a segment that overruns the session end', () => {
    const clamped = hypnogramLayout({
      segments: [segment('light', START, END + 10 * 60_000)],
      startMs: START,
      endMs: END,
      offsetSeconds: OFFSET,
      ...BOX,
    })
    expect(clamped.placed[0].x + clamped.placed[0].width).toBeLessThanOrEqual(
      BOX.width - BOX.padRight + 0.01,
    )
  })

  it('widens a sliver so a 30-second wake is still visible', () => {
    const sliver = hypnogramLayout({
      segments: [segment('awake', START + HOUR, START + HOUR + 30_000)],
      startMs: START,
      endMs: END,
      offsetSeconds: OFFSET,
      ...BOX,
    })
    expect(sliver.placed[0].width).toBeGreaterThanOrEqual(2)
  })

  it('divides by nothing when start equals end', () => {
    const degenerate = hypnogramLayout({
      segments: [segment('light', START, START)],
      startMs: START,
      endMs: START,
      offsetSeconds: OFFSET,
      ...BOX,
    })
    expect(degenerate.lanes).toHaveLength(4)
    expect(
      degenerate.placed.every((item) => Number.isFinite(item.x) && Number.isFinite(item.width)),
    ).toBe(true)
  })

  it('handles an empty night without collapsing the lanes', () => {
    const empty = hypnogramLayout({
      segments: [],
      startMs: START,
      endMs: END,
      offsetSeconds: OFFSET,
      ...BOX,
    })
    expect(empty.placed).toEqual([])
    expect(empty.lanes).toHaveLength(4)
    expect(empty.height).toBe(BOX.padTop + 4 * BOX.laneHeight)
  })
})

describe('clockLabel', () => {
  it('is 24-hour and zero-padded, because a night crosses midnight', () => {
    expect(clockLabel(new Date(START), OFFSET)).toBe('22:18')
    expect(clockLabel(new Date(END), OFFSET)).toBe('06:16')
  })
})
