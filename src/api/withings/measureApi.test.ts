import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WithingsApiError, getMeasureGroups } from './measureApi'
import type { RawMeasureGroup } from './types'

function rawGroup(grpid: number): RawMeasureGroup {
  return {
    grpid,
    attrib: 0,
    date: 1_700_000_000 + grpid,
    created: 1_700_000_000,
    category: 1,
    deviceid: 'dev-1',
    measures: [{ value: 1, type: 1, unit: 0 }],
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

describe('getMeasureGroups', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('sends the access token as a form field, not an Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 0, body: { updatetime: 0, timezone: 'UTC', measuregrps: [] } }),
    )
    await getMeasureGroups({ accessToken: 'tok-123', lookbackDays: 0 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://wbsapi.withings.net/measure')
    expect(init.headers).not.toHaveProperty('Authorization')
    const body = init.body as URLSearchParams
    expect(body.get('access_token')).toBe('tok-123')
    expect(body.get('action')).toBe('getmeas')
  })

  it('omits the date filter entirely when lookbackDays is 0', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 0, body: { updatetime: 0, timezone: 'UTC', measuregrps: [] } }),
    )
    await getMeasureGroups({ accessToken: 't', lookbackDays: 0 })
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams
    expect(body.has('startdate')).toBe(false)
    expect(body.has('enddate')).toBe(false)
  })

  it('sends startdate/enddate relative to `now` when lookbackDays > 0', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 0, body: { updatetime: 0, timezone: 'UTC', measuregrps: [] } }),
    )
    const now = new Date('2026-08-16T12:00:00Z')
    await getMeasureGroups({ accessToken: 't', lookbackDays: 7, now })
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams
    const expectedStart = Math.floor(now.getTime() / 1000) - 7 * 86400
    expect(body.get('startdate')).toBe(String(expectedStart))
    expect(body.get('enddate')).toBe(String(Math.floor(now.getTime() / 1000)))
  })

  it('follows more/offset across pages and concatenates the groups', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 0,
          body: { updatetime: 0, timezone: 'UTC', measuregrps: [rawGroup(1), rawGroup(2)], more: 1, offset: 2 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 0,
          body: { updatetime: 0, timezone: 'UTC', measuregrps: [rawGroup(3)], more: 0 },
        }),
      )

    const groups = await getMeasureGroups({ accessToken: 't', lookbackDays: 0 })

    expect(groups.map((g) => g.grpid)).toEqual([1, 2, 3])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondBody = fetchMock.mock.calls[1][1].body as URLSearchParams
    expect(secondBody.get('offset')).toBe('2')
  })

  it('stops at maxPages even if more keeps claiming true', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          status: 0,
          body: { updatetime: 0, timezone: 'UTC', measuregrps: [rawGroup(1)], more: 1, offset: 1 },
        }),
      ),
    )

    const groups = await getMeasureGroups({ accessToken: 't', lookbackDays: 0, maxPages: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(groups).toHaveLength(3)
  })

  it('throws on a non-zero status even though the HTTP response is 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 401, error: 'invalid_token' }, 200))

    await expect(getMeasureGroups({ accessToken: 'bad', lookbackDays: 0 })).rejects.toThrow(
      WithingsApiError,
    )
  })

  it('error carries the numeric status and the raw api error text', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 401, error: 'invalid_token' }, 200))

    try {
      await getMeasureGroups({ accessToken: 'bad', lookbackDays: 0 })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(WithingsApiError)
      const apiErr = err as WithingsApiError
      expect(apiErr.status).toBe(401)
      expect(apiErr.apiError).toBe('invalid_token')
      expect(apiErr.message).toContain('Reconnect Withings')
    }
  })

  it('an unmapped status still produces a diagnosable message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 2554, error: 'weird' }, 200))
    await expect(getMeasureGroups({ accessToken: 't', lookbackDays: 0 })).rejects.toThrow(
      /Withings error 2554.*weird/,
    )
  })

  it('a transport-level HTTP failure is also reported', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
    await expect(getMeasureGroups({ accessToken: 't', lookbackDays: 0 })).rejects.toThrow(
      WithingsApiError,
    )
  })

  it('a network-level rejection becomes a WithingsApiError with status 0', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    try {
      await getMeasureGroups({ accessToken: 't', lookbackDays: 0 })
      expect.unreachable()
    } catch (err) {
      expect((err as WithingsApiError).status).toBe(0)
    }
  })

  it('a page with no groups short-circuits without following more', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 0, body: { updatetime: 0, timezone: 'UTC', measuregrps: [] } }),
    )
    const groups = await getMeasureGroups({ accessToken: 't', lookbackDays: 0 })
    expect(groups).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
