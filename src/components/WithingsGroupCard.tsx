import type { Measure, MeasureGroup } from '../api/withingsTypes'
import { formatDelta, formatMeasureValue } from '../api/withingsMeasureTypes'

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** Mirrors RecordRow.tsx's relativeLabel; small enough that duplicating beats coupling. */
function relativeLabel(date: Date): string {
  const diffMs = date.getTime() - Date.now()
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ]
  for (const [unit, ms] of units) {
    if (Math.abs(diffMs) >= ms) return relativeFormat.format(Math.round(diffMs / ms), unit)
  }
  return relativeFormat.format(Math.round(diffMs / 1000), 'second')
}

const PROVENANCE_LABEL: Record<MeasureGroup['provenance'], string> = {
  device: 'Device',
  manual: 'Manual',
  auto: 'Auto',
}

function findDelta(measure: Measure, previous: MeasureGroup | undefined): string | null {
  if (!previous) return null
  const match = previous.measures.find((m) => m.type === measure.type)
  if (!match) return null
  const delta = measure.value - match.value
  if (delta === 0) return null
  return formatDelta(delta, measure.type, measure.unit)
}

interface Props {
  group: MeasureGroup
  /** The chronologically previous group, for the Δ chips. Undefined for the oldest entry. */
  previous?: MeasureGroup
}

export default function WithingsGroupCard({ group, previous }: Props) {
  const [headline, ...rest] = group.measures
  const headlineDelta = headline ? findDelta(headline, previous) : null

  return (
    <li className="record">
      <div className="record-main">
        <div className="record-head">
          <span className="badge">{headline ? headline.label : 'Weigh-in'}</span>
          <span className="record-category">{PROVENANCE_LABEL[group.provenance]}</span>
        </div>

        {headline && (
          <p className="record-summary">
            {formatMeasureValue(headline)}
            {headlineDelta && <span className="delta"> {headlineDelta}</span>}
          </p>
        )}

        {rest.length > 0 && (
          <ul className="record-details">
            {rest.map((measure) => {
              const delta = findDelta(measure, previous)
              return (
                <li key={measure.type}>
                  <span className="detail-label">{measure.label}</span>
                  <span className="detail-value">
                    {formatMeasureValue(measure)}
                    {delta && <span className="delta"> {delta}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        <details className="raw">
          <summary>Raw JSON</summary>
          <pre>{JSON.stringify(group.raw, null, 2)}</pre>
        </details>
      </div>

      <div className="record-meta">
        <time dateTime={group.date.toISOString()}>{dateTimeFormat.format(group.date)}</time>
        <span className="muted">{relativeLabel(group.date)}</span>
      </div>
    </li>
  )
}
