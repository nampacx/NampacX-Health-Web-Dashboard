import { describe, expect, it } from 'vitest'
import { fakeRequest } from '../test/fakeRequest.js'
import { corsHeaders, preflightResponse } from './cors.js'

const ALLOWED = ['https://mikokono.de', 'http://localhost:5173']

describe('corsHeaders', () => {
  it('echoes an allowed origin and sets Vary', () => {
    const headers = corsHeaders(fakeRequest({ origin: 'https://mikokono.de' }), ALLOWED)
    expect(headers['Access-Control-Allow-Origin']).toBe('https://mikokono.de')
    expect(headers.Vary).toBe('Origin')
  })

  it('returns no headers for a disallowed origin', () => {
    const headers = corsHeaders(fakeRequest({ origin: 'https://evil.example' }), ALLOWED)
    expect(headers).toEqual({})
  })

  it('returns no headers when Origin is absent', () => {
    expect(corsHeaders(fakeRequest({ origin: null }), ALLOWED)).toEqual({})
  })
})

describe('preflightResponse', () => {
  it('returns null for a non-OPTIONS request', () => {
    expect(preflightResponse(fakeRequest({ method: 'POST' }), ALLOWED)).toBeNull()
  })

  it('answers an OPTIONS request from an allowed origin with 204 and CORS headers', () => {
    const response = preflightResponse(
      fakeRequest({ method: 'OPTIONS', origin: 'https://mikokono.de' }),
      ALLOWED,
    )
    expect(response?.status).toBe(204)
    expect(response?.headers).toMatchObject({
      'Access-Control-Allow-Origin': 'https://mikokono.de',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    })
  })

  it('still answers 204 for a disallowed origin, but without an ACAO header', () => {
    // The browser enforces CORS by refusing to let JS read the response when
    // ACAO is absent/mismatched -- returning 204 here is fine either way.
    const response = preflightResponse(
      fakeRequest({ method: 'OPTIONS', origin: 'https://evil.example' }),
      ALLOWED,
    )
    expect(response?.status).toBe(204)
    expect(response?.headers).not.toHaveProperty('Access-Control-Allow-Origin')
  })
})
