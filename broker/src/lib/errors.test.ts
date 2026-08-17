import { describe, expect, it } from 'vitest'
import { ConfigError } from './config.js'
import { BadRequestError, toHttpResponse } from './errors.js'
import { WithingsTokenError } from './withings.js'

describe('toHttpResponse', () => {
  it('maps BadRequestError to 400', () => {
    const response = toHttpResponse(new BadRequestError('missing code'))
    expect(response.status).toBe(400)
    expect(response.jsonBody).toEqual({ error: 'bad_request', message: 'missing code' })
  })

  it('maps ConfigError to 500 misconfigured', () => {
    const response = toHttpResponse(new ConfigError('WITHINGS_CLIENT_ID is not set.'))
    expect(response.status).toBe(500)
    expect(response.jsonBody).toMatchObject({ error: 'misconfigured' })
  })

  it('maps WithingsTokenError(invalid_grant) to 401 -- the ONLY code that clears SPA tokens', () => {
    const response = toHttpResponse(new WithingsTokenError('dead grant', 'invalid_grant', 503))
    expect(response.status).toBe(401)
    expect(response.jsonBody).toMatchObject({ error: 'invalid_grant' })
  })

  it('maps WithingsTokenError(misconfigured) to 500, never 401', () => {
    const response = toHttpResponse(new WithingsTokenError('bad secret', 'misconfigured', 503))
    expect(response.status).toBe(500)
    expect(response.jsonBody).toMatchObject({ error: 'misconfigured' })
  })

  it('maps WithingsTokenError(upstream) and (network) to 502, not 401', () => {
    expect(toHttpResponse(new WithingsTokenError('x', 'upstream', 502)).status).toBe(502)
    expect(toHttpResponse(new WithingsTokenError('x', 'network')).status).toBe(502)
  })

  it('maps an unrecognised error to 500 without leaking its details', () => {
    const response = toHttpResponse(new Error('some internal detail'))
    expect(response.status).toBe(500)
    expect(response.jsonBody).toEqual({ error: 'internal', message: 'Unexpected error.' })
  })
})
