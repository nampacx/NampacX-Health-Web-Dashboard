import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryStorage } from '../../test/memoryStorage'
import {
  WithingsNotConnectedError,
  applyTokenResponse,
  clearTokens,
  ensureAccessToken,
  hasRefreshToken,
  isAccessTokenValid,
  loadAccessToken,
  loadRefreshRecord,
  type BrokerTokenResponse,
} from './withingsTokenStore'

function brokerResponse(overrides: Partial<BrokerTokenResponse> = {}): BrokerTokenResponse {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresIn: 10800,
    scope: 'user.metrics',
    userId: 'user-1',
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  vi.stubGlobal('localStorage', new MemoryStorage())
  // Node ships a minimal global `navigator` with no `.locks`; explicitly
  // stub it absent so the cross-tab-lock branch is deterministically off
  // and the in-tab single-flight guard is what gets exercised.
  vi.stubGlobal('navigator', {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('applyTokenResponse', () => {
  it('writes the access token to sessionStorage regardless of persistence', () => {
    applyTokenResponse(brokerResponse(), { persistent: true })
    expect(loadAccessToken()?.accessToken).toBe('access-1')
    expect(sessionStorage.getItem('ghd.withings.access')).not.toBeNull()
  })

  it('writes a non-persistent refresh record to sessionStorage and clears localStorage', () => {
    applyTokenResponse(brokerResponse(), { persistent: false })
    expect(sessionStorage.getItem('ghd.withings.refresh')).not.toBeNull()
    expect(localStorage.getItem('ghd.withings.refresh')).toBeNull()
  })

  it('writes a persistent refresh record to localStorage and clears sessionStorage', () => {
    applyTokenResponse(brokerResponse(), { persistent: true })
    expect(localStorage.getItem('ghd.withings.refresh')).not.toBeNull()
    expect(sessionStorage.getItem('ghd.withings.refresh')).toBeNull()
  })

  it('chains previous -> current across rotations', () => {
    applyTokenResponse(brokerResponse({ refreshToken: 'r1' }), { persistent: false })
    applyTokenResponse(brokerResponse({ refreshToken: 'r2' }), { persistent: false })
    const record = loadRefreshRecord()
    expect(record?.current).toBe('r2')
    expect(record?.previous).toBe('r1')
  })

  it('switching persistence moves the record and cleans up the old location', () => {
    applyTokenResponse(brokerResponse({ refreshToken: 'r1' }), { persistent: false })
    applyTokenResponse(brokerResponse({ refreshToken: 'r2' }), { persistent: true })
    expect(localStorage.getItem('ghd.withings.refresh')).not.toBeNull()
    expect(sessionStorage.getItem('ghd.withings.refresh')).toBeNull()
    expect(loadRefreshRecord()?.current).toBe('r2')
  })
})

describe('clearTokens', () => {
  it('removes the access token and the refresh record from both storages', () => {
    applyTokenResponse(brokerResponse(), { persistent: true })
    clearTokens()
    expect(loadAccessToken()).toBeNull()
    expect(loadRefreshRecord()).toBeNull()
    expect(hasRefreshToken()).toBe(false)
  })
})

describe('isAccessTokenValid', () => {
  it('rejects null', () => {
    expect(isAccessTokenValid(null)).toBe(false)
  })

  it('rejects a token inside the 60s expiry skew', () => {
    const token = { accessToken: 'a', expiresAt: Date.now() + 30_000, userId: 'u', scope: 's' }
    expect(isAccessTokenValid(token)).toBe(false)
  })

  it('accepts a token comfortably before expiry', () => {
    const token = { accessToken: 'a', expiresAt: Date.now() + 3_600_000, userId: 'u', scope: 's' }
    expect(isAccessTokenValid(token)).toBe(true)
  })
})

describe('ensureAccessToken', () => {
  function fakeRefresh(response: BrokerTokenResponse | Error) {
    return vi.fn(async () => {
      if (response instanceof Error) throw response
      return response
    })
  }

  it('returns the cached token without calling refresh when still valid', async () => {
    applyTokenResponse(brokerResponse(), { persistent: false })
    const refresh = fakeRefresh(brokerResponse())

    const token = await ensureAccessToken({ refresh, isInvalidGrant: () => false, persistent: false })

    expect(token).toBe('access-1')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('throws WithingsNotConnectedError when there is no refresh token at all', async () => {
    const refresh = fakeRefresh(brokerResponse())
    await expect(
      ensureAccessToken({ refresh, isInvalidGrant: () => false, persistent: false }),
    ).rejects.toBeInstanceOf(WithingsNotConnectedError)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes and persists when the cached token is expired', async () => {
    applyTokenResponse(
      { ...brokerResponse(), accessToken: 'stale', expiresIn: -1 },
      { persistent: false },
    )
    const refresh = fakeRefresh(brokerResponse({ accessToken: 'fresh', refreshToken: 'r2' }))

    const token = await ensureAccessToken({ refresh, isInvalidGrant: () => false, persistent: false })

    expect(token).toBe('fresh')
    expect(refresh).toHaveBeenCalledWith('refresh-1')
    expect(loadRefreshRecord()?.current).toBe('r2')
  })

  it('an invalid_grant failure clears stored tokens', async () => {
    applyTokenResponse(
      { ...brokerResponse(), expiresIn: -1 },
      { persistent: false },
    )
    const err = new Error('dead grant')
    const refresh = fakeRefresh(err)

    await expect(
      ensureAccessToken({ refresh, isInvalidGrant: (e) => e === err, persistent: false }),
    ).rejects.toBe(err)

    expect(loadRefreshRecord()).toBeNull()
    expect(loadAccessToken()).toBeNull()
  })

  it('a non-invalid_grant failure (network/5xx) leaves stored tokens untouched', async () => {
    applyTokenResponse(
      { ...brokerResponse(), expiresIn: -1 },
      { persistent: false },
    )
    const err = new Error('502 from broker')
    const refresh = fakeRefresh(err)

    await expect(
      ensureAccessToken({ refresh, isInvalidGrant: () => false, persistent: false }),
    ).rejects.toBe(err)

    // The refresh token must survive a transient failure -- losing it here
    // would be the single worst bug this module could ship.
    expect(loadRefreshRecord()?.current).toBe('refresh-1')
  })

  it('two concurrent calls with an expired cache make exactly one broker request', async () => {
    applyTokenResponse(
      { ...brokerResponse(), expiresIn: -1 },
      { persistent: false },
    )

    let resolveRefresh!: (v: BrokerTokenResponse) => void
    const refresh = vi.fn(
      () => new Promise<BrokerTokenResponse>((resolve) => { resolveRefresh = resolve }),
    )

    const first = ensureAccessToken({ refresh, isInvalidGrant: () => false, persistent: false })
    const second = ensureAccessToken({ refresh, isInvalidGrant: () => false, persistent: false })

    resolveRefresh(brokerResponse({ accessToken: 'shared' }))
    const [a, b] = await Promise.all([first, second])

    expect(a).toBe('shared')
    expect(b).toBe('shared')
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
