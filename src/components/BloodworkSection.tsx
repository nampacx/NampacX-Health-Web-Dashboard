import BloodworkReportCard from './BloodworkReportCard'
import BloodworkSummaryTable from './BloodworkSummaryTable'
import BloodworkUpload from './BloodworkUpload'
import { useBloodworkData } from '../state/bloodworkData'
import { BLOODWORK_TAB_IDS, BLOODWORK_TAB_LABELS, useBloodworkTabState } from '../state/tabs'
import Tabs, { tabButtonId, tabPanelId } from './Tabs'

const BLOODWORK_TAB_ITEMS = BLOODWORK_TAB_IDS.map((id) => ({
  id,
  label: BLOODWORK_TAB_LABELS[id],
}))

export default function BloodworkSection() {
  const {
    resultsByDate,
    truncated,
    loading,
    error,
    loadedAt,
    reload,
    needsAuthorization,
    authorize,
    jobs,
    upload,
    uploading,
    uploadError,
    correct,
    correcting,
    correctError,
    remove,
    removing,
    removeError,
  } = useBloodworkData()
  const [activeTab, setActiveTab] = useBloodworkTabState()

  // Report dates are ISO YYYY-MM-DD, so a plain string sort is also a
  // chronological one -- newest first, matching every other list in the app.
  const dates = Object.keys(resultsByDate).sort().reverse()

  // Not a lapsed sign-in, so it must not read like one. The Google session is
  // fine; what failed is minting the separate, narrowly-scoped token this API is
  // sent, and the usual cause is a popup blocked outside a user gesture -- which
  // a click fixes.
  if (needsAuthorization) {
    return (
      <section className="card signin">
        <h2>One more step</h2>
        <p className="muted">
          Bloodwork uses its own limited Google token — one that proves who you are and nothing
          else, so this app&apos;s server never receives access to your Google Health data. Granting
          it needs a click, because browsers block the window it opens otherwise. You are still
          signed in.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => void authorize()}>
          Continue
        </button>
      </section>
    )
  }

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
      {removeError && <p className="banner banner-error">{removeError}</p>}
      {truncated && (
        <p className="banner banner-warn">
          Showing the most recent reports only — there are older ones this response could not fit.
          Nothing has been deleted.
        </p>
      )}

      {loading && dates.length === 0 ? (
        <p className="muted">Loading your bloodwork results…</p>
      ) : dates.length === 0 ? (
        <section className="card empty">
          <h2>Nothing to show</h2>
          <p className="muted">Upload a lab report above to see parsed results here.</p>
        </section>
      ) : (
        <>
          <Tabs
            items={BLOODWORK_TAB_ITEMS}
            active={activeTab}
            onChange={setActiveTab}
            label="Bloodwork views"
            idPrefix="bloodwork"
            variant="sub"
          />

          <div
            role="tabpanel"
            id={tabPanelId('bloodwork', 'summary')}
            aria-labelledby={tabButtonId('bloodwork', 'summary')}
            hidden={activeTab !== 'summary'}
          >
            <BloodworkSummaryTable resultsByDate={resultsByDate} />
          </div>

          <div
            role="tabpanel"
            id={tabPanelId('bloodwork', 'reports')}
            aria-labelledby={tabButtonId('bloodwork', 'reports')}
            hidden={activeTab !== 'reports'}
          >
            <ul className="records">
              {dates.map((date) => (
                <BloodworkReportCard
                  key={date}
                  date={date}
                  rows={resultsByDate[date]}
                  correcting={correcting}
                  onCorrect={correct}
                  removing={removing === date}
                  onRemove={remove}
                />
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  )
}
