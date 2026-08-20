import { buildSummaryRows } from '../api/bloodwork/summary'
import type { BloodworkResultsByDate } from '../api/bloodwork/types'

interface Props {
  resultsByDate: BloodworkResultsByDate
}

/** One row per analyte across every report, holding only its latest value. */
export default function BloodworkSummaryTable({ resultsByDate }: Props) {
  const rows = buildSummaryRows(resultsByDate)

  if (rows.length === 0) {
    return (
      <section className="card empty">
        <h2>Nothing to show</h2>
        <p className="muted">Upload a lab report to see a summary here.</p>
      </section>
    )
  }

  return (
    <div className="bloodwork-table-scroll">
      <table className="bloodwork-table">
        <thead>
          <tr>
            <th>Analyte</th>
            <th>Result</th>
            <th>Unit</th>
            <th>Reference range</th>
            <th>Flag</th>
            <th>Text</th>
            <th>Last tested</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ analyse, label, lastTested, row }) => (
            <tr key={analyse}>
              <th scope="row">{label}</th>
              <td className="num">{row.ergebniswert}</td>
              <td>{row.einheit}</td>
              <td>{row.normbereich}</td>
              <td>{row.flag}</td>
              <td>{row.ergebnistext}</td>
              <td>{lastTested}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
