import { useGoogleAuth } from './auth/google/GoogleAuthContext'
import { useWithingsAuth } from './auth/withings/WithingsAuthContext'
import Dashboard from './components/Dashboard'
import Header from './components/Header'
import SignIn from './components/SignIn'
import TimeRangeSelect from './components/TimeRangeSelect'
import WithingsConnect from './components/WithingsConnect'
import WithingsSection from './components/WithingsSection'
import { useTimeRange } from './state/timeRange'

export default function App() {
  const google = useGoogleAuth()
  const withings = useWithingsAuth()
  const { lookbackDays } = useTimeRange()

  // The two providers are independent: either one alone is enough to render
  // the app, so each renders its own section or its own connect card rather
  // than the app gating on both at once.
  const anyConnected = google.status === 'signed-in' || withings.status === 'connected'
  const bothStillLoading = google.status === 'loading' && withings.status === 'loading'

  return (
    <div className="app">
      <Header />
      <main className="main">
        {bothStillLoading ? (
          <p className="muted">Restoring session…</p>
        ) : (
          <>
            {anyConnected && <TimeRangeSelect />}

            {google.status === 'loading' ? (
              <p className="muted">Restoring Google session…</p>
            ) : google.status === 'signed-in' ? (
              <Dashboard />
            ) : (
              <SignIn compact={anyConnected} />
            )}

            {withings.status === 'loading' ? (
              <p className="muted">Restoring Withings session…</p>
            ) : withings.status === 'connected' ? (
              <WithingsSection lookbackDays={lookbackDays} />
            ) : (
              <WithingsConnect compact={anyConnected} />
            )}
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
