import { afterEach, describe, expect, it, vi } from 'vitest'
import { REQUESTED_SCOPES } from '../../api/google/dataTypes'
import {
  IDENTITY_SCOPES,
  isNarrowlyScoped,
  requestIdentityToken,
  type StoredToken,
} from './googleAuth'

function token(grantedScopes: string[]): StoredToken {
  return { accessToken: 'ya29.token', expiresAt: Date.now() + 3_600_000, grantedScopes }
}

/**
 * Stands in for the GIS client script, which is loaded from a <script> tag in
 * index.html and is not present under vitest. Records the config
 * `initTokenClient` was handed, and answers with whatever scopes the test says
 * Google granted.
 */
function stubGoogleIdentityServices(grantedScopes: string[]) {
  const configs: google.accounts.oauth2.TokenClientConfig[] = []
  vi.stubGlobal('google', {
    accounts: {
      oauth2: {
        initTokenClient(config: google.accounts.oauth2.TokenClientConfig) {
          configs.push(config)
          return {
            requestAccessToken() {
              config.callback({
                access_token: 'ya29.minted',
                expires_in: 3599,
                scope: grantedScopes.join(' '),
                token_type: 'Bearer',
              })
            },
          }
        },
      },
    },
  })
  return configs
}

afterEach(() => {
  vi.unstubAllGlobals()
})

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

describe('requestIdentityToken', () => {
  it('opts out of incremental authorization', async () => {
    // The bug this pins. GIS defaults include_granted_scopes to TRUE, so asking
    // for a subset of an existing grant returns a token covering the WHOLE
    // grant -- every googlehealth.*.readonly scope included. Without this flag
    // the mint succeeds and hands back exactly the token the narrow-token
    // design exists to avoid sending, and nothing downstream would notice
    // except the scope guard.
    const configs = stubGoogleIdentityServices(IDENTITY_SCOPES)

    await requestIdentityToken('client-id')

    expect(configs).toHaveLength(1)
    expect(configs[0].include_granted_scopes).toBe(false)
  })

  it('asks for no consent screen, since the scope was granted at sign-in', async () => {
    const configs = stubGoogleIdentityServices(IDENTITY_SCOPES)

    await requestIdentityToken('client-id')

    expect(configs[0].prompt).toBe('')
    expect(configs[0].scope).toBe(IDENTITY_SCOPES.join(' '))
  })

  it('returns the token when Google grants only the identity scope', async () => {
    stubGoogleIdentityServices(IDENTITY_SCOPES)

    const minted = await requestIdentityToken('client-id')

    expect(minted.accessToken).toBe('ya29.minted')
    expect(minted.grantedScopes).toEqual(IDENTITY_SCOPES)
  })

  it('refuses a token Google widened beyond the identity scope', async () => {
    // Belt to the braces above: if incremental authorization is ever re-enabled
    // by accident, or Google widens a grant on its own, the token must not be
    // sent. Failing loudly here is the point -- the first version of this
    // swallowed the rejection and looked like a dead button.
    stubGoogleIdentityServices(REQUESTED_SCOPES)

    await expect(requestIdentityToken('client-id')).rejects.toThrow(/broader grant/)
  })
})
