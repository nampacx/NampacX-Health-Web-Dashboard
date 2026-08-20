import type { UserProfile } from '../../api/google/types'

const STORAGE_KEY = 'ghd.token'
const IDENTITY_STORAGE_KEY = 'ghd.identity-token'

export interface StoredToken {
  accessToken: string
  /** Epoch milliseconds. */
  expiresAt: number
  grantedScopes: string[]
}

/**
 * The only scopes the token sent to the bloodwork API is allowed to carry.
 *
 * That API needs to know *who* is calling. It used to be handed the same token
 * the app uses against `health.googleapis.com`, which knows who is calling and
 * can also read everything they have ever recorded — every
 * `googlehealth.*.readonly` scope in `REQUESTED_SCOPES`: activity, sleep,
 * nutrition, heart, ECG, location, profile. Identity was what it needed;
 * authority was what it got. Anyone able to read that token — a compromise of
 * the Function App, an over-broad log sink, a malicious transitive dependency —
 * could read the user's whole Google Health history straight from Google, from
 * anywhere, for the rest of the token's life.
 *
 * So bloodwork gets its own token, minted from the same grant and scoped to this
 * one line. A compromise of that backend now yields an email address.
 *
 * `userinfo.email` alone, and not `.profile` as well: `tokeninfo` returns the
 * subject id for any user token whatever its scopes, and the address is only
 * there so whoever approves a `bloodworkUsers` row can tell whose account a
 * 21-digit subject id belongs to. Nothing else is needed, so nothing else is
 * asked for. It is already in `REQUESTED_SCOPES`, so it was consented to at
 * sign-in and this mints without a second consent screen.
 */
export const IDENTITY_SCOPES = ['https://www.googleapis.com/auth/userinfo.email']

/**
 * What a narrow token may come back carrying. Google decides what it grants, not
 * this app: it echoes the OIDC short names alongside the URL form, and
 * incremental authorization means a change in its behaviour could widen a grant
 * without anything here asking for it. So the returned scope list is checked
 * rather than assumed, and a token broader than this is discarded rather than
 * sent — the guarantee above is worth nothing if it holds only for as long as
 * Google keeps behaving the way it does today.
 */
const IDENTITY_SCOPE_ALLOWLIST = new Set([
  ...IDENTITY_SCOPES,
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/userinfo.profile',
])

export function isNarrowlyScoped(token: StoredToken): boolean {
  return token.grantedScopes.every((scope) => IDENTITY_SCOPE_ALLOWLIST.has(scope))
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
 *
 * `prompt` is passed through for the narrow-token mint below: `''` means Google
 * shows a consent screen only where consent has not already been given, which
 * for a scope granted at sign-in means no screen at all.
 */
export function requestAccessToken(
  clientId: string,
  scopes: string[],
  prompt?: '' | 'none' | 'consent' | 'select_account',
): Promise<StoredToken> {
  return new Promise((resolve, reject) => {
    let settled = false

    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: scopes.join(' '),
      ...(prompt === undefined ? {} : { prompt }),
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

/**
 * Mints the identity-only token the bloodwork API is sent — see
 * `IDENTITY_SCOPES` for why that is not the sign-in token.
 *
 * `prompt: ''` because the scope is already consented to, so this normally
 * completes with nothing on screen. "Normally" is doing real work there: Google
 * still opens a popup to run it, and browsers block popups outside a user
 * gesture, so this can fail for reasons that have nothing to do with the user's
 * grant. Callers must treat a rejection as "ask again from a click", never as a
 * lapsed session — the sign-in token is untouched either way.
 */
export async function requestIdentityToken(clientId: string): Promise<StoredToken> {
  const token = await requestAccessToken(clientId, IDENTITY_SCOPES, '')
  if (!isNarrowlyScoped(token)) {
    // Refusing it is the point. A token that came back carrying health scopes is
    // precisely what this mechanism exists to keep away from the bloodwork
    // backend, and sending it anyway would restore the problem while looking
    // like the fix.
    throw new Error(
      'Google returned a broader grant than was requested; refusing to send it to the bloodwork API.',
    )
  }
  return token
}

/** Treat a token as expired a minute early so in-flight requests do not 401. */
export function isExpired(token: StoredToken): boolean {
  return Date.now() >= token.expiresAt - 60_000
}

function loadFrom(key: string): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const token = JSON.parse(raw) as StoredToken
    if (!token.accessToken || isExpired(token)) {
      sessionStorage.removeItem(key)
      return null
    }
    return token
  } catch {
    return null
  }
}

export function loadToken(): StoredToken | null {
  return loadFrom(STORAGE_KEY)
}

export function saveToken(token: StoredToken): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(token))
}

export function clearToken(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}

/**
 * Kept under its own key rather than alongside the sign-in token, so a later
 * refactor cannot reach for "the token" and pick the wrong one. The narrow
 * token's entire value is that exactly one caller is ever handed it.
 */
export function loadIdentityToken(): StoredToken | null {
  const token = loadFrom(IDENTITY_STORAGE_KEY)
  if (token && !isNarrowlyScoped(token)) {
    // Written by an older build, or tampered with. Either way it is not what
    // this key is for, so it is dropped rather than used.
    sessionStorage.removeItem(IDENTITY_STORAGE_KEY)
    return null
  }
  return token
}

export function saveIdentityToken(token: StoredToken): void {
  sessionStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(token))
}

export function clearIdentityToken(): void {
  sessionStorage.removeItem(IDENTITY_STORAGE_KEY)
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
