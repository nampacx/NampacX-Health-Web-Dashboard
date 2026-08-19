import { useState } from 'react'
import type { BloodworkCorrectionPatch, BloodworkResultRow } from '../api/bloodwork/types'

interface Props {
  date: string
  rows: BloodworkResultRow[]
  correcting: boolean
  onCorrect: (reportDate: string, rowKey: string, patch: BloodworkCorrectionPatch) => void
}

function draftFrom(row: BloodworkResultRow): BloodworkCorrectionPatch {
  return {
    ergebniswert: row.ergebniswert,
    einheit: row.einheit,
    normbereich: row.normbereich,
    flag: row.flag,
    ergebnistext: row.ergebnistext,
  }
}

/** One report date's parsed analytes, editable inline -- one row per lab code. */
export default function BloodworkReportCard({ date, rows, correcting, onCorrect }: Props) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<BloodworkCorrectionPatch>({})

  function startEdit(row: BloodworkResultRow) {
    setEditingKey(row.rowKey)
    setDraft(draftFrom(row))
  }

  function save(rowKey: string) {
    onCorrect(date, rowKey, draft)
    setEditingKey(null)
  }

  return (
    <li className="card bloodwork-report">
      <div className="record-head">
        <h3>{date}</h3>
        <span className="muted">
          {rows.length} {rows.length === 1 ? 'result' : 'results'}
        </span>
      </div>
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
              <th className="visually-hidden">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isEditing = editingKey === row.rowKey
              return (
                <tr key={row.rowKey}>
                  <th scope="row">
                    {row.bezeichnung || row.analyse}
                    {row.corrected && <span className="pill bloodwork-corrected-pill">edited</span>}
                  </th>
                  {isEditing ? (
                    <>
                      <td>
                        <input
                          className="bloodwork-cell-input"
                          value={draft.ergebniswert ?? ''}
                          onChange={(event) =>
                            setDraft((d) => ({ ...d, ergebniswert: event.target.value }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="bloodwork-cell-input"
                          value={draft.einheit ?? ''}
                          onChange={(event) => setDraft((d) => ({ ...d, einheit: event.target.value }))}
                        />
                      </td>
                      <td>
                        <input
                          className="bloodwork-cell-input"
                          value={draft.normbereich ?? ''}
                          onChange={(event) =>
                            setDraft((d) => ({ ...d, normbereich: event.target.value }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="bloodwork-cell-input"
                          value={draft.flag ?? ''}
                          onChange={(event) => setDraft((d) => ({ ...d, flag: event.target.value }))}
                        />
                      </td>
                      <td>
                        <input
                          className="bloodwork-cell-input"
                          value={draft.ergebnistext ?? ''}
                          onChange={(event) =>
                            setDraft((d) => ({ ...d, ergebnistext: event.target.value }))
                          }
                        />
                      </td>
                      <td className="bloodwork-row-actions">
                        <button
                          type="button"
                          className="btn btn-small"
                          onClick={() => save(row.rowKey)}
                          disabled={correcting}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn btn-small btn-ghost"
                          onClick={() => setEditingKey(null)}
                          disabled={correcting}
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="num">{row.ergebniswert}</td>
                      <td>{row.einheit}</td>
                      <td>{row.normbereich}</td>
                      <td>{row.flag}</td>
                      <td>{row.ergebnistext}</td>
                      <td className="bloodwork-row-actions">
                        <button type="button" className="btn btn-small btn-ghost" onClick={() => startEdit(row)}>
                          Edit
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </li>
  )
}
