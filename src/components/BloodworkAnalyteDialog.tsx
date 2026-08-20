import { useEffect, useMemo, useRef } from 'react'
import {
  buildAnalyteHistory,
  formatReportDate,
  inferDecimals,
  parseAnalyteValue,
  reportDateToUtcDate,
} from '../api/bloodwork/analyteHistory'
import type { BloodworkResultsByDate } from '../api/bloodwork/types'
import LineChart from '../charts/LineChart'

interface Props {
  resultsByDate: BloodworkResultsByDate
  /** Null closes the dialog -- there's nothing to look up. */
  analyse: string | null
  onClose: () => void
}

/** Every recorded value for one analyte: a trend line plus the full history
 * table, opened from a click on its row in the summary view. */
export default function BloodworkAnalyteDialog({ resultsByDate, analyse, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  // <dialog> owns its own open/closed state; this keeps it in sync with
  // `analyse` going from null to a value and back, in either direction --
  // Esc and the backdrop click close it natively, so onClose has to be able
  // to fire from inside the element too, not just from our own button.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (analyse !== null && !dialog.open) dialog.showModal()
    if (analyse === null && dialog.open) dialog.close()
  }, [analyse])

  const history = useMemo(
    () => (analyse === null ? [] : buildAnalyteHistory(resultsByDate, analyse)),
    [resultsByDate, analyse],
  )

  const points = useMemo(
    () =>
      history.flatMap(({ date, row }) => {
        const value = parseAnalyteValue(row.ergebniswert)
        return value === null ? [] : [{ at: reportDateToUtcDate(date), value }]
      }),
    [history],
  )

  const latestRow = history.at(-1)?.row
  const label = latestRow?.bezeichnung || analyse || ''
  const unit = latestRow?.einheit ?? ''
  const decimals = useMemo(() => inferDecimals(history.map(({ row }) => row.ergebniswert)), [history])

  return (
    <dialog
      ref={dialogRef}
      className="bloodwork-analyte-dialog"
      onClose={onClose}
      onClick={(event) => {
        // A click that lands on the <dialog> element itself, not anything
        // inside it, is a click on the backdrop.
        if (event.target === event.currentTarget) dialogRef.current?.close()
      }}
    >
      {analyse !== null && (
        <>
          <div className="dialog-head">
            <h2>{label}</h2>
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick={() => dialogRef.current?.close()}
            >
              Close
            </button>
          </div>

          <LineChart
            title={label}
            unit={unit}
            decimals={decimals}
            colorVar="--series-weight"
            points={points}
            xLabel={formatReportDate}
            pointLabel={formatReportDate}
          />

          <div className="bloodwork-table-scroll">
            <table className="bloodwork-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Result</th>
                  <th>Unit</th>
                  <th>Reference range</th>
                  <th>Flag</th>
                  <th>Text</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map(({ date, row }) => (
                  <tr key={`${date}-${row.rowKey}`}>
                    <td>{date}</td>
                    <td className="num">{row.ergebniswert}</td>
                    <td>{row.einheit}</td>
                    <td>{row.normbereich}</td>
                    <td>{row.flag}</td>
                    <td>{row.ergebnistext}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </dialog>
  )
}
