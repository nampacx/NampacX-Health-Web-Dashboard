import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WithingsTokenError, classifyTokenError, exchangeAuthorizationCode, refreshAccessToken } from './withings.js'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

describe('classifyTokenError', () => {
  it('classifies the observed bad-credentials wording as misconfigured', () => {
    // Verified live: this exact string is what Withings returns for a wrong
    // client_secret, corroborated by a public home-assistant/core issue.
    expect(classifyTokenError('Invalid Params: invalid client id/secret')).toBe('misconfigured')
  })

  it('is case-insensitive and matches partial mentions of client id or secret', () => {
    expect(classifyTokenError('bad CLIENT_ID')).toBe('misconfigured')
    expect(classifyTokenError('wrong secret provided')).toBe('misconfigured')
  })

  it('treats anything else as a dead grant', () => {
    expect(classifyTokenError('Invalid Params: Missing params')).toBe('invalid_grant')
    expect(classifyTokenError('expired code')).toBe('invalid_grant')
    expect(classifyTokenError(undefined)).toBe('invalid_grant')
  })
})

describe('exchangeAuthorizationCode / refreshAccessToken', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('sends the documented grant_type and parameters for a code exchange', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        body: { access_token: 'a', refresh_token: 'r', expires_in: 10800, scope: 'user.metrics', userid: 42 },
      }),
    )
    await exchangeAuthorizationCode({
      clientId: 'cid',
      clientSecret: 'sec',
      code: 'auth-code',
      redirectUri: 'https://x/',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://wbsapi.withings.net/v2/oauth2')
    const body = init.body as URLSearchParams
    expect(body.get('action')).toBe('requesttoken')
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('client_secret')).toBe('sec')
    expect(body.get('code')).toBe('auth-code')
    expect(body.get('redirect_uri')).toBe('https://x/')
  })

  it('sends the documented parameters for a refresh', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        body: { access_token: 'a', refresh_token: 'r2', expires_in: 10800, scope: 'user.metrics', userid: 42 },
      }),
    )
    await refreshAccessToken({ clientId: 'cid', clientSecret: 'sec', refreshToken: 'r1' })

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('r1')
  })

  it('returns the parsed token body on status 0', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        body: { access_token: 'a', refresh_token: 'r', expires_in: 10800, scope: 'user.metrics', userid: 42 },
      }),
    )
    const result = await refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'r' })
    expect(result.access_token).toBe('a')
    expect(result.userid).toBe(42)
  })

  it('a non-zero status over HTTP 200 throws WithingsTokenError, not a resolved value', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 503, error: 'Invalid Params: Missing params' }))
    await expect(
      refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }),
    ).rejects.toBeInstanceOf(WithingsTokenError)
  })

  it('a bad-credentials error classifies as misconfigured, not invalid_grant', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 503, error: 'Invalid Params: invalid client id/secret' }),
    )
    try {
      await refreshAccessToken({ clientId: 'c', clientSecret: 'wrong', refreshToken: 'r' })
      expect.unreachable()
    } catch (err) {
      expect((err as WithingsTokenError).kind).toBe('misconfigured')
      expect((err as WithingsTokenError).withingsStatus).toBe(503)
    }
  })

  it('any other rejection classifies as invalid_grant', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 503, error: 'Invalid Params: Missing params' }))
    try {
      await refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'dead-token' })
      expect.unreachable()
    } catch (err) {
      expect((err as WithingsTokenError).kind).toBe('invalid_grant')
    }
  })

  it('a transport-level HTTP failure is reported as upstream', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
    try {
      await refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'r' })
      expect.unreachable()
    } catch (err) {
      expect((err as WithingsTokenError).kind).toBe('upstream')
      expect((err as WithingsTokenError).withingsStatus).toBe(502)
    }
  })

  it('a network-level rejection is reported as network', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    try {
      await refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'r' })
      expect.unreachable()
    } catch (err) {
      expect((err as WithingsTokenError).kind).toBe('network')
    }
  })

  it('success with no body is still an error, not a silent empty response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 0 }))
    await expect(
      refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }),
    ).rejects.toBeInstanceOf(WithingsTokenError)
  })
})
