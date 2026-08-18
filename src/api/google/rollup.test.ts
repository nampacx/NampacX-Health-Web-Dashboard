import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_TYPES_BY_ID, ROLLUP_ONLY_IDS } from './dataTypes'
import { HealthApiError } from './healthApi'
import { fetchDailyRollup, maxRangeDays, rollupWindow } from './rollup'
import type { DataTypeDef } from './types'

function typeById(id: string): DataTypeDef {
  const dataType = DATA_TYPES_BY_ID.get(id)
  if (!dataType) throw new Error(`no such data type: ${id}`)
  return dataType
}

const FLOORS = typeById('floors')
const TOTAL_CALORIES = typeById('total-calories')

// Mid-afternoon, so a window that stopped at "now" would visibly cut today off.
const NOW = new Date(2026, 7, 17, 15, 30, 0)

describe('rollupWindow', () => {
  /**
   * The range is closed-open, so the exclusive end has to sit at tomorrow's
   * midnight or today is silently excluded -- the day the user most wants.
   */
  it('ends at tomorrow midnight so today is included', () => {
    const window = rollupWindow(FLOORS, 7, NOW)
    expect(window.end).toEqual({ year: 2026, month: 8, day: 18 })
    expect(window.start).toEqual({ year: 2026, month: 8, day: 11 })
  })

  it('spans exactly the requested number of days', () => {
    expect(rollupWindow(FLOORS, 1, NOW).start).toEqual({ year: 2026, month: 8, day: 17 })
    expect(rollupWindow(FLOORS, 30, NOW).start).toEqual({ year: 2026, month: 7, day: 19 })
  })

  it('crosses a month boundary correctly', () => {
    const window = rollupWindow(FLOORS, 90, new Date(2026, 0, 5, 9, 0, 0))
    expect(window.end).toEqual({ year: 2026, month: 1, day: 6 })
    expect(window.start).toEqual({ year: 2025, month: 10, day: 8 })
  })

  /**
   * The cap is not uniform: 14 days for total-calories and friends, 90 for the
   * rest. Sending the 90-day window to a 14-day type is a 400, which is exactly
   * the error this whole change set out to remove.
   */
  it('clamps to the per-type maximum and says it did', () => {
    expect(maxRangeDays(TOTAL_CALORIES)).toBe(14)
    expect(maxRangeDays(FLOORS)).toBe(90)

    const clamped = rollupWindow(TOTAL_CALORIES, 90, NOW)
    expect(clamped.start).toEqual({ year: 2026, month: 8, day: 4 })
    expect(clamped.clamped).toBe(true)

    expect(rollupWindow(TOTAL_CALORIES, 14, NOW).clamped).toBe(false)
    expect(rollupWindow(FLOORS, 90, NOW).clamped).toBe(false)
  })

  // "No time filter" is unrepresentable here -- the endpoint requires a range --
  // so it becomes the largest the type allows rather than an error.
  it('turns "no time filter" into the widest legal window', () => {
    expect(rollupWindow(FLOORS, 0, NOW).start).toEqual({ year: 2026, month: 5, day: 20 })
    expect(rollupWindow(TOTAL_CALORIES, 0, NOW).start).toEqual({ year: 2026, month: 8, day: 4 })
    expect(rollupWindow(FLOORS, 0, NOW).clamped).toBe(false)
  })
})

