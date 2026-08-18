import { describe, expect, it } from 'vitest'
import { arcPath, isFullCircle, pieArcs, polarPoint } from './pieGeometry'

const value = (n: number) => n

describe('polarPoint', () => {
  // A quarter turn back, so slice one starts at 12 o'clock rather than 3.
  it('starts at the top and runs clockwise', () => {
    const top = polarPoint(50, 50, 40, 0)
    expect(top.x).toBeCloseTo(50, 6)
    expect(top.y).toBeCloseTo(10, 6)

    const quarter = polarPoint(50, 50, 40, 0.25)
    expect(quarter.x).toBeCloseTo(90, 6)
    expect(quarter.y).toBeCloseTo(50, 6)

    const half = polarPoint(50, 50, 40, 0.5)
    expect(half.x).toBeCloseTo(50, 6)
    expect(half.y).toBeCloseTo(90, 6)
  })

  it('closes the circle at a full turn', () => {
    const start = polarPoint(50, 50, 40, 0)
    const end = polarPoint(50, 50, 40, 1)
    expect(end.x).toBeCloseTo(start.x, 6)
    expect(end.y).toBeCloseTo(start.y, 6)
  })
})

describe('pieArcs', () => {
  it('lays slices end to end, covering the whole circle', () => {
    const arcs = pieArcs([400, 180, 200], value)
    expect(arcs.map((arc) => arc.from)).toEqual([0, 400 / 780, 580 / 780])
    expect(arcs[arcs.length - 1].to).toBeCloseTo(1, 10)
  })

  it('computes shares against the total, not a fixed scale', () => {
    const arcs = pieArcs([1, 3], value)
    expect(arcs[0].share).toBeCloseTo(0.25, 10)
    expect(arcs[1].share).toBeCloseTo(0.75, 10)
  })

  /**
   * A zero-value slice would still paint its 2px separator stroke, which reads
   * as a stray spoke across the pie -- the classic "why is there a line there"
   * artefact.
   */
  it('drops zero and negative slices entirely', () => {
    expect(pieArcs([5, 0, 5], value)).toHaveLength(2)
    expect(pieArcs([5, -3], value)).toHaveLength(1)
  })

  it('returns nothing when there is no magnitude to draw', () => {
    expect(pieArcs([0, 0], value)).toEqual([])
    expect(pieArcs([], value)).toEqual([])
  })

  it('gives a lone slice the whole circle', () => {
    const [only] = pieArcs([7], value)
    expect(only.share).toBe(1)
    expect(only.from).toBe(0)
    expect(only.to).toBe(1)
  })
})

describe('arcPath', () => {
  // Past a half turn SVG draws the short way round unless the flag is set, which
  // renders the majority slice as the minority one.
  it('sets the large-arc flag only past a half turn', () => {
    expect(arcPath(50, 50, 40, 0, 0.25)).toContain('A 40 40 0 0 1')
    expect(arcPath(50, 50, 40, 0, 0.5)).toContain('A 40 40 0 0 1')
    expect(arcPath(50, 50, 40, 0, 0.75)).toContain('A 40 40 0 1 1')
  })

  it('draws a closed wedge from the centre', () => {
    const path = arcPath(50, 50, 40, 0, 0.25)
    expect(path.startsWith('M 50 50 L')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
  })
})

describe('isFullCircle', () => {
  it('flags the slice that would otherwise render as nothing', () => {
    expect(isFullCircle(1)).toBe(true)
    expect(isFullCircle(0.9995)).toBe(true)
    expect(isFullCircle(0.98)).toBe(false)
  })
})
