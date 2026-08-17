import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  exerciseDataPointId,
  exerciseTcxUrl,
  fetchExerciseTcx,
  tcxFileName,
} from './exerciseTcx'
import { HealthApiError } from './healthApi'

describe('exerciseDataPointId', () => {
  it('takes the last segment of the resource name', () => {
    expect(exerciseDataPointId('users/1234/dataTypes/exercise/dataPoints/2026443605080188808')).toBe(
      '2026443605080188808',
    )
    expect(exerciseDataPointId('users/me/dataTypes/exercise/dataPoints/42')).toBe('42')
  })

  // A synthesised key has no server-side id behind it, so exporting would 404 on
  // a button that looked like it should work.
  it('returns null when there is no name to read', () => {
    expect(exerciseDataPointId(undefined)).toBeNull()
    expect(exerciseDataPointId('')).toBeNull()
    expect(exerciseDataPointId('exercise:0')).toBeNull()
    expect(exerciseDataPointId('users/me/dataTypes/exercise/dataPoints/')).toBeNull()
    expect(exerciseDataPointId(42)).toBeNull()
  })
})

describe('exerciseTcxUrl', () => {
  // Without alt=media the method returns JSON wrapping the file, which for a
  // proto bytes field means base64 to undo. This is the whole contract.
  it('always asks for the media download', () => {
    expect(exerciseTcxUrl('987')).toContain('alt=media')
  })

  // `:exportExerciseTcx` is gRPC-transcoding syntax: an encoded colon is a
  // different URL and 404s.
  it('leaves the custom-method colon un-escaped', () => {
    expect(exerciseTcxUrl('987')).toContain('/dataPoints/987:exportExerciseTcx?')
    expect(exerciseTcxUrl('987')).not.toContain('%3A')
  })

  it('addresses the caller as users/me', () => {
    expect(exerciseTcxUrl('987')).toContain('/users/me/dataTypes/exercise/dataPoints/')
  })

  it('omits partialData unless asked, since the API defaults it to false', () => {
    expect(exerciseTcxUrl('987')).not.toContain('partialData')
    expect(exerciseTcxUrl('987', { partialData: true })).toContain('partialData=true')
  })
})

describe('tcxFileName', () => {
  it('slugifies the title and dates it', () => {
    const start = new Date('2026-08-17T06:00:00Z')
    expect(tcxFileName('Morning Trail Run', start, 7200)).toBe('2026-08-17-morning-trail-run.tcx')
  })

  /**
   * Dated through the recording offset, not the viewer's zone. A 00:30 ride at
   * +02:00 is `22:30Z` the previous day -- the instant falls on the 17th, the
   * rider started on the 18th, and the file has to say what the rider would say.
   */
  it('dates the file in the recording zone, not UTC', () => {
    const lateRide = new Date('2026-08-17T22:30:00Z')
    expect(tcxFileName('Ride', lateRide, 7200)).toBe('2026-08-18-ride.tcx')
    expect(tcxFileName('Ride', lateRide, 0)).toBe('2026-08-17-ride.tcx')
  })

  it('drops the date when the session has no start', () => {
    expect(tcxFileName('Ride', null, 0)).toBe('ride.tcx')
  })

  it('survives a title with nothing filename-safe in it', () => {
    expect(tcxFileName('///', null, 0)).toBe('workout.tcx')
    expect(tcxFileName('Wörkout (5 km!)', null, 0)).toBe('w-rkout-5-km.tcx')
  })
})

describe('fetchExerciseTcx', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('returns the TCX as text', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<TrainingCenterDatabase/>', { status: 200 }))
    await expect(fetchExerciseTcx('987', 'tok-123')).resolves.toBe('<TrainingCenterDatabase/>')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-123')
  })

  /**
   * The reference lists the scopes as "one of" and then contradicts itself in a
   * note: this call needs an activity_and_fitness scope *and* a location one. A
   * 403 that did not say so would read as "this workout has no route".
   */
  it('says both scopes are needed on a 403', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    const err = await fetchExerciseTcx('987', 'tok').catch((e: unknown) => e)
    expect((err as HealthApiError).status).toBe(403)
    expect((err as HealthApiError).message).toContain('location.readonly')
    expect((err as HealthApiError).message).toContain('activity_and_fitness')
  })

  it('reports a 404 as a missing route rather than a fault', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }))
    await expect(fetchExerciseTcx('987', 'tok')).rejects.toThrow(/no route stored/i)
  })

  it('wraps a network failure as a HealthApiError with status 0', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const err = await fetchExerciseTcx('987', 'tok').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HealthApiError)
    expect((err as HealthApiError).status).toBe(0)
  })
})
