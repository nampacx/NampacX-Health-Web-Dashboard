import { describe, expect, it } from 'vitest'
import { REQUESTED_SCOPES } from '../../api/google/dataTypes'
import { IDENTITY_SCOPES, isNarrowlyScoped, type StoredToken } from './googleAuth'

function token(grantedScopes: string[]): StoredToken {
  return { accessToken: 'ya29.token', expiresAt: Date.now() + 3_600_000, grantedScopes }
}

describe('IDENTITY_SCOPES', () => {
  it('carries no Google Health scope', () => {
    // The whole point of the narrow token. Anything matching this pattern in
    // the list would hand the bloodwork backend a readable health record.
    expect(IDENTITY_SCOPES.filter((scope) => scope.includes('googlehealth'))).toEqual([])
  })

  it('is a subset of what sign-in already asks for', () => {
    // If it were not, minting would trigger a second consent screen on every
    // fresh session instead of completing silently.
    for (const scope of IDENTITY_SCOPES) {
      expect(REQUESTED_SCOPES).toContain(scope)
    }
  })

  it('is narrower than the sign-in grant it is minted from', () => {
    expect(IDENTITY_SCOPES.length).toBeLessThan(REQUESTED_SCOPES.length)
  })
})

describe('isNarrowlyScoped', () => {
  it('accepts exactly the identity scopes', () => {
    expect(isNarrowlyScoped(token([...IDENTITY_SCOPES]))).toBe(true)
  })

  it('accepts the OIDC short names Google echoes alongside them', () => {
    expect(isNarrowlyScoped(token([...IDENTITY_SCOPES, 'openid', 'email', 'profile']))).toBe(true)
  })

  it('rejects a token carrying a health scope', () => {
    // The regression this guard exists for: a grant that came back wider than
    // was asked for must be discarded, not sent. Google decides what it grants,
    // and incremental authorization means that can change without this app
    // asking for anything new.
    expect(
      isNarrowlyScoped(
        token([
          ...IDENTITY_SCOPES,
          'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
        ]),
      ),
    ).toBe(false)
  })

  it('rejects the full sign-in grant', () => {
    expect(isNarrowlyScoped(token([...REQUESTED_SCOPES]))).toBe(false)
  })

  it('treats an empty grant as narrow', () => {
    // A token that was granted nothing cannot read anything. It will fail
    // server-side on its own merits; it is not this check's job to reject it.
    expect(isNarrowlyScoped(token([]))).toBe(true)
  })
})
