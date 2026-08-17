import { useState } from 'react'
import { useGoogleAuth } from '../auth/google/GoogleAuthContext'

export default function SignIn() {
  const { signIn, error, clientId } = useGoogleAuth()
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    setBusy(true)
    try {
      await signIn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card signin">
      <h2>Sign in to continue</h2>
      <p className="muted">
        This dashboard reads your Google Health data directly in the browser using a read-only
        OAuth token. Nothing is stored on a server.
      </p>

      {!clientId && (
        <p className="banner banner-warn">
          <strong>Setup needed.</strong> Copy <code>.env.example</code> to <code>.env.local</code>{' '}
          and set <code>VITE_GOOGLE_CLIENT_ID</code> to your OAuth client ID, then restart the dev
          server.
        </p>
      )}

      <button type="button" className="btn btn-primary" onClick={handleClick} disabled={busy || !clientId}>
        {busy ? 'Opening Google…' : 'Sign in with Google'}
      </button>

      {error && <p className="banner banner-error">{error}</p>}
    </section>
  )
}
