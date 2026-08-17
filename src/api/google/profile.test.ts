import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HealthApiError } from './healthApi'
import {
  PROFILE_ENDPOINT,
  fetchHealthProfile,
  formatCivilDate,
  formatStrideLength,
  isProfileEmpty,
  parseHealthProfile,
} from './profile'

/** Shaped after the Profile resource in the REST reference. */
const PROFILE = {
  name: 'users/1234567890/profile',
  age: 41,
  membershipStartDate: { year: 2019, month: 3, day: 14 },
  userConfiguredWalkingStrideLengthMm: 720,
  userConfiguredRunningStrideLengthMm: 1180,
  autoWalkingStrideLengthMm: 748,
  autoRunningStrideLengthMm: 1224,
}

describe('parseHealthProfile', () => {
  const profile = parseHealthProfile(PROFILE)

  it('reads the age and join date', () => {
    expect(profile.ageYears).toBe(41)
    expect(profile.memberSince).toEqual({ year: 2019, month: 3, day: 14 })
  })

  // Two different claims -- what the user typed vs what the watch measured -- so
  // both are kept rather than collapsed to whichever turned up.
  it('keeps the configured and auto stride lengths apart', () => {
    expect(profile.walking).toEqual({ configuredMm: 720, autoMm: 748 })
    expect(profile.running).toEqual({ configuredMm: 1180, autoMm: 1224 })
  })

  // int64 fields elsewhere in this API arrive as strings, so both are accepted.
  it('accepts numbers that arrive as strings', () => {
    const parsed = parseHealthProfile({ age: '41', autoWalkingStrideLengthMm: '748' })
    expect(parsed.ageYears).toBe(41)
    expect(parsed.walking.autoMm).toBe(748)
  })

  /**
   * The stride fields need an activity_and_fitness scope on top of
   * profile.readonly. A token without one gets a profile with them missing, not
   * a 403 -- so absence has to parse, not throw.
   */
  it('reports missing stride lengths as null rather than failing', () => {
    const parsed = parseHealthProfile({ age: 41 })
    expect(parsed.walking).toEqual({ configuredMm: null, autoMm: null })
    expect(parsed.running).toEqual({ configuredMm: null, autoMm: null })
  })

  it('survives an empty or junk body', () => {
    expect(isProfileEmpty(parseHealthProfile({}))).toBe(true)
    expect(isProfileEmpty(parseHealthProfile(null))).toBe(true)
    expect(isProfileEmpty(parseHealthProfile('nonsense'))).toBe(true)
  })

  it('is not empty when a single field came back', () => {
    expect(isProfileEmpty(parseHealthProfile({ age: 41 }))).toBe(false)
  })

  // google.type.Date allows partial dates. A year with no month is not a day, and
  // guessing January 1st would invent a membership date.
  it('rejects a partial or impossible civil date', () => {
    expect(parseHealthProfile({ membershipStartDate: { year: 2019 } }).memberSince).toBeNull()
    expect(
      parseHealthProfile({ membershipStartDate: { year: 2019, month: 0, day: 0 } }).memberSince,
    ).toBeNull()
    expect(
      parseHealthProfile({ membershipStartDate: { year: 2019, month: 13, day: 1 } }).memberSince,
    ).toBeNull()
  })

  it('keeps the raw body for the JSON view', () => {
    expect(profile.raw).toBe(PROFILE)
  })
})

/**
 * The reason this is pinned: a civil date has no zone, so building it with
 * `new Date(2019, 2, 14)` and formatting in the viewer's zone renders the 13th
 * anywhere west of UTC. Formatting a UTC-built instant with `timeZone: 'UTC'`
 * gives the same day everywhere -- and this assertion holds under `TZ` of any
 * value, which is what makes it worth having.
 */
describe('formatCivilDate', () => {
  it('renders the calendar date the API sent, in any viewer zone', () => {
    const formatted = formatCivilDate({ year: 2019, month: 3, day: 14 })
    expect(formatted).toContain('2019')
    expect(formatted).toContain('14')
    expect(formatted).not.toContain('13')
  })
})

describe('formatStrideLength', () => {
  it('renders millimetres as whole centimetres', () => {
    expect(formatStrideLength(748)).toBe('75 cm')
    expect(formatStrideLength(1224)).toBe('122 cm')
  })
})

describe('fetchHealthProfile', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('gets users/me/profile with a bearer token', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(PROFILE), { status: 200 }))
    const profile = await fetchHealthProfile('tok-123')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(PROFILE_ENDPOINT)
    expect(url).toContain('/users/me/profile')
    expect(init.headers.Authorization).toBe('Bearer tok-123')
    expect(profile.ageYears).toBe(41)
  })

  // The scope is enabled per OAuth client, so a 403 is the expected shape of
  // "never consented to" -- the message has to name the scope, or the failure
  // reads as the endpoint being broken.
  it('names the missing scope on a 403', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Request had insufficient scopes.' } }), {
        status: 403,
      }),
    )
    await expect(fetchHealthProfile('tok')).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('googlehealth.profile.readonly'),
    })
  })

  it('wraps a network failure as a HealthApiError with status 0', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const err = await fetchHealthProfile('tok').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HealthApiError)
    expect((err as HealthApiError).status).toBe(0)
  })
})
