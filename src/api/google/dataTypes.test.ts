import { describe, expect, it } from 'vitest'
import {
  DATA_TYPES,
  DATA_TYPES_BY_ID,
  DEFAULT_SELECTED_IDS,
  ENDPOINT_SCOPES,
  REQUESTED_SCOPES,
  UNREADABLE_SCOPES,
  scopeUrl,
} from './dataTypes'

describe('DATA_TYPES', () => {
  it('has no duplicate ids', () => {
    expect(new Set(DATA_TYPES.map((d) => d.id)).size).toBe(DATA_TYPES.length)
  })

  it('resolves every default selection', () => {
    for (const id of DEFAULT_SELECTED_IDS) {
      expect(DATA_TYPES_BY_ID.get(id), id).toBeDefined()
    }
  })
})

describe('REQUESTED_SCOPES', () => {
  it('covers every scope a data type needs', () => {
    for (const dataType of DATA_TYPES) {
      expect(REQUESTED_SCOPES, dataType.id).toContain(scopeUrl(dataType.scope))
    }
  })

  /**
   * These two gate endpoints rather than data types, so nothing in DATA_TYPES
   * pulls them in — they have to be named, and dropping them silently disables
   * the profile view and the route export rather than breaking a build.
   */
  it('includes the endpoint-only scopes', () => {
    for (const scope of ENDPOINT_SCOPES) {
      expect(REQUESTED_SCOPES, scope).toContain(scopeUrl(scope))
    }
    expect(REQUESTED_SCOPES).toContain(
      'https://www.googleapis.com/auth/googlehealth.location.readonly',
    )
    expect(REQUESTED_SCOPES).toContain(
      'https://www.googleapis.com/auth/googlehealth.profile.readonly',
    )
  })

  it('asks for nothing twice', () => {
    expect(new Set(REQUESTED_SCOPES).size).toBe(REQUESTED_SCOPES.length)
  })

  /**
   * The point of the list. The Cloud console offers `.readonly` variants of these
   * three, which looks like menstrual-period, ovulation-test, symptoms and moods
   * becoming readable — but `dataPoints.list` accepts a closed set of scopes that
   * excludes all three, and those four data types expose only create/update/
   * batchDelete. Requesting them would widen the consent screen, with the most
   * sensitive wording on it, and return nothing.
   */
  it('does not request the scopes that read nothing', () => {
    for (const scope of UNREADABLE_SCOPES) {
      expect(REQUESTED_SCOPES.some((requested) => requested.includes(scope))).toBe(false)
    }
  })

  it('does not carry a data type behind an unreadable scope', () => {
    const unreadable = new Set<string>(UNREADABLE_SCOPES)
    expect(DATA_TYPES.filter((d) => unreadable.has(d.scope))).toEqual([])
  })
})
