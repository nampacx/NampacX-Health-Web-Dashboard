import { useMemo } from 'react'
import { toCombinedEntries } from '../api/combined'
import { API_BASE } from '../api/google/healthApi'
import { MEASURE_ENDPOINT } from '../api/withings/measureApi'
import { useGoogleAuth } from '../auth/google/GoogleAuthContext'
import { useWithingsAuth } from '../auth/withings/WithingsAuthContext'
import { useGoogleData } from '../state/googleData'
import { useTimeRange } from '../state/timeRange'
import { useWithingsData } from '../state/withingsData'

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="tech-row">
      <span className="tech-key">{label}</span>
      <span className="tech-value">{value}</span>
    </div>
  )
}

export default function TechnicalDetails() {
  const google = useGoogleAuth()
  const withings = useWithingsAuth()
  const { records, outcomes, loadedAt: googleLoadedAt } = useGoogleData()
  const { groups, loadedAt: withingsLoadedAt } = useWithingsData()
  const { lookbackDays } = useTimeRange()

  const combined = useMemo(() => toCombinedEntries(records, groups), [records, groups])
  const failed = outcomes.filter((outcome) => outcome.status === 'error')

  return (
    <div className="tech">
      <section className="card tech-card">
        <h2>Connections</h2>

        <h3>Google Health</h3>
        <Row label="Status" value={google.status} />
        {google.profile?.email && <Row label="Account" value={google.profile.email} />}
        <Row label="Client ID" value={google.clientId ?? 'not configured'} />
        {google.token && (
          <>
            <Row
              label="Token expires"
              value={`${dateTimeFormat.format(new Date(google.token.expiresAt))} (no refresh token by design)`}
            />
            <details className="raw">
              <summary>{google.token.grantedScopes.length} scopes granted</summary>
              <ul className="tech-list">
                {google.token.grantedScopes.map((scope) => (
                  <li key={scope}>{scope}</li>
                ))}
              </ul>
            </details>
          </>
        )}
        {googleLoadedAt && <Row label="Last loaded" value={dateTimeFormat.format(googleLoadedAt)} />}

        <h3>Withings</h3>
        <Row label="Status" value={withings.status} />
        {withings.userId && <Row label="User ID" value={withings.userId} />}
        <Row label="Client ID" value={withings.clientId ?? 'not configured'} />
        <Row label="Broker" value={withings.brokerUrl ?? 'not configured'} />
        {withingsLoadedAt && (
          <Row label="Last loaded" value={dateTimeFormat.format(withingsLoadedAt)} />
        )}
      </section>

      <section className="card tech-card">
        <h2>Configuration</h2>
        <Row label="Google Health API" value={API_BASE} />
        <Row label="Withings measure API" value={MEASURE_ENDPOINT} />
        <Row label="Lookback window" value={`${lookbackDays} days`} />
        <p className="muted field-hint">
          The browser calls both APIs directly — the broker is only involved in the Withings token
          exchange and refresh, never in fetching measurements.
        </p>
      </section>

      <section className="card tech-card">
        <h2>Fetch outcomes</h2>
        {outcomes.length === 0 ? (
          <p className="muted">No Google data types have been fetched yet.</p>
        ) : (
          <>
            <p className="muted field-hint">
              {outcomes.length - failed.length} of {outcomes.length} data types loaded.
              {failed.length > 0 && ' A failure here affects one data type, not the whole load.'}
            </p>
            <div className="tech-outcomes">
              {outcomes.map((outcome) => (
                <div key={outcome.dataType.id} className="tech-row">
                  <span className="tech-key">{outcome.dataType.label}</span>
                  <span className="tech-value">
                    <span className={outcome.status === 'ok' ? 'pill' : 'pill pill-error'}>
                      {outcome.status}
                    </span>{' '}
                    {outcome.status === 'ok'
                      ? `${outcome.count} ${outcome.count === 1 ? 'record' : 'records'}`
                      : outcome.error}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="tech-combined">
        <div className="list-header">
          <h2>Combined data</h2>
          <span className="muted">
            {combined.length} {combined.length === 1 ? 'observation' : 'observations'} from both
            providers, newest first
          </span>
        </div>

        {combined.length === 0 ? (
          <section className="card empty">
            <h2>Nothing loaded</h2>
            <p className="muted">
              Connect a provider, or widen the time range, and the raw payloads will show up here.
            </p>
          </section>
        ) : (
          <ul className="records">
            {combined.map((entry) => (
              <li key={entry.key} className="record">
                <div className="record-main">
                  <div className="record-head">
                    <span className="badge">{entry.label}</span>
                    <span className="record-category">{entry.provider}</span>
                  </div>
                  <p className="record-summary">{entry.summary}</p>
                  <details className="raw">
                    <summary>Raw JSON</summary>
                    <pre>{JSON.stringify(entry.raw, null, 2)}</pre>
                  </details>
                </div>
                <div className="record-meta">
                  {entry.at ? (
                    <time dateTime={entry.at.toISOString()}>{dateTimeFormat.format(entry.at)}</time>
                  ) : (
                    <span className="muted">No timestamp</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
