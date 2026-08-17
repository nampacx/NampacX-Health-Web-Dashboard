/**
 * Pure OAuth-callback decision logic, deliberately split out of
 * withingsAuth.ts so it can be unit tested without a browser: no
 * `sessionStorage`/`location`/`history` access anywhere in this file.
 */

/** Distinguishes a Withings callback from anything else that might one day
 * land on this page with a `?state=` param. */
export const STATE_PREFIX = 'wth_'

export const STATE_MAX_AGE_MS = 10 * 60 * 1000

export interface StoredOAuthState {
  value: string
  createdAt: number
  /**
   * The "keep me connected on this browser" choice made before the redirect.
   * Carried through the state record because the page fully navigates away
   * and back during the OAuth flow — there is nowhere else to remember it.
   */
  persistent: boolean
}

export function isWithingsState(state: string | null): state is string {
  return !!state && state.startsWith(STATE_PREFIX)
}

/** True if `stored` matches `returned` and has not expired as of `now`. */
export function isValidState(
  stored: StoredOAuthState | null,
  returned: string,
  now: number,
): boolean {
  if (!stored) return false
  if (stored.value !== returned) return false
  return now - stored.createdAt < STATE_MAX_AGE_MS
}

export interface AuthorizeUrlOptions {
  clientId: string
  redirectUri: string
  scope: string
  state: string
  demo?: boolean
}

export function buildAuthorizeUrl(opts: AuthorizeUrlOptions): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    scope: opts.scope,
    redirect_uri: opts.redirectUri,
    state: opts.state,
  })
  if (opts.demo) params.set('mode', 'demo')
  return `https://account.withings.com/oauth2_user/authorize2?${params}`
}

export interface CallbackParams {
  code: string | null
  state: string | null
  error: string | null
}

export type CallbackOutcome =
  | { kind: 'not-withings' }
  | { kind: 'denied'; error: string }
  | { kind: 'invalid-state' }
  | { kind: 'success'; code: string; persistent: boolean }

/**
 * Given the parsed query params and the previously stored state record,
 * decides what a Withings redirect back to this page means. No side effects:
 * withingsAuth.ts owns reading the URL, clearing it, and touching storage.
 */
export function interpretCallback(
  params: CallbackParams,
  stored: StoredOAuthState | null,
  now: number,
): CallbackOutcome {
  if (!isWithingsState(params.state)) return { kind: 'not-withings' }
  if (params.error) return { kind: 'denied', error: params.error }
  if (!stored || !isValidState(stored, params.state, now)) return { kind: 'invalid-state' }
  if (!params.code) return { kind: 'invalid-state' }
  return { kind: 'success', code: params.code, persistent: stored.persistent }
}
