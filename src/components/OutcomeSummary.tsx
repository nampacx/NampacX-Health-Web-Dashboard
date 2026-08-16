import type { FetchOutcome } from '../types'

export default function OutcomeSummary({ outcomes }: { outcomes: FetchOutcome[] }) {
  const failed = outcomes.filter((outcome) => outcome.status === 'error')
  if (failed.length === 0) return null

  return (
    <details className="card banner-warn outcomes">
      <summary>
        {failed.length} of {outcomes.length} data types failed to load
      </summary>
      <ul>
        {failed.map((outcome) => (
          <li key={outcome.dataType.id}>
            <strong>{outcome.dataType.label}</strong> — {outcome.error}
          </li>
        ))}
      </ul>
    </details>
  )
}
