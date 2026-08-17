import type { UserProfile } from '../../api/google/types'

const STORAGE_KEY = 'ghd.token'

export interface StoredToken {
  accessToken: string
  /** Epoch milliseconds. */
  expiresAt: number
  grantedScopes: string[]
}

/**
 * The GIS client script is loaded async from index.html, so it may not be on
 * `window` yet when React mounts. Poll briefly rather than racing it.
 */
export function waitForGoogleIdentityServices(timeoutMs = 10_000): Promise<void> {
  if (typeof google !== 'undefined' && google.accounts?.oauth2) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      if (typeof google !== 'undefined' && google.accounts?.oauth2) {
        window.clearInterval(timer)
        resolve()
      } else if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer)
        reject(
          new Error(
            'Google Identity Services failed to load. Check your network connection or ad blocker.',
          ),
        )
      }
    }, 50)
  })
}

/**
 * Runs the OAuth 2.0 implicit ("token") flow in a popup. This is the flow meant
 * for browser-only apps: no client secret is involved and nothing but a
 * short-lived access token ever reaches the page.
 */
export function requestAccessToken(clientId: string, scopes: string[]): Promise<StoredToken> {
  return new Promise((resolve, reject) => {
    let settled = false

    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: scopes.join(' '),
      callback: (response) => {
        if (settled) return
        settled = true
        if (response.error) {
          reject(new Error(response.error_description || response.error))
          return
        }
        resolve({
          accessToken: response.access_token,
          expiresAt: Date.now() + response.expires_in * 1000,
          grantedScopes: (response.scope || '').split(' ').filter(Boolean),
        })
      },
      error_callback: (error) => {
        if (settled) return
        settled = true
        reject(
          new Error(
            error.type === 'popup_closed'
              ? 'Sign-in was cancelled.'
              : error.message || 'Google sign-in failed.',
          ),
        )
      },
    })

    client.requestAccessToken()
  })
}

/** Treat a token as expired a minute early so in-flight requests do not 401. */
export function isExpired(token: StoredToken): boolean {
  return Date.now() >= token.expiresAt - 60_000
}

export function loadToken(): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const token = JSON.parse(raw) as StoredToken
    if (!token.accessToken || isExpired(token)) {
      sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    return token
  } catch {
    return null
  }
}

export function saveToken(token: StoredToken): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(token))
}

export function clearToken(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}

export function revokeToken(accessToken: string): void {
  try {
    google.accounts.oauth2.revoke(accessToken)
  } catch {
    // Revocation is best-effort; the local session is cleared either way.
  }
}

export async function fetchUserProfile(accessToken: string): Promise<UserProfile | null> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return null
    return (await response.json()) as UserProfile
  } catch {
    return null
  }
}
