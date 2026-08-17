import { useGoogleAuth } from './auth/google/GoogleAuthContext'
import { useWithingsAuth } from './auth/withings/WithingsAuthContext'
import Dashboard from './components/Dashboard'
import Header from './components/Header'
import SignIn from './components/SignIn'
import SleepSection from './components/SleepSection'
import Tabs, { tabPanelId } from './components/Tabs'
import TechnicalDetails from './components/TechnicalDetails'
import TimeRangeSelect from './components/TimeRangeSelect'
import WithingsConnect from './components/WithingsConnect'
import WithingsSection from './components/WithingsSection'
import { useGoogleData } from './state/googleData'
import { useTabState, type TabId } from './state/tabs'
import { useWithingsData } from './state/withingsData'

export default function App() {
  const google = useGoogleAuth()
  const withings = useWithingsAuth()
  const { visible, records, outcomes } = useGoogleData()
  const { groups } = useWithingsData()
  const [tab, setTab] = useTabState()

  const signedIn = google.status === 'signed-in'
  const connected = withings.status === 'connected'
  const anyConnected = signedIn || connected
  const bothStillLoading = google.status === 'loading' && withings.status === 'loading'

  const failedCount = outcomes.filter((outcome) => outcome.status === 'error').length
  const sleepCount = records.filter((record) => record.dataType.id === 'sleep').length
  const badges: Partial<Record<TabId, string>> = {
    google: signedIn ? String(visible.length) : undefined,
    sleep: signedIn ? String(sleepCount) : undefined,
    withings: connected ? String(groups.length) : undefined,
    technical: failedCount > 0 ? `${failedCount} !` : undefined,
  }

  // Each tab renders its provider's data, or that provider's connect prompt —
  // so the tab bar stays stable and you can connect the second provider from
  // its own tab rather than hunting for a card underneath the first one.
  function panel() {
    switch (tab) {
      case 'google':
        return google.status === 'loading' ? (
          <p className="muted">Restoring Google session…</p>
        ) : signedIn ? (
          <Dashboard />
        ) : (
          <SignIn />
        )
      case 'sleep':
        return google.status === 'loading' ? (
          <p className="muted">Restoring Google session…</p>
        ) : signedIn ? (
          <SleepSection />
        ) : (
          <SignIn />
        )
      case 'withings':
        return withings.status === 'loading' ? (
          <p className="muted">Restoring Withings session…</p>
        ) : connected ? (
          <WithingsSection />
        ) : (
          <WithingsConnect />
        )
      case 'technical':
        return <TechnicalDetails />
    }
  }

  return (
    <div className="app">
      <Header />
      <main className="main">
        {bothStillLoading ? (
          <p className="muted">Restoring session…</p>
        ) : !anyConnected ? (
          // Nothing to navigate between yet, so tabs would be noise. Show both
          // ways in, exactly as before.
          <>
            <SignIn />
            <WithingsConnect />
          </>
        ) : (
          <>
            <TimeRangeSelect />
            <Tabs active={tab} onChange={setTab} badges={badges} />
            <div
              className="tab-panel"
              id={tabPanelId(tab)}
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
              tabIndex={-1}
            >
              {panel()}
            </div>
          </>
        )}
      </main>
      <footer className="footer">
        Data from the{' '}
        <a href="https://developers.google.com/health/about" target="_blank" rel="noreferrer">
          Google Health API
        </a>{' '}
        and the{' '}
        <a
          href="https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/public-health-data-api-overview"
          target="_blank"
          rel="noreferrer"
        >
          Withings API
        </a>{' '}
        · read-only
      </footer>
    </div>
  )
}
