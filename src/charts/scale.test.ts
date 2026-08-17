import { describe, expect, it } from 'vitest'
import { chartLayout, labelledIndices, niceScale, shortDate } from './scale'

const BOX = {
  padLeft: 44,
  padRight: 70,
  padTop: 14,
  plotHeight: 150,
  minLabelGap: 34,
}

function layoutOf(values: number[], width = 420, dayGaps?: number[]) {
  const start = Date.UTC(2026, 7, 1, 7)
  const times = values.map((_, index) => start + (dayGaps?.[index] ?? index) * 86_400_000)
  return { layout: chartLayout({ times, values, width, ...BOX }), width }
}

describe('niceScale', () => {
  it('snaps a messy range out to round numbers', () => {
    const scale = niceScale(80.3, 84.15)
    expect(scale.min).toBeLessThanOrEqual(80.3)
    expect(scale.max).toBeGreaterThanOrEqual(84.15)
    expect(scale.ticks.every((tick) => Number.isInteger(tick))).toBe(true)
  })

  it('gives a flat series a band instead of a zero-height plot', () => {
    const scale = niceScale(82, 82)
    expect(scale.max).toBeGreaterThan(scale.min)
    expect(scale.min).toBeLessThanOrEqual(82)
    expect(scale.max).toBeGreaterThanOrEqual(82)
  })

  it('returns ascending ticks that span the domain', () => {
    const { min, max, ticks } = niceScale(12, 47)
    expect(ticks[0]).toBe(min)
    expect(ticks[ticks.length - 1]).toBe(max)
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks)
  })

  it('does not lose the last tick to floating-point drift', () => {
    // 0.1-sized steps are the classic case where `v += step` overshoots.
    const { ticks, max } = niceScale(20.1, 20.5)
    expect(ticks[ticks.length - 1]).toBe(max)
    expect(ticks.every((tick) => Number.isFinite(tick))).toBe(true)
  })

  it('survives a degenerate domain', () => {
    expect(niceScale(Number.NaN, 5).ticks.length).toBeGreaterThan(0)
  })
})

describe('labelledIndices', () => {
  it('labels every point when there are few', () => {
    expect(labelledIndices(4)).toEqual([0, 1, 2, 3])
  })

  it('thins the labels out once they would collide', () => {
    const indices = labelledIndices(30)
    expect(indices.length).toBeLessThanOrEqual(7)
  })

  it('always labels the most recent reading', () => {
    expect(labelledIndices(30).at(-1)).toBe(29)
    expect(labelledIndices(23).at(-1)).toBe(22)
  })

  it('handles an empty series', () => {
    expect(labelledIndices(0)).toEqual([])
  })
})

// The chart cannot be rendered here (no DOM, and the real view needs a
// connected Withings account), so the geometry carries its own checks for the
// things you would otherwise catch by looking: overflow and collisions.
describe('chartLayout', () => {
  it('keeps every point inside the plot box', () => {
    const { layout, width } = layoutOf([82.4, 83.1, 81.9, 82.7, 82.2])
    for (const coord of layout.coords) {
      expect(coord.x).toBeGreaterThanOrEqual(BOX.padLeft)
      expect(coord.x).toBeLessThanOrEqual(width - BOX.padRight)
      expect(coord.y).toBeGreaterThanOrEqual(BOX.padTop)
      expect(coord.y).toBeLessThanOrEqual(BOX.padTop + BOX.plotHeight)
    }
  })

  it('leaves room to the right of the last point for the end label', () => {
    const { layout, width } = layoutOf([82.4, 83.1, 81.9])
    const lastX = layout.coords[layout.coords.length - 1].x
    expect(width - lastX).toBeGreaterThanOrEqual(BOX.padRight)
  })

  it('never places two x labels closer than the collision gap', () => {
    const { layout } = layoutOf(Array.from({ length: 40 }, (_, i) => 80 + (i % 5)))
    for (let i = 1; i < layout.labels.length; i++) {
      expect(layout.labels[i].x - layout.labels[i - 1].x).toBeGreaterThanOrEqual(BOX.minLabelGap)
    }
  })

  it('holds the label gap even when readings bunch on the time axis', () => {
    // Four weigh-ins in two days, then a three-week gap — an even index-based
    // thinning would happily collide the first four.
    const { layout } = layoutOf([82, 82.2, 82.1, 82.4, 81.5], 420, [0, 0, 1, 1, 22])
    for (let i = 1; i < layout.labels.length; i++) {
      expect(layout.labels[i].x - layout.labels[i - 1].x).toBeGreaterThanOrEqual(BOX.minLabelGap)
    }
  })

  it('centres a single reading instead of dividing by zero', () => {
    const { layout, width } = layoutOf([82.4])
    expect(layout.coords).toHaveLength(1)
    expect(layout.coords[0].x).toBeCloseTo(BOX.padLeft + (width - BOX.padLeft - BOX.padRight) / 2)
    expect(Number.isFinite(layout.coords[0].y)).toBe(true)
  })

  it('plots a flat series mid-box rather than on an edge', () => {
    const { layout } = layoutOf([82, 82, 82])
    for (const coord of layout.coords) {
      expect(coord.y).toBeGreaterThan(BOX.padTop)
      expect(coord.y).toBeLessThan(BOX.padTop + BOX.plotHeight)
    }
  })

  it('puts gridlines on the same scale as the points', () => {
    const { layout } = layoutOf([80.2, 84.9])
    const ys = layout.ticks.map((tick) => tick.y)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(BOX.padTop - 0.01)
    expect(Math.max(...ys)).toBeLessThanOrEqual(BOX.padTop + BOX.plotHeight + 0.01)
  })

  it('survives a container too narrow to plot in', () => {
    const { layout } = layoutOf([82, 83], 40)
    expect(layout.coords.every((coord) => Number.isFinite(coord.x) && Number.isFinite(coord.y))).toBe(
      true,
    )
  })
})

describe('shortDate', () => {
  it('formats as day/month with no leading zeros', () => {
    expect(shortDate(new Date(2026, 7, 17))).toBe('17/8')
    expect(shortDate(new Date(2026, 0, 5))).toBe('5/1')
  })
})
