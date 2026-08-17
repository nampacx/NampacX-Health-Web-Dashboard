/** Axis maths for the line charts. Pure, so it can be tested without a DOM. */

/** Rounds a rough step up to the nearest 1, 2, 5 × 10^n. */
function niceStep(rough: number): number {
  if (rough <= 0 || !Number.isFinite(rough)) return 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
  const normalized = rough / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

export interface Scale {
  min: number
  max: number
  ticks: number[]
}

/**
 * Snaps a value range out to round numbers, so the axis reads 80 / 82 / 84
 * rather than 80.3 / 82.15 / 84. A flat series (every weigh-in identical) has
 * no range at all, so it gets an arbitrary band around the value instead of a
 * zero-height plot.
 */
export function niceScale(min: number, max: number, targetTicks = 4): Scale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] }

  let lo = Math.min(min, max)
  let hi = Math.max(min, max)
  if (lo === hi) {
    lo -= 1
    hi += 1
  }

  const step = niceStep((hi - lo) / Math.max(1, targetTicks))
  const niceMin = Math.floor(lo / step) * step
  const niceMax = Math.ceil(hi / step) * step

  const ticks: number[] = []
  // The epsilon keeps the last tick from being dropped by float drift.
  for (let value = niceMin; value <= niceMax + step / 1e6; value += step) {
    ticks.push(Number(value.toPrecision(12)))
  }

  return { min: niceMin, max: niceMax, ticks }
}

/**
 * Which point indices get an x-axis label. Every measurement is a dot, but
 * labelling all of them collides the moment the lookback window widens, so the
 * labels thin out while the dots stay.
 */
export function labelledIndices(count: number, maxLabels = 6): number[] {
  if (count <= 0) return []
  if (count <= maxLabels) return Array.from({ length: count }, (_, index) => index)

  const stride = Math.ceil((count - 1) / (maxLabels - 1))
  const indices: number[] = []
  for (let index = 0; index < count; index += stride) indices.push(index)
  // The most recent reading is the one people look for; always label it.
  if (indices[indices.length - 1] !== count - 1) indices.push(count - 1)
  return indices
}

/** `17/8` — the short day/month the charts label their x-axis with. */
export function shortDate(date: Date): string {
  return `${date.getDate()}/${date.getMonth() + 1}`
}

export interface LayoutInput {
  /** Epoch milliseconds, oldest first. */
  times: number[]
  values: number[]
  width: number
  padLeft: number
  padRight: number
  padTop: number
  plotHeight: number
  maxLabels?: number
  minLabelGap?: number
}

export interface Layout {
  coords: Array<{ x: number; y: number }>
  scale: Scale
  ticks: Array<{ value: number; y: number }>
  labels: Array<{ index: number; x: number }>
}

/**
 * All of the chart's geometry, with no DOM involved — which is the only way to
 * check it, since the chart itself cannot render without a connected Withings
 * account. The invariants worth holding (nothing escapes the plot box, labels
 * never collide) are asserted in scale.test.ts.
 */
export function chartLayout({
  times,
  values,
  width,
  padLeft,
  padRight,
  padTop,
  plotHeight,
  maxLabels = 6,
  minLabelGap = 34,
}: LayoutInput): Layout {
  const plotWidth = Math.max(1, width - padLeft - padRight)
  const scale = niceScale(Math.min(...values), Math.max(...values))
  const valueSpan = scale.max - scale.min || 1

  const first = Math.min(...times)
  const last = Math.max(...times)
  const timeSpan = last - first

  // A single reading — or several at the same instant — has no span to spread
  // across, so it sits in the middle rather than dividing by zero.
  const xFor = (time: number) =>
    timeSpan === 0 ? padLeft + plotWidth / 2 : padLeft + ((time - first) / timeSpan) * plotWidth
  const yFor = (value: number) => padTop + plotHeight - ((value - scale.min) / valueSpan) * plotHeight

  const coords = times.map((time, index) => ({ x: xFor(time), y: yFor(values[index]) }))
  const ticks = scale.ticks.map((value) => ({ value, y: yFor(value) }))

  // Thin the labels, then drop any that would still collide — a time axis
  // spaces points unevenly, so thinning by count alone is not enough.
  const labels: Array<{ index: number; x: number }> = []
  for (const index of labelledIndices(times.length, maxLabels)) {
    const x = coords[index].x
    const previous = labels[labels.length - 1]
    if (previous && Math.abs(x - previous.x) < minLabelGap) continue
    labels.push({ index, x })
  }

  return { coords, scale, ticks, labels }
}
