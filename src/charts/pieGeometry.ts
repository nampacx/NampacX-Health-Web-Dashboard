/**
 * Arc maths for `PieChart`, split out for the same reason `scale.ts` and
 * `hypnogramScale.ts` are: the geometry is the part that can be wrong in a way
 * nobody notices, and the test suite runs without jsdom, so anything left inside
 * the component is untestable.
 */

export interface PieArc<T> {
  item: T
  /** Fraction of the whole, 0–1. */
  share: number
  /** Cumulative fraction where this arc starts and ends. */
  from: number
  to: number
}

export interface Point {
  x: number
  y: number
}

/**
 * A point on the circle at `fraction` of the way round.
 *
 * Rotated a quarter turn back so the first slice starts at 12 o'clock and they
 * run clockwise, which is what a reader expects and what makes the first slice
 * comparable across cards.
 */
export function polarPoint(cx: number, cy: number, radius: number, fraction: number): Point {
  const angle = fraction * 2 * Math.PI - Math.PI / 2
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) }
}

/**
 * Cumulative arcs for the slices that actually have a value.
 *
 * Zero and negative values are dropped rather than drawn: a zero-width wedge
 * still paints its 2px separator stroke, which shows up as a stray spoke across
 * the pie.
 */
export function pieArcs<T>(items: T[], valueOf: (item: T) => number): Array<PieArc<T>> {
  const present = items.filter((item) => valueOf(item) > 0)
  const total = present.reduce((sum, item) => sum + valueOf(item), 0)
  if (total <= 0) return []

  let cursor = 0
  return present.map((item) => {
    const share = valueOf(item) / total
    const from = cursor
    cursor += share
    return { item, share, from, to: cursor }
  })
}

/** An SVG wedge from the centre, out to the arc, and back. */
export function arcPath(
  cx: number,
  cy: number,
  radius: number,
  from: number,
  to: number,
): string {
  const start = polarPoint(cx, cy, radius, from)
  const end = polarPoint(cx, cy, radius, to)
  // The arc flag has to flip past a half turn or SVG draws the short way round.
  const largeArc = to - from > 0.5 ? 1 : 0
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`
}

/**
 * Whether a slice fills the whole circle. Such an arc starts and ends at the
 * same point, which SVG renders as nothing at all, so the caller draws a plain
 * circle instead.
 */
export function isFullCircle(share: number): boolean {
  return share >= 0.999
}
