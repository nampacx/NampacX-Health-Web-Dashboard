import { useState } from 'react'
import { useWithingsAuth } from '../auth/withings/WithingsAuthContext'

export default function WithingsConnect() {
  const { connect, error, clientId, brokerUrl } = useWithingsAuth()
  const [persistent, setPersistent] = useState(false)
  const [busy, setBusy] = useState(false)
  const configured = Boolean(clientId && brokerUrl)

  function handleConnect() {
    setBusy(true) // the page is about to navigate away; nothing resets this
    connect(persistent)
  }

  return (
    <section className="card signin">
      <h2>Connect Withings</h2>
      <p className="muted">
        Reads weight and body-composition data from your Withings scale. The OAuth exchange runs
        through a small stateless broker that holds no data of its own — see{' '}
        <a href="https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/public-health-data-api-overview" target="_blank" rel="noreferrer">
          the Withings API docs
        </a>
        .
      </p>

      {!configured && (
        <p className="banner banner-warn">
          <strong>Setup needed.</strong> Copy <code>.env.example</code> to <code>.env.local</code>{' '}
          and set <code>VITE_WITHINGS_CLIENT_ID</code> and <code>VITE_WITHINGS_BROKER_URL</code>,
          then restart the dev server.
        </p>
      )}

      <label className="field field-inline">
        <input
          type="checkbox"
          checked={persistent}
          onChange={(event) => setPersistent(event.target.checked)}
        />
        <span>Keep me connected on this browser</span>
      </label>
      <p className="muted field-hint">
        Off by default: the connection lasts this browser session. Withings issues a year-long
        credential, so turning this on keeps it in longer-lived storage — only do that on a device
        you trust.
      </p>

      <button type="button" className="btn btn-primary" onClick={handleConnect} disabled={busy || !configured}>
        {busy ? 'Opening Withings…' : 'Connect Withings'}
      </button>

      {error && <p className="banner banner-error">{error}</p>}
    </section>
  )
}
