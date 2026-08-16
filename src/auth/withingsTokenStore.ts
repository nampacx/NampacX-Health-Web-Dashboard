/**
 * Withings token persistence and refresh orchestration.
 *
 * Storage split: the access token (3h) always lives in `sessionStorage` —
 * there is no benefit to persisting something that short-lived. The refresh
 * token is the actual long-lived credential (~1 year) and defaults to
 * `sessionStorage` too; `localStorage` is opt-in via `persistent`, because
 * one XSS there would be a year of silent access to health data rather than
 * the lifetime of one tab.
 *
 * Rotation is the sharp edge. Withings invalidates the old refresh token the
 * instant a new one is issued, so two concurrent refreshes guarantee one of
 * them dies holding a dead token — and in this app that is not a rare
 * accident, it is close to the default: React 19 StrictMode double-invokes
 * effects in dev, and the Google and Withings sections mount independently.
 * The rules enforced below:
 *
 *   1. Persist synchronously, the instant a broker response is parsed —
 *      before React state, before any further `await`. `sessionStorage` and
 *      `localStorage` writes are synchronous, so calling `applyTokenResponse`
 *      with no `await` in between is what actually guarantees this.
 *   2. Keep `{current, previous}` so a half-landed rotation is recoverable.
 *   3. Single-flight in-tab (a module-level in-flight promise) *and*
 *      cross-tab (a Web Lock, where available) — and re-read storage after
 *      acquiring the lock, because a concurrent tab may have already
 *      rotated while this one was waiting.
 *   4. Never clear stored tokens on an ambiguous failure. Only the broker
 *      reporting the grant itself as dead (`invalid_grant`) may clear
 *      anything; a network blip or a 5xx from the broker must not look the
 *      same, or a flaky connection would permanently break the link.
 */

const ACCESS_KEY = 'ghd.withings.access'
const REFRESH_KEY = 'ghd.withings.refresh'
const REFRESH_LOCK_NAME = 'ghd.withings.refresh-lock'

/** Same safety margin as isExpired() in googleAuth.ts. */
const EXPIRY_SKEW_MS = 60_000

export interface StoredAccessToken {
  accessToken: string
  expiresAt: number
  userId: string
  scope: string
}

export interface StoredRefreshRecord {
  current: string
  previous: string | null
  rotatedAt: number
  userId: string
  persistent: boolean
}

/** Shape returned by the Azure Function broker (already camelCased). */
export interface BrokerTokenResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  scope: string
  userId: string
}

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function loadAccessToken(): StoredAccessToken | null {
  return readJson<StoredAccessToken>(sessionStorage, ACCESS_KEY)
}

export function loadRefreshRecord(): StoredRefreshRecord | null {
  // localStorage is checked first: if the user ever opted into persistence,
  // that copy is authoritative. A stray sessionStorage duplicate is cleaned
  // up by applyTokenResponse's `other.removeItem` below.
  return (
    readJson<StoredRefreshRecord>(localStorage, REFRESH_KEY) ??
    readJson<StoredRefreshRecord>(sessionStorage, REFRESH_KEY)
  )
}

export function isAccessTokenValid(
  token: StoredAccessToken | null,
): token is StoredAccessToken {
  return !!token && Date.now() < token.expiresAt - EXPIRY_SKEW_MS
}

export function hasRefreshToken(): boolean {
  return loadRefreshRecord() !== null
}

/**
 * Persists a broker response. Synchronous and side-effecting on purpose —
 * see rule 1 above. Callers MUST NOT `await` anything between receiving the
 * broker response and calling this.
 */
export function applyTokenResponse(
  response: BrokerTokenResponse,
  { persistent }: { persistent: boolean },
): StoredAccessToken {
  const previous = loadRefreshRecord()

  const access: StoredAccessToken = {
    accessToken: response.accessToken,
    expiresAt: Date.now() + response.expiresIn * 1000,
    userId: response.userId,
    scope: response.scope,
  }
  const refresh: StoredRefreshRecord = {
    current: response.refreshToken,
    previous: previous?.current ?? null,
    rotatedAt: Date.now(),
    userId: response.userId,
    persistent,
  }

  sessionStorage.setItem(ACCESS_KEY, JSON.stringify(access))
  const target = persistent ? localStorage : sessionStorage
  const other = persistent ? sessionStorage : localStorage
  target.setItem(REFRESH_KEY, JSON.stringify(refresh))
  other.removeItem(REFRESH_KEY) // avoid a stale duplicate lingering in the other storage

  return access
}

export function clearTokens(): void {
  sessionStorage.removeItem(ACCESS_KEY)
  sessionStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

export class WithingsNotConnectedError extends Error {
  constructor() {
    super('Not connected to Withings.')
    this.name = 'WithingsNotConnectedError'
  }
}

// In-tab single-flight. Calling ensureAccessToken() twice without an `await`
// in between — which is exactly what StrictMode's double effect invocation
// does — runs synchronously up to the point this is set, so the second call
// always sees it and reuses the first call's promise. See the module doc.
let inFlightRefresh: Promise<string> | null = null

async function withCrossTabLock<T>(fn: () => Promise<T>): Promise<T> {
  // Web Locks needs a secure context, which this app already requires
  // (Google's OAuth origin does too). Where it is unavailable — older
  // Safari, or a non-browser test run — this degrades to in-tab-only
  // single-flight: the worst case is the exact race the lock exists to
  // prevent, not a crash, so the fallback is safe to ship.
  if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks) {
    return navigator.locks.request(REFRESH_LOCK_NAME, fn)
  }
  return fn()
}

export interface EnsureAccessTokenOptions {
  /** Calls the broker's refresh endpoint. Rejects on any failure. */
  refresh: (refreshToken: string) => Promise<BrokerTokenResponse>
  /** True if `err` means the grant itself is dead (broker 401 invalid_grant). */
  isInvalidGrant: (err: unknown) => boolean
  /** Persistence for the *newly issued* token. An unexpired cached token
   * keeps whatever persistence it already has. */
  persistent: boolean
}

/**
 * Returns a valid access token, refreshing through the broker if needed.
 * Refreshes reactively only — on a cache miss or near-expiry — never
 * proactively, so as few rotations happen as possible.
 */
export async function ensureAccessToken(options: EnsureAccessTokenOptions): Promise<string> {
  const cached = loadAccessToken()
  if (isAccessTokenValid(cached)) return cached.accessToken

  if (inFlightRefresh) return inFlightRefresh

  const promise = withCrossTabLock(async () => {
    // Re-read: a concurrent tab (or whoever held the lock before us) may
    // have already rotated while this call was waiting for the lock.
    const fresh = loadAccessToken()
    if (isAccessTokenValid(fresh)) return fresh.accessToken

    const record = loadRefreshRecord()
    if (!record) throw new WithingsNotConnectedError()

    try {
      const response = await options.refresh(record.current)
      return applyTokenResponse(response, { persistent: options.persistent }).accessToken
    } catch (err) {
      if (options.isInvalidGrant(err)) clearTokens()
      // Any other failure (network, 502, 500) leaves storage untouched —
      // rule 4. The original error propagates either way.
      throw err
    }
  })

  inFlightRefresh = promise
  try {
    return await promise
  } finally {
    inFlightRefresh = null
  }
}
