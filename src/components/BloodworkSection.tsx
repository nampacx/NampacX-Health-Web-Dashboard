import BloodworkReportCard from './BloodworkReportCard'
import BloodworkUpload from './BloodworkUpload'
import { useBloodworkData } from '../state/bloodworkData'

export default function BloodworkSection() {
  const {
    resultsByDate,
    loading,
    error,
    loadedAt,
    reload,
    jobs,
    upload,
    uploading,
    uploadError,
    correct,
    correcting,
    correctError,
  } = useBloodworkData()

  // Report dates are ISO YYYY-MM-DD, so a plain string sort is also a
  // chronological one -- newest first, matching every other list in the app.
  const dates = Object.keys(resultsByDate).sort().reverse()

  return (
    <>
      <BloodworkUpload jobs={jobs} uploading={uploading} uploadError={uploadError} onUpload={upload} />

      <div className="list-header">
        <h2>Lab results</h2>
        <div className="list-header-actions">
          <span className="muted">
            {dates.length} {dates.length === 1 ? 'report' : 'reports'}
            {loadedAt && ` · updated ${loadedAt.toLocaleTimeString()}`}
          </span>
          <button type="button" className="btn btn-small" onClick={reload} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <p className="banner banner-error">{error}</p>}
      {correctError && <p className="banner banner-error">{correctError}</p>}

      {loading && dates.length === 0 ? (
        <p className="muted">Loading your bloodwork results…</p>
      ) : dates.length === 0 ? (
        <section className="card empty">
          <h2>Nothing to show</h2>
          <p className="muted">Upload a lab report above to see parsed results here.</p>
        </section>
      ) : (
        <ul className="records">
          {dates.map((date) => (
            <BloodworkReportCard
              key={date}
              date={date}
              rows={resultsByDate[date]}
              correcting={correcting}
              onCorrect={correct}
            />
          ))}
        </ul>
      )}
    </>
  )
}
