/**
 * Withings OAuth glue: the authorize redirect, the broker HTTP calls, and
 * capturing the callback. This file is deliberately thin — the logic that is
 * actually risky to get wrong (state validation, callback interpretation)
 * lives in withingsOAuthState.ts as pure, unit-tested functions. What is
 * here just wires those functions to `location`/`sessionStorage`/`history`
 * and is not unit tested itself, matching how googleAuth.ts and
 * AuthContext.tsx are handled in this codebase.
 *
 * Unlike Google, Withings' installed/public clients cannot do the token
 * exchange themselves: `client_secret` is required for both the
 * authorization-code and refresh-token grants, and PKCE is not accepted as a
 * substitute (verified against the live token endpoint — sending
 * `code_verifier` produces the same "Missing params" response as sending
 * nothing). So exchange and refresh both go through the Azure Function
 * broker in `api/`, which holds the secret; this file never sees it.
 */

import type { BrokerTokenResponse } from './withingsTokenStore'
import {
  STATE_PREFIX,
  buildAuthorizeUrl,
  interpretCallback,
  type StoredOAuthState,
} from './withingsOAuthState'

const STATE_STORAGE_KEY = 'ghd.withings.oauth_state'
const AUTHORIZE_SCOPE = 'user.metrics'

export class WithingsBrokerError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid_grant' | 'upstream' | 'misconfigured' | 'network' | 'bad_request',
    readonly status: number,
  ) {
    super(message)
    this.name = 'WithingsBrokerError'
  }
}

export function isInvalidGrant(err: unknown): boolean {
  return err instanceof WithingsBrokerError && err.kind === 'invalid_grant'
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '')
  }
  // Only reachable in a non-browser context; crypto.randomUUID is available
  // in every browser this app already requires (HTTPS, ES2022+).
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** Must match the Withings app registration byte-for-byte, trailing slash included. */
export function resolveRedirectUri(): string {
  const override = import.meta.env.VITE_WITHINGS_REDIRECT_URI?.trim()
  if (override) return override
  return new URL(import.meta.env.BASE_URL, location.origin).href
}

/**
 * Starts the connect flow: stores CSRF state (plus the "keep me connected"
 * choice, which has to ride along since the page fully navigates away and
 * back), then redirects. There is nothing to await — the page is unloading.
 */
export function beginConnect(clientId: string, persistent: boolean): void {
  const state = STATE_PREFIX + randomId()
  const record: StoredOAuthState = { value: state, createdAt: Date.now(), persistent }
  sessionStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(record))

  const url = buildAuthorizeUrl({
    clientId,
    redirectUri: resolveRedirectUri(),
    scope: AUTHORIZE_SCOPE,
    state,
    demo: import.meta.env.VITE_WITHINGS_DEMO === '1',
  })
  location.assign(url)
}

/**
 * Warms the broker Function before navigating to Withings, so the 30-second
 * authorization code does not land on a cold start. Best-effort: a failure
 * here just means the first exchange might be slower, never a hard error.
 */
export function warmBroker(brokerUrl: string): void {
  fetch(`${brokerUrl}/withings/warmup`).catch(() => {})
}

interface BrokerErrorBody {
  error?: string
  message?: string
}

async function postBroker(
  brokerUrl: string,
  path: string,
  body: Record<string, string>,
): Promise<BrokerTokenResponse> {
  let response: Response
  try {
    response = await fetch(`${brokerUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    })
  } catch (err) {
    throw new WithingsBrokerError(
      `Could not reach the token broker. (${err instanceof Error ? err.message : String(err)})`,
      'network',
      0,
    )
  }

  let json: BrokerErrorBody | BrokerTokenResponse = {}
  try {
    json = await response.json()
  } catch {
    // A non-JSON body on a failure is handled by the status branch below.
  }

  if (!response.ok) {
    const errorBody = json as BrokerErrorBody
    const kind =
      response.status === 401
        ? 'invalid_grant'
        : response.status >= 500
          ? 'upstream'
          : 'bad_request'
    throw new WithingsBrokerError(
      errorBody.message || `Broker returned HTTP ${response.status}.`,
      kind,
      response.status,
    )
  }

  return json as BrokerTokenResponse
}

export function exchangeCode(
  brokerUrl: string,
  { code, redirectUri }: { code: string; redirectUri: string },
): Promise<BrokerTokenResponse> {
  return postBroker(brokerUrl, '/withings/token/exchange', { code, redirect_uri: redirectUri })
}

export function refreshToken(brokerUrl: string, refreshTokenValue: string): Promise<BrokerTokenResponse> {
  return postBroker(brokerUrl, '/withings/token/refresh', { refresh_token: refreshTokenValue })
}

// ---------------------------------------------------------------------------
// Module-scope callback capture.
//
// This MUST run at module scope, not inside a useEffect, and must not be
// refactored into one later: React 19 StrictMode double-invokes effects in
// development, and a Withings authorization code is single-use — a second
// exchange attempt fails and would surface a confusing error on every dev
// reload. An ES module's top-level body runs exactly once no matter how many
// times something imports it, which is what makes this safe.
// ---------------------------------------------------------------------------

function captureCallback() {
  if (typeof location === 'undefined') {
    // Import-time safety for non-browser contexts (e.g. this file being
    // transitively imported by a test). Never reachable when the app runs.
    return interpretCallback({ code: null, state: null, error: null }, null, Date.now())
  }

  const params = new URLSearchParams(location.search)
  const parsed = {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
  }

  if (!parsed.state?.startsWith(STATE_PREFIX)) {
    return interpretCallback(parsed, null, Date.now())
  }

  // Strip the callback params from the URL before anything else can run —
  // in particular, before any `await`. This is what prevents a bookmark or a
  // refresh of this exact URL from replaying a spent authorization code.
  const url = new URL(location.href)
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  url.searchParams.delete('error')
  history.replaceState({}, '', url.pathname + url.search + url.hash)

  let stored: StoredOAuthState | null = null
  try {
    const raw = sessionStorage.getItem(STATE_STORAGE_KEY)
    stored = raw ? (JSON.parse(raw) as StoredOAuthState) : null
  } catch {
    stored = null
  }
  sessionStorage.removeItem(STATE_STORAGE_KEY) // single use, regardless of outcome

  return interpretCallback(parsed, stored, Date.now())
}

export const callbackOutcome = captureCallback()

/**
 * The in-flight exchange kicked off at module load, if the URL carried a
 * valid Withings callback. `WithingsAuthContext` awaits this on mount instead
 * of starting its own exchange request.
 */
export const pendingExchange: Promise<BrokerTokenResponse> | null = (() => {
  if (callbackOutcome.kind !== 'success') return null
  const brokerUrl = import.meta.env.VITE_WITHINGS_BROKER_URL?.trim()
  if (!brokerUrl) return null

  const promise = exchangeCode(brokerUrl, {
    code: callbackOutcome.code,
    redirectUri: resolveRedirectUri(),
  })
  // Prevents an unhandled-rejection warning if nothing reads this promise
  // before it settles; WithingsAuthContext is the real consumer and awaits
  // it directly, surfacing the actual error there.
  promise.catch(() => {})
  return promise
})()