describe('fetchDailyRollup', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  function rollupResponse(points: unknown[], nextPageToken?: string) {
    return new Response(
      JSON.stringify({ rollupDataPoints: points, ...(nextPageToken ? { nextPageToken } : {}) }),
      { status: 200 },
    )
  }

  function day(dayOfMonth: number, value: Record<string, unknown> | null, key = 'floors') {
    return {
      civilStartTime: { date: { year: 2026, month: 8, day: dayOfMonth } },
      civilEndTime: { date: { year: 2026, month: 8, day: dayOfMonth + 1 } },
      ...(value ? { [key]: value } : {}),
    }
  }

  it('POSTs a civil day range with a one-day window', async () => {
    fetchMock.mockResolvedValueOnce(rollupResponse([]))
    await fetchDailyRollup(FLOORS, {
      accessToken: 'tok-1',
      pageSize: 25,
      lookbackDays: 7,
      now: NOW,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/dataTypes/floors/dataPoints:dailyRollUp')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok-1')

    const body = JSON.parse(init.body)
    expect(body.windowSizeDays).toBe(1)
    expect(body.pageSize).toBe(25)
    expect(body.range.start.date).toEqual({ year: 2026, month: 8, day: 11 })
    expect(body.range.end.date).toEqual({ year: 2026, month: 8, day: 18 })
    // Omitting the time is what makes the start midnight-aligned, which the
    // endpoint requires for a one-day window.
    expect(body.range.start.time).toBeUndefined()
  })

  it('turns each window into a record dated to its civil day', async () => {
    fetchMock.mockResolvedValueOnce(
      rollupResponse([day(15, { countSum: '12' }), day(16, { countSum: '4' })]),
    )
    const { records } = await fetchDailyRollup(FLOORS, {
      accessToken: 't',
      pageSize: 25,
      lookbackDays: 7,
      now: NOW,
    })

    expect(records).toHaveLength(2)
    // Newest-first, matching how listed records arrive.
    expect(records[0].timestamp?.getDate()).toBe(16)
    expect(records[1].timestamp?.getDate()).toBe(15)
    expect(records[0].dataType.id).toBe('floors')
  })

  /**
   * The trap in this response. A window with no data omits the union member
   * rather than sending a zero -- and `extractPayload` would then fall through to
   * `civilStartTime` and flatten it into a row reading "Year: 2,026".
   */
  it('drops windows that carry no value at all', async () => {
    fetchMock.mockResolvedValueOnce(
      rollupResponse([day(15, { countSum: '12' }), day(16, null), day(17, null)]),
    )
    const { records } = await fetchDailyRollup(FLOORS, {
      accessToken: 't',
      pageSize: 25,
      lookbackDays: 7,
      now: NOW,
    })

    expect(records).toHaveLength(1)
    expect(records.every((record) => !/year/i.test(record.summary ?? ''))).toBe(true)
  })

  // The rolled-up field is `kcalSum`, not the `caloriesKcal` a listed point
  // would carry, so the unit has to survive the aggregation suffix.
  it('renders a rolled-up energy field with its unit', async () => {
    fetchMock.mockResolvedValueOnce(rollupResponse([day(16, { kcalSum: 2345 }, 'totalCalories')]))
    const { records } = await fetchDailyRollup(TOTAL_CALORIES, {
      accessToken: 't',
      pageSize: 25,
      lookbackDays: 7,
      now: NOW,
    })
    expect(records[0].summary).toContain('2,345 kcal')
  })

  it('reads the floors count through the flattener', async () => {
    fetchMock.mockResolvedValueOnce(rollupResponse([day(16, { countSum: '12' })]))
    const { records } = await fetchDailyRollup(FLOORS, {
      accessToken: 't',
      pageSize: 25,
      lookbackDays: 7,
      now: NOW,
    })
    expect(records[0].summary).toContain('12')
  })

  it('marks itself truncated when the window was clamped', async () => {
    fetchMock.mockResolvedValueOnce(rollupResponse([]))
    const clamped = await fetchDailyRollup(TOTAL_CALORIES, {
      accessToken: 't',
      pageSize: 25,
      lookbackDays: 90,
      now: NOW,
    })
    expect(clamped.truncated).toBe(true)

    fetchMock.mockResolvedValueOnce(rollupResponse([]))
    const whole = await fetchDailyRollup(TOTAL_CALORIES, {
      accessToken: 't',
      pageSize: 25,
      lookbackDays: 7,
      now: NOW,
    })
    expect(whole.truncated).toBe(false)
  })

  it('surfaces a rejected range as a HealthApiError naming the data type', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Range too large.' } }), { status: 400 }),
    )
    const err = await fetchDailyRollup(FLOORS, {
      accessToken: 't',
      pageSize: 25,
      lookbackDays: 7,
      now: NOW,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(HealthApiError)
    expect((err as HealthApiError).status).toBe(400)
    expect((err as HealthApiError).message).toContain('floors')
  })

  it('wraps a network failure as a HealthApiError with status 0', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const err = await fetchDailyRollup(FLOORS, {
      accessToken: 't',
      pageSize: 25,
      lookbackDays: 7,
      now: NOW,
    }).catch((e: unknown) => e)
    expect((err as HealthApiError).status).toBe(0)
  })
})

describe('ROLLUP_ONLY_IDS', () => {
  it('names exactly the types whose list operation 400s', () => {
    expect([...ROLLUP_ONLY_IDS].sort()).toEqual([
      'calories-in-heart-rate-zone',
      'floors',
      'total-calories',
    ])
  })

  it('resolves every one of them in the catalog', () => {
    for (const id of ROLLUP_ONLY_IDS) {
      expect(DATA_TYPES_BY_ID.get(id), id).toBeDefined()
    }
  })
})
