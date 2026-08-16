import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { REQUESTED_SCOPES } from '../api/dataTypes'
import type { UserProfile } from '../types'
import {
  clearToken,
  fetchUserProfile,
  isExpired,
  loadToken,
  requestAccessToken,
  revokeToken,
  saveToken,
  waitForGoogleIdentityServices,
  type StoredToken,
} from './googleAuth'

interface AuthState {
  token: StoredToken | null
  profile: UserProfile | null
  status: 'loading' | 'signed-out' | 'signed-in'
  error: string | null
  clientId: string | null
  signIn: () => Promise<void>
  signOut: () => void
  /** Returns a valid access token, or null when the session has lapsed. */
  getAccessToken: () => string | null
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || null
  const [token, setToken] = useState<StoredToken | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [status, setStatus] = useState<AuthState['status']>('loading')
  const [error, setError] = useState<string | null>(null)

  // Restore a token that is still valid for this browser tab.
  useEffect(() => {
    const stored = loadToken()
    if (!stored) {
      setStatus('signed-out')
      return
    }
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
    if (token) revokeToken(token.accessToken)
    clearToken()
    setToken(null)
    setProfile(null)
    setStatus('signed-out')
    setError(null)
  }, [token])

  const getAccessToken = useCallback(() => {
    if (!token || isExpired(token)) return null
    return token.accessToken
  }, [token])

  const value = useMemo<AuthState>(
    () => ({ token, profile, status, error, clientId, signIn, signOut, getAccessToken }),
    [token, profile, status, error, clientId, signIn, signOut, getAccessToken],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
