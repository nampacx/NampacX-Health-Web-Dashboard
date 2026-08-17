import { useGoogleData } from '../state/googleData'
import Controls from './Controls'
import OutcomeSummary from './OutcomeSummary'
import RecordList from './RecordList'

export default function Dashboard() {
  const { controls, setControls, visible, outcomes, loading, error, loadedAt, reload } =
    useGoogleData()

  return (
    <>
      <Controls state={controls} onChange={setControls} onRefresh={reload} loading={loading} />

      {error && <p className="banner banner-error">{error}</p>}
      <OutcomeSummary outcomes={outcomes} />

      <div className="list-header">
        <h2>Latest activity &amp; sleep</h2>
        <span className="muted">
          {visible.length} {visible.length === 1 ? 'record' : 'records'}
          {loadedAt && ` · updated ${loadedAt.toLocaleTimeString()}`}
        </span>
      </div>

      <RecordList records={visible} loading={loading} />
    </>
  )
}
