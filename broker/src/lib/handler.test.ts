import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeContext } from '../test/fakeContext.js'
import { fakeRequest } from '../test/fakeRequest.js'
import { BadRequestError } from './errors.js'
import { withBroker } from './handler.js'

const FULL_ENV = {
  WITHINGS_CLIENT_ID: 'cid',
  WITHINGS_CLIENT_SECRET: 'secret',
  ALLOWED_ORIGINS: 'https://mikokono.de',
  ALLOWED_REDIRECT_URIS: 'https://mikokono.de/',
}

describe('withBroker', () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(FULL_ENV)) vi.stubEnv(key, value)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('answers an OPTIONS preflight without calling the handler', async () => {
    const inner = vi.fn()
    const response = await withBroker(inner)(
      fakeRequest({ method: 'OPTIONS', origin: 'https://mikokono.de' }),
      fakeContext(),
    )
    expect(response.status).toBe(204)
    expect(inner).not.toHaveBeenCalled()
  })

  it('calls the handler and returns 200 with CORS headers for an allowed origin', async () => {
    const inner = vi.fn(async () => ({ ok: true }))
    const response = await withBroker(inner)(
      fakeRequest({ origin: 'https://mikokono.de', body: 'a=1' }),
      fakeContext(),
    )
    expect(response.status).toBe(200)
    expect(response.jsonBody).toEqual({ ok: true })
    expect(response.headers).toMatchObject({ 'Access-Control-Allow-Origin': 'https://mikokono.de' })
  })

  it('passes the parsed form body through as URLSearchParams', async () => {
    const inner = vi.fn(async (params: URLSearchParams) => ({ code: params.get('code') }))
    const response = await withBroker(inner)(
      fakeRequest({ origin: 'https://mikokono.de', body: 'code=abc123&redirect_uri=https%3A%2F%2Fx%2F' }),
      fakeContext(),
    )
    expect(response.jsonBody).toEqual({ code: 'abc123' })
  })

  it('omits Access-Control-Allow-Origin for a disallowed origin, even on success', async () => {
    const inner = vi.fn(async () => ({ ok: true }))
    const response = await withBroker(inner)(
      fakeRequest({ origin: 'https://evil.example' }),
      fakeContext(),
    )
    expect(response.headers).not.toHaveProperty('Access-Control-Allow-Origin')
  })

  it('maps a thrown BadRequestError to 400 with CORS headers still attached', async () => {
    const inner = vi.fn(async () => {
      throw new BadRequestError('missing code')
    })
    const response = await withBroker(inner)(fakeRequest({ origin: 'https://mikokono.de' }), fakeContext())
    expect(response.status).toBe(400)
    expect(response.headers).toMatchObject({ 'Access-Control-Allow-Origin': 'https://mikokono.de' })
  })

  it('when config itself is missing, still returns a readable error with permissive CORS', async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('WITHINGS_CLIENT_ID', '') // everything else missing too

    const inner = vi.fn()
    const response = await withBroker(inner)(
      fakeRequest({ origin: 'https://mikokono.de' }),
      fakeContext(),
    )
    expect(response.status).toBe(500)
    expect(response.jsonBody).toMatchObject({ error: 'misconfigured' })
    // Permissive on purpose here: no allowlist could be loaded to consult,
    // and the body carries no secret -- just a setup message.
    expect(response.headers).toMatchObject({ 'Access-Control-Allow-Origin': '*' })
    expect(inner).not.toHaveBeenCalled()
  })
})
