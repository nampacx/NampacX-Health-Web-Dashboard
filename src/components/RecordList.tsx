import type { HealthRecord } from '../types'
import RecordRow from './RecordRow'

interface Props {
  records: HealthRecord[]
  loading: boolean
}

export default function RecordList({ records, loading }: Props) {
  if (loading && records.length === 0) {
    return <p className="muted">Loading your latest health data…</p>
  }

  if (records.length === 0) {
    return (
      <section className="card empty">
        <h2>Nothing to show</h2>
        <p className="muted">
          No data points came back. Widen the time range, pick more data types, or confirm that the
          signed-in Google account actually has Google Health data.
        </p>
      </section>
    )
  }

  return (
    <ul className="records">
      {records.map((record) => (
        <RecordRow key={record.key} record={record} />
      ))}
    </ul>
  )
}
