import type { HealthRecord } from '../api/google/types'

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

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

export default function RecordRow({ record }: { record: HealthRecord }) {
  return (
    <li className="record">
      <div className="record-main">
        <div className="record-head">
          <span className="badge">{record.dataType.label}</span>
          <span className="record-category">{record.dataType.category}</span>
        </div>

        <p className="record-summary">{record.summary ?? 'No readable value'}</p>

        {record.details.length > 0 && (
          <ul className="record-details">
            {record.details.map((detail, index) => (
              // Labels are the last path segment, so they can repeat across
              // nested objects — pair with the index to keep keys unique.
              <li key={`${detail.label}:${index}`}>
                <span className="detail-label">{detail.label}</span>
                <span className="detail-value">{detail.value}</span>
              </li>
            ))}
          </ul>
        )}

        <details className="raw">
          <summary>Raw JSON</summary>
          <pre>{JSON.stringify(record.raw, null, 2)}</pre>
        </details>
      </div>

      <div className="record-meta">
        {record.timestamp ? (
          <>
            <time dateTime={record.timestamp.toISOString()}>
              {dateTimeFormat.format(record.timestamp)}
            </time>
            <span className="muted">{relativeLabel(record.timestamp)}</span>
          </>
        ) : (
          <span className="muted">No timestamp</span>
        )}
        {record.source && <span className="source">{record.source}</span>}
      </div>
    </li>
  )
}
