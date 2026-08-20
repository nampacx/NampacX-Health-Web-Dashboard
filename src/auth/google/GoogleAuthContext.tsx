import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { REQUESTED_SCOPES } from '../../api/google/dataTypes'
import type { UserProfile } from '../../api/google/types'
import {
  clearIdentityToken,
  clearToken,
  fetchUserProfile,
  InteractionRequiredError,
  isExpired,
  loadIdentityToken,
  loadToken,
  requestAccessToken,
  requestIdentityToken,
  revokeToken,
  saveIdentityToken,
  saveToken,
  waitForGoogleIdentityServices,
  type StoredToken,
} from './googleAuth'

interface GoogleAuthState {
  token: StoredToken | null
  profile: UserProfile | null
  status: 'loading' | 'signed-out' | 'signed-in'
  error: string | null
  clientId: string | null
  signIn: () => Promise<void>
  signOut: () => void
  /** Returns a valid access token, or null when the session has lapsed. */
  getAccessToken: () => string | null
  /**
   * A token carrying `IDENTITY_SCOPES` and nothing else, for the bloodwork API.
   * Minted from the existing grant and cached for the tab.
   *
   * **Minting only ever happens with `interactive: true`.** GIS runs the mint in
   * a popup even when no consent is needed, and a popup outside a user gesture
   * is blocked — silently in Chrome, but with a visible notification bar in
   * Firefox. Attempting it from a mount effect would mean every page load of a
   * bloodwork-configured deployment nagged the user about a window they never
   * asked for, whether or not they ever opened the tab. So background callers
   * read the cache and give up; a click is what pays for the popup.
   *
   * Never falls back to the sign-in token: that would hand a full Google Health
   * grant to a backend that needs a subject id, which is the thing this exists
   * to prevent. It throws instead, and the caller decides what to do about it.
   */
  getIdentityToken: (options?: { interactive?: boolean }) => Promise<string>
}

const GoogleAuthContext = createContext<GoogleAuthState | null>(null)

export function GoogleAuthProvider({ children }: { children: ReactNode }) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || null
  const [token, setToken] = useState<StoredToken | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [status, setStatus] = useState<GoogleAuthState['status']>('loading')
  const [error, setError] = useState<string | null>(null)

  // A ref rather than state: nothing renders from this, and re-rendering the
  // whole app when a background token mint lands would be noise.
  const identityToken = useRef<StoredToken | null>(null)
  // Concurrent callers share one mint. Two popups for one token would be a
  // second popup the browser blocks, and GIS has no request coalescing of its
  // own -- the same single-flight reasoning the Withings token store documents.
  const identityMint = useRef<Promise<string> | null>(null)

  // Restore a token that is still valid for this browser tab.
  useEffect(() => {
    const stored = loadToken()
    if (!stored) {
      setStatus('signed-out')
      return
    }
    identityToken.current = loadIdentityToken()
    setToken(stored)
    setStatus('signed-in')
    void fetchUserProfile(stored.accessToken).then(setProfile)
  }, [])

  // Drop the session the moment the token lapses, so the UI does not sit on a
  // dead token and surface a wall of 401s instead.
  useEffect(() => {
    if (!token) return
    const msUntilExpiry = Math.max(0, token.expiresAt - 60_000 - Date.now())
    const timer = window.setTimeout(() => {
      clearToken()
      clearIdentityToken()
      identityToken.current = null
      identityMint.current = null
      setToken(null)
      setProfile(null)
      setStatus('signed-out')
      setError('Your Google session expired. Please sign in again.')
    }, msUntilExpiry)
    return () => window.clearTimeout(timer)
  }, [token])

  const signIn = useCallback(async () => {
    setError(null)
    if (!clientId) {
      setError('VITE_GOOGLE_CLIENT_ID is not set. Copy .env.example to .env.local and fill it in.')
      return
    }
    try {
      await waitForGoogleIdentityServices()
      const next = await requestAccessToken(clientId, REQUESTED_SCOPES)
      saveToken(next)
      setToken(next)
      setStatus('signed-in')
      setProfile(await fetchUserProfile(next.accessToken))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [clientId])

  const signOut = useCallback(() => {
    // Revoking either token revokes the grant behind both, so one call is
    // enough -- but both copies are cleared locally regardless of whether
    // Google was reachable.
    if (token) revokeToken(token.accessToken)
    clearToken()
    clearIdentityToken()
    identityToken.current = null
    identityMint.current = null
    setToken(null)
    setProfile(null)
    setStatus('signed-out')
    setError(null)
  }, [token])

  const getAccessToken = useCallback(() => {
    if (!token || isExpired(token)) return null
    return token.accessToken
  }, [token])

  const getIdentityToken = useCallback(async (options?: { interactive?: boolean }) => {
    const cached = identityToken.current
    if (cached && !isExpired(cached)) return cached.accessToken
    if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID is not set.')
    if (options?.interactive !== true) {
      // Not an error state, and not a lapsed session -- just "this needs a
      // click first". Its own error type so the caller can tell it apart from a
      // mint that actually went wrong, and show a button rather than a message.
      throw new InteractionRequiredError()
    }

    identityMint.current ??= (async () => {
      try {
        await waitForGoogleIdentityServices()
        const next = await requestIdentityToken(clientId)
        identityToken.current = next
        saveIdentityToken(next)
        return next.accessToken
      } finally {
        // Cleared whether it resolved or rejected: a failed mint must not
        // become a permanently cached failure that a later click cannot retry.
        identityMint.current = null
      }
    })()

    return identityMint.current
  }, [clientId])

  const value = useMemo<GoogleAuthState>(
    () => ({
      token,
      profile,
      status,
      error,
      clientId,
      signIn,
      signOut,
      getAccessToken,
      getIdentityToken,
    }),
    [token, profile, status, error, clientId, signIn, signOut, getAccessToken, getIdentityToken],
  )

  return <GoogleAuthContext.Provider value={value}>{children}</GoogleAuthContext.Provider>
}

export function useGoogleAuth(): GoogleAuthState {
  const ctx = useContext(GoogleAuthContext)
  if (!ctx) throw new Error('useGoogleAuth must be used inside <GoogleAuthProvider>')
  return ctx
}
