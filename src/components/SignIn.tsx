import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'

interface Props {
  /** True once at least one provider is already connected — swaps the full
   * explanatory card for a one-line "also connect" row. */
  compact?: boolean
}

export default function SignIn({ compact = false }: Props) {
  const { signIn, error, clientId } = useAuth()
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    setBusy(true)
    try {
      await signIn()
    } finally {
      setBusy(false)
    }
  }

  if (compact) {
    return (
      <section className="card signin signin-compact">
        <p className="muted">Also want your Google Health activity and sleep here?</p>
        <button type="button" className="btn" onClick={handleClick} disabled={busy || !clientId}>
          {busy ? 'Opening Google…' : 'Sign in with Google'}
        </button>
        {error && <p className="banner banner-error">{error}</p>}
      </section>
    )
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
