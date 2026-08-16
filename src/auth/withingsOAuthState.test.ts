import { describe, expect, it } from 'vitest'
import {
  STATE_MAX_AGE_MS,
  STATE_PREFIX,
  buildAuthorizeUrl,
  interpretCallback,
  isValidState,
  isWithingsState,
} from './withingsOAuthState'

describe('isWithingsState', () => {
  it('recognises the wth_ prefix', () => {
    expect(isWithingsState('wth_abc123')).toBe(true)
  })

  it('rejects null, empty, and foreign prefixes', () => {
    expect(isWithingsState(null)).toBe(false)
    expect(isWithingsState('')).toBe(false)
    expect(isWithingsState('google_abc')).toBe(false)
    expect(isWithingsState('abcwth_123')).toBe(false)
  })
})

describe('isValidState', () => {
  const now = 1_700_000_000_000

  it('accepts a matching, fresh state', () => {
    expect(isValidState({ value: 'wth_x', createdAt: now, persistent: false }, 'wth_x', now)).toBe(
      true,
    )
  })

  it('rejects a mismatched value', () => {
    expect(isValidState({ value: 'wth_x', createdAt: now, persistent: false }, 'wth_y', now)).toBe(
      false,
    )
  })

  it('rejects a missing stored record', () => {
    expect(isValidState(null, 'wth_x', now)).toBe(false)
  })

  it('accepts right up to the age boundary and rejects just past it', () => {
    const created = now - STATE_MAX_AGE_MS + 1
    expect(
      isValidState({ value: 'wth_x', createdAt: created, persistent: false }, 'wth_x', now),
    ).toBe(true)

    const expired = now - STATE_MAX_AGE_MS - 1
    expect(
      isValidState({ value: 'wth_x', createdAt: expired, persistent: false }, 'wth_x', now),
    ).toBe(false)
  })
})

describe('buildAuthorizeUrl', () => {
  it('includes every required parameter', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'https://mikokono.de/Google-Health-Web-Dashboard/',
        scope: 'user.metrics',
        state: 'wth_abc',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://account.withings.com/oauth2_user/authorize2')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('scope')).toBe('user.metrics')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://mikokono.de/Google-Health-Web-Dashboard/',
    )
    expect(url.searchParams.get('state')).toBe('wth_abc')
    expect(url.searchParams.has('mode')).toBe(false)
  })

  it('adds mode=demo only when requested', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'https://x/',
        scope: 'user.metrics',
        state: 'wth_abc',
        demo: true,
      }),
    )
    expect(url.searchParams.get('mode')).toBe('demo')
  })
})

describe('interpretCallback', () => {
  const now = 1_700_000_000_000
  const stored = { value: 'wth_abc', createdAt: now, persistent: false }

  it('ignores a callback with no state, or a foreign one', () => {
    expect(interpretCallback({ code: 'c', state: null, error: null }, stored, now)).toEqual({
      kind: 'not-withings',
    })
    expect(
      interpretCallback({ code: 'c', state: 'google_x', error: null }, stored, now),
    ).toEqual({ kind: 'not-withings' })
  })

  it('reports denial before checking state validity', () => {
    // Even with no matching stored state, a denial should surface as denial,
    // not as an opaque "invalid-state".
    const result = interpretCallback(
      { code: null, state: 'wth_abc', error: 'access_denied' },
      null,
      now,
    )
    expect(result).toEqual({ kind: 'denied', error: 'access_denied' })
  })

  it('rejects a mismatched state', () => {
    const result = interpretCallback({ code: 'c', state: 'wth_other', error: null }, stored, now)
    expect(result).toEqual({ kind: 'invalid-state' })
  })

  it('rejects an expired state', () => {
    const result = interpretCallback(
      { code: 'c', state: 'wth_abc', error: null },
      stored,
      now + STATE_MAX_AGE_MS + 1,
    )
    expect(result).toEqual({ kind: 'invalid-state' })
  })

  it('rejects a missing stored state (e.g. a second tab, or cleared storage)', () => {
    const result = interpretCallback({ code: 'c', state: 'wth_abc', error: null }, null, now)
    expect(result).toEqual({ kind: 'invalid-state' })
  })

  it('rejects a valid state with no code', () => {
    const result = interpretCallback({ code: null, state: 'wth_abc', error: null }, stored, now)
    expect(result).toEqual({ kind: 'invalid-state' })
  })

  it('succeeds with a valid state and a code', () => {
    const result = interpretCallback({ code: 'auth-code', state: 'wth_abc', error: null }, stored, now)
    expect(result).toEqual({ kind: 'success', code: 'auth-code', persistent: false })
  })

  it('carries the persistent choice from the stored state through to success', () => {
    const persistentStored = { value: 'wth_abc', createdAt: now, persistent: true }
    const result = interpretCallback(
      { code: 'auth-code', state: 'wth_abc', error: null },
      persistentStored,
      now,
    )
    expect(result).toEqual({ kind: 'success', code: 'auth-code', persistent: true })
  })

  it('the STATE_PREFIX constant is what isWithingsState actually checks', () => {
    expect(STATE_PREFIX).toBe('wth_')
  })
})
