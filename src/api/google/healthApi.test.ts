import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_TYPES_BY_ID } from './dataTypes'
import { fetchLatestRecords, listDataPoints, resetFilterDialect } from './healthApi'
import type { DataTypeDef } from './types'

function typeById(id: string): DataTypeDef {
  const dataType = DATA_TYPES_BY_ID.get(id)
  if (!dataType) throw new Error(`no such data type: ${id}`)
  return dataType
}

function page(count: number, nextPageToken?: string, prefix = 'p') {
  return new Response(
    JSON.stringify({
      dataPoints: Array.from({ length: count }, (_, i) => ({ name: `${prefix}${i}` })),
      ...(nextPageToken ? { nextPageToken } : {}),
    }),
    { status: 200 },
  )
}

const BAD_FILTER = () =>
  new Response(JSON.stringify({ error: { message: 'Invalid filter field.' } }), { status: 400 })

function urlsOf(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map((call) => String(call[0]))
}

function filterOf(url: string): string | null {
  return new URL(url).searchParams.get('filter')
}

describe('listDataPoints, filter dialect', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetFilterDialect()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('sends a filter derived from the record type, not a fixed field', async () => {
    fetchMock.mockResolvedValueOnce(page(1))
    await listDataPoints(typeById('weight'), { accessToken: 't', pageSize: 10, lookbackDays: 7 })
    expect(filterOf(urlsOf(fetchMock)[0])).toContain('sample_time.civil_time')
  })

  /**
   * The bug this replaced: `sleep.interval.civil_start_time` is documented as
   * unsupported, so every sleep fetch was rejected and fell back to unfiltered --
   * the time range did nothing at all, silently.
   */
  it('never asks sleep for a start-time filter', async () => {
    fetchMock.mockResolvedValueOnce(page(1))
    await listDataPoints(typeById('sleep'), { accessToken: 't', pageSize: 10, lookbackDays: 30 })
    const filter = filterOf(urlsOf(fetchMock)[0])
    expect(filter).toContain('interval.civil_end_time')
    expect(filter).not.toContain('civil_start_time')
  })

  // The reference never settles which spelling the grammar wants, so a rejected
  // one is retried in the other rather than silently costing the time range.
  it('retries the other spelling when the first is rejected', async () => {
    fetchMock.mockResolvedValueOnce(BAD_FILTER()).mockResolvedValueOnce(page(1))
    await listDataPoints(typeById('daily-resting-heart-rate'), {
      accessToken: 't',
      pageSize: 10,
      lookbackDays: 7,
    })

    const [first, second] = urlsOf(fetchMock).map(filterOf)
    expect(first).toContain('dailyRestingHeartRate')
    expect(second).toContain('daily_resting_heart_rate')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // Once the API has answered the question, later fetches must not keep paying
  // for it -- that would be an extra round trip per data type, every load.
  it('remembers the spelling that worked', async () => {
    fetchMock.mockResolvedValueOnce(BAD_FILTER()).mockResolvedValueOnce(page(1))
    const options = { accessToken: 't', pageSize: 10, lookbackDays: 7 }
    await listDataPoints(typeById('daily-resting-heart-rate'), options)

    fetchMock.mockResolvedValueOnce(page(1))
    await listDataPoints(typeById('daily-heart-rate-variability'), options)

    expect(filterOf(urlsOf(fetchMock)[2])).toContain('daily_heart_rate_variability')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  // Still the last line of defence: a rejected *field* means no spelling helps,
  // and the type should contribute rows rather than drop out of the dashboard.
  it('falls back to an unfiltered request when both spellings are rejected', async () => {
    fetchMock
      .mockResolvedValueOnce(BAD_FILTER())
      .mockResolvedValueOnce(BAD_FILTER())
      .mockResolvedValueOnce(page(3))

    const result = await listDataPoints(typeById('steps'), {
      accessToken: 't',
      pageSize: 10,
      lookbackDays: 7,
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(filterOf(urlsOf(fetchMock)[2])).toBeNull()
    expect(result.dataPoints).toHaveLength(3)
  })

  // No spelling of a type without a time field will help, so trying twice is a
  // wasted round trip.
  it('does not probe spellings for a type with nothing to filter on', async () => {
    fetchMock.mockResolvedValueOnce(page(2))
    await listDataPoints(typeById('food'), { accessToken: 't', pageSize: 10, lookbackDays: 7 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(filterOf(urlsOf(fetchMock)[0])).toBeNull()
  })

  it('sends no filter at all when the lookback is 0', async () => {
    fetchMock.mockResolvedValueOnce(page(1))
    await listDataPoints(typeById('steps'), { accessToken: 't', pageSize: 10, lookbackDays: 0 })
    expect(filterOf(urlsOf(fetchMock)[0])).toBeNull()
  })

  it('propagates a non-400 failure instead of hiding it behind a retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    await expect(
      listDataPoints(typeById('steps'), { accessToken: 't', pageSize: 10, lookbackDays: 7 }),
    ).rejects.toMatchObject({ status: 403 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

/**
 * Paging is what lifts the ceiling on sleep and exercise: the API caps a single
 * page at 25 for those two however much more is asked for, so without following
 * nextPageToken there was no way to see a 26th night.
 */
describe('listDataPoints, pagination', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetFilterDialect()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  const options = { accessToken: 't', pageSize: 60, lookbackDays: 0 }

  it('follows nextPageToken past the per-request cap', async () => {
    fetchMock
      .mockResolvedValueOnce(page(25, 'tok-1', 'a'))
      .mockResolvedValueOnce(page(25, 'tok-2', 'b'))
      .mockResolvedValueOnce(page(25, undefined, 'c'))

    const result = await listDataPoints(typeById('sleep'), options)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.dataPoints).toHaveLength(60)
    expect(new URL(urlsOf(fetchMock)[1]).searchParams.get('page_token')).toBe('tok-1')
  })

  it('stops as soon as it has enough, even with a token left over', async () => {
    fetchMock
      .mockResolvedValueOnce(page(25, 'tok-1', 'a'))
      .mockResolvedValueOnce(page(25, 'tok-2', 'b'))
      .mockResolvedValueOnce(page(25, 'tok-3', 'c'))

    const result = await listDataPoints(typeById('sleep'), options)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.dataPoints).toHaveLength(60)
  })

  it('stops when the data runs out before the target', async () => {
    fetchMock.mockResolvedValueOnce(page(4))
    const result = await listDataPoints(typeById('sleep'), options)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.dataPoints).toHaveLength(4)
  })

  // A token alongside an empty page would otherwise spin to the page cap.
  it('stops on an empty page even when a token is still offered', async () => {
    fetchMock
      .mockResolvedValueOnce(page(25, 'tok-1', 'a'))
      .mockResolvedValueOnce(page(0, 'tok-2'))

    const result = await listDataPoints(typeById('sleep'), options)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.dataPoints).toHaveLength(25)
  })

  // Every page must carry the same filter, or later pages quietly widen the range.
  it('reuses the filter that worked on every later page', async () => {
    fetchMock
      .mockResolvedValueOnce(page(25, 'tok-1', 'a'))
      .mockResolvedValueOnce(page(25, undefined, 'b'))

    await listDataPoints(typeById('sleep'), { ...options, lookbackDays: 30 })

    const [first, second] = urlsOf(fetchMock).map(filterOf)
    expect(second).toBe(first)
    expect(second).toContain('civil_end_time')
  })

  it('does not page at all when one page already covers the target', async () => {
    fetchMock.mockResolvedValueOnce(page(10, 'tok-1'))
    const result = await listDataPoints(typeById('steps'), { ...options, pageSize: 10 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.dataPoints).toHaveLength(10)
  })
})

/**
 * "Last 14 days" is snapped to a day boundary rather than run back exactly
 * 14x24 h. Without it every day-grouped view shows a boundary day cut at
 * whatever time of day it happens to be, rendered identically to a whole one.
 */
describe('listDataPoints, window', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetFilterDialect()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('starts the window at midnight, not at the current time of day', async () => {
    fetchMock.mockResolvedValueOnce(page(1))
    await listDataPoints(typeById('steps'), { accessToken: 't', pageSize: 10, lookbackDays: 14 })
    expect(filterOf(urlsOf(fetchMock)[0])).toMatch(/T00:00:00"$/)
  })

  // Daily types take a date literal, which is already a day boundary.
  it('leaves the date-only daily filter alone', async () => {
    fetchMock.mockResolvedValueOnce(page(1))
    await listDataPoints(typeById('daily-resting-heart-rate'), {
      accessToken: 't',
      pageSize: 10,
      lookbackDays: 14,
    })
    expect(filterOf(urlsOf(fetchMock)[0])).toMatch(/\d{4}-\d{2}-\d{2}"$/)
  })
})

/**
 * Whether the row budget or the data ran out first. Load-bearing for any view
 * that groups rows into a larger unit: results are newest-first, so a fetch that
 * stops early stops mid-way through the oldest thing it reached.
 */
describe('fetchLatestRecords, truncation', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetFilterDialect()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('reports truncated when the API still had a page to give', async () => {
    fetchMock.mockResolvedValueOnce(page(10, 'tok-1'))
    const { outcomes } = await fetchLatestRecords([typeById('nutrition-log')], {
      accessToken: 't',
      pageSize: 10,
      lookbackDays: 0,
    })
    expect(outcomes[0].truncated).toBe(true)
    expect(outcomes[0].count).toBe(10)
  })

  it('reports not truncated when the data simply ran out', async () => {
    fetchMock.mockResolvedValueOnce(page(4))
    const { outcomes } = await fetchLatestRecords([typeById('nutrition-log')], {
      accessToken: 't',
      pageSize: 10,
      lookbackDays: 0,
    })
    expect(outcomes[0].truncated).toBe(false)
  })

  it('reports not truncated on a failure, which is a different problem', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    const { outcomes } = await fetchLatestRecords([typeById('steps')], {
      accessToken: 't',
      pageSize: 10,
      lookbackDays: 0,
    })
    expect(outcomes[0].status).toBe('error')
    expect(outcomes[0].truncated).toBe(false)
  })
})
