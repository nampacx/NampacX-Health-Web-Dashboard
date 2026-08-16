import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  beginConnect,
  callbackOutcome,
  isInvalidGrant,
  pendingExchange,
  refreshToken,
  resolveRedirectUri,
  warmBroker,
  WithingsBrokerError,
} from './withingsAuth'
import {
  applyTokenResponse,
  clearTokens,
  ensureAccessToken,
  hasRefreshToken,
  loadRefreshRecord,
} from './withingsTokenStore'

/**
 * Deliberately independent of AuthContext.tsx, sharing no abstraction with
 * it — Withings and Google are different enough (auth-code-plus-broker vs.
 * browser-only implicit flow) that a shared "provider" interface would be
 * more indirection than the two callers actually need.
 */
interface WithingsAuthState {
  status: 'loading' | 'disconnected' | 'connected'
  userId: string | null
  error: string | null
  clientId: string | null
  brokerUrl: string | null
  /** Starts the redirect to Withings. No-op if not configured. */
  connect: (persistent: boolean) => void
  disconnect: () => void
  /** Resolves to a valid access token, refreshing via the broker if needed. */
  getAccessToken: () => Promise<string>
}

const WithingsAuthContext = createContext<WithingsAuthState | null>(null)

export function WithingsProvider({ children }: { children: ReactNode }) {
  const clientId = import.meta.env.VITE_WITHINGS_CLIENT_ID?.trim() || null
  const brokerUrl = import.meta.env.VITE_WITHINGS_BROKER_URL?.trim().replace(/\/$/, '') || null

  const [status, setStatus] = useState<WithingsAuthState['status']>('loading')
  const [userId, setUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // On mount: finish an in-flight callback exchange (kicked off at module
  // scope in withingsAuth.ts, before React ever ran), or fall back to
  // restoring whatever was already stored from an earlier session.
  useEffect(() => {
    let cancelled = false

    async function restoreOrExchange() {
      if (callbackOutcome.kind === 'denied') {
        if (!cancelled) {
          setError('Withings sign-in was cancelled.')
          setStatus(hasRefreshToken() ? 'connected' : 'disconnected')
        }
        return
      }
      if (callbackOutcome.kind === 'invalid-state') {
        if (!cancelled) {
          setError('Could not verify the Withings sign-in — please try connecting again.')
          setStatus(hasRefreshToken() ? 'connected' : 'disconnected')
        }
        return
      }

      if (callbackOutcome.kind === 'success' && pendingExchange) {
        try {
          const response = await pendingExchange
          // No `await` between here and applyTokenResponse: it must persist
          // synchronously the instant the broker response is in hand.
          const access = applyTokenResponse(response, { persistent: callbackOutcome.persistent })
          if (cancelled) return
          setUserId(access.userId)
          setStatus('connected')
          return
        } catch (err) {
          if (cancelled) return
          setError(err instanceof Error ? err.message : String(err))
          setStatus(hasRefreshToken() ? 'connected' : 'disconnected')
          return
        }
      }

      // No callback in flight: restore an existing connection, if any.
      const record = loadRefreshRecord()
      if (!record) {
        setStatus('disconnected')
        return
      }
      setUserId(record.userId)
      setStatus('connected')
    }

    void restoreOrExchange()
    return () => {
      cancelled = true
    }
  }, [])

  const connect = useCallback(
    (persistent: boolean) => {
      setError(null)
      if (!clientId || !brokerUrl) {
        setError(
          'VITE_WITHINGS_CLIENT_ID or VITE_WITHINGS_BROKER_URL is not set. Copy .env.example to .env.local and fill it in.',
        )
        return
      }
      warmBroker(brokerUrl) // fire-and-forget, beats the 30s code window
      beginConnect(clientId, persistent)
    },
    [clientId, brokerUrl],
  )

  const disconnect = useCallback(() => {
    clearTokens()
    setUserId(null)
    setStatus('disconnected')
    setError(null)
  }, [])

  const getAccessToken = useCallback(async (): Promise<string> => {
    if (!brokerUrl) throw new Error('VITE_WITHINGS_BROKER_URL is not set.')
    const record = loadRefreshRecord()
    try {
      return await ensureAccessToken({
        refresh: (refreshTokenValue) => refreshToken(brokerUrl, refreshTokenValue),
        isInvalidGrant,
        persistent: record?.persistent ?? false,
      })
    } catch (err) {
      if (err instanceof WithingsBrokerError && err.kind === 'invalid_grant') {
        setUserId(null)
        setStatus('disconnected')
        setError('Your Withings connection expired. Please reconnect.')
      }
      throw err
    }
  }, [brokerUrl])

  const value = useMemo<WithingsAuthState>(
    () => ({ status, userId, error, clientId, brokerUrl, connect, disconnect, getAccessToken }),
    [status, userId, error, clientId, brokerUrl, connect, disconnect, getAccessToken],
  )

  return <WithingsAuthContext.Provider value={value}>{children}</WithingsAuthContext.Provider>
}

export function useWithings(): WithingsAuthState {
  const ctx = useContext(WithingsAuthContext)
  if (!ctx) throw new Error('useWithings must be used inside <WithingsProvider>')
  return ctx
}

// Re-exported so components building the connect card do not need to import
// two modules for one concern (checking whether the redirect URI looks sane).
export { resolveRedirectUri }
