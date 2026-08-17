/**
 * Client for Withings' OAuth2 token endpoint (`v2/oauth2`, `action=requesttoken`).
 *
 * Withings does not publish a stable error-code taxonomy here. Every
 * "Invalid Params" class failure — a bad `client_secret`, a bad or expired
 * authorization code, an invalid or revoked refresh token — comes back as
 * the *same* `{"status":503,"error":"..."}` shape, over HTTP 200.
 *
 * Verified live, probing the real endpoint with a deliberately wrong
 * `client_secret`:
 *   {"status":503,"error":"Invalid Params: invalid client id/secret"}
 * which matches what a public home-assistant/core issue independently
 * reported hitting for the same failure (a rejected credential). That
 * specific wording — "invalid client id/secret" — appears to be reserved for
 * a credentials problem, so `classifyTokenError` below uses it to separate
 * "the broker's own config is wrong" from "the caller's grant is dead".
 * Anything else under a `refresh_token` grant is treated as a dead grant:
 * once credentials are ruled out, there is nothing else a well-formed
 * refresh request can be rejected for.
 *
 * This is a heuristic Withings does not document or guarantee, not a
 * verified contract. If their wording ever changes, the practical failure
 * mode is an unnecessary "please reconnect" prompt for users — annoying, but
 * not destructive. See classifyTokenError for why that asymmetry is
 * deliberate: the alternative (never invalid_grant) would leave a genuinely
 * dead connection silently unrefreshable forever.
 */

const TOKEN_ENDPOINT = 'https://wbsapi.withings.net/v2/oauth2'

export interface WithingsTokenBody {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
  userid: number | string
}

export type WithingsErrorKind = 'invalid_grant' | 'misconfigured' | 'upstream' | 'network'

export class WithingsTokenError extends Error {
  constructor(
    message: string,
    readonly kind: WithingsErrorKind,
    readonly withingsStatus?: number,
  ) {
    super(message)
    this.name = 'WithingsTokenError'
  }
}

/** Exported for testing; see the module doc for the evidence behind this. */
export function classifyTokenError(errorText: string | undefined): 'invalid_grant' | 'misconfigured' {
  const text = (errorText ?? '').toLowerCase()
  if (text.includes('client id') || text.includes('client_id') || text.includes('secret')) {
    return 'misconfigured'
  }
  return 'invalid_grant'
}

async function requestToken(params: Record<string, string>): Promise<WithingsTokenBody> {
  let response: Response
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    })
  } catch (err) {
    throw new WithingsTokenError(
      `Network error contacting Withings: ${err instanceof Error ? err.message : String(err)}`,
      'network',
    )
  }

  if (!response.ok) {
    throw new WithingsTokenError(
      `Withings returned HTTP ${response.status}.`,
      'upstream',
      response.status,
    )
  }

  let json: { status: number; body?: WithingsTokenBody; error?: string }
  try {
    json = (await response.json()) as typeof json
  } catch (err) {
    throw new WithingsTokenError(
      `Withings returned a non-JSON response: ${err instanceof Error ? err.message : String(err)}`,
      'upstream',
    )
  }

  if (json.status !== 0) {
    throw new WithingsTokenError(
      json.error ?? `Withings token status ${json.status}`,
      classifyTokenError(json.error),
      json.status,
    )
  }
  if (!json.body) {
    throw new WithingsTokenError('Withings reported success but sent no token body.', 'upstream')
  }
  return json.body
}

export function exchangeAuthorizationCode(opts: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}): Promise<WithingsTokenBody> {
  return requestToken({
    action: 'requesttoken',
    grant_type: 'authorization_code',
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.redirectUri,
  })
}

export function refreshAccessToken(opts: {
  clientId: string
  clientSecret: string
  refreshToken: string
}): Promise<WithingsTokenBody> {
  return requestToken({
    action: 'requesttoken',
    grant_type: 'refresh_token',
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
  })
}
