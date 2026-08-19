import { useState } from 'react'
import { useGoogleAuth } from '../auth/google/GoogleAuthContext'
import { useBloodworkData } from '../state/bloodworkData'

/**
 * Shown instead of BloodworkSection whenever the tab can't do anything yet:
 * either the API URL isn't configured, or the user isn't signed in with
 * Google (bloodwork rides on that token -- there is no separate sign-in).
 */
export default function BloodworkConnect() {
  const { status, signIn, error: googleError, clientId } = useGoogleAuth()
  const { configured } = useBloodworkData()
  const [busy, setBusy] = useState(false)
  const signedIn = status === 'signed-in'

  async function handleSignIn() {
    setBusy(true)
    try {
      await signIn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card signin">
      <h2>Bloodwork tracking</h2>
      <p className="muted">
        Upload a lab report — PDF, JPEG, or PNG — and it&apos;s parsed into structured results
        with Azure Document Intelligence. Uses your Google sign-in; there&apos;s no separate
        account to connect.
      </p>

      {!configured && (
        <p className="banner banner-warn">
          <strong>Setup needed.</strong> Copy <code>.env.example</code> to <code>.env.local</code>{' '}
          and set <code>VITE_BLOODWORK_API_URL</code>, then restart the dev server.
        </p>
      )}

      {!signedIn && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSignIn}
          disabled={busy || !clientId}
        >
          {busy ? 'Opening Google…' : 'Sign in with Google'}
        </button>
      )}

      {googleError && <p className="banner banner-error">{googleError}</p>}
    </section>
  )
}
