import { describe, expect, it } from 'vitest'
import { analyteIdentity } from './analyteIdentity'
import type { BloodworkResultRow } from './types'

function row(overrides: Partial<BloodworkResultRow>): BloodworkResultRow {
  return {
    rowKey: 'x',
    analyse: 'x',
    bezeichnung: '',
    ergebniswert: '1',
    flag: '',
    einheit: '',
    ergebnistext: '',
    normbereich: '',
    sourceDocumentId: 'doc-1',
    corrected: false,
    correctedAt: null,
    ...overrides,
  }
}

describe('analyteIdentity', () => {
  it('prefers bezeichnung over analyse', () => {
    expect(analyteIdentity(row({ analyse: 'chol', bezeichnung: 'Cholesterin' }))).toBe('cholesterin')
  })

  it('falls back to analyse when bezeichnung is blank', () => {
    expect(analyteIdentity(row({ analyse: 'AP', bezeichnung: '' }))).toBe('ap')
  })

  it('is case-insensitive', () => {
    expect(analyteIdentity(row({ bezeichnung: 'CHOLESTERIN' }))).toBe(
      analyteIdentity(row({ bezeichnung: 'cholesterin' })),
    )
  })

  it('collapses surrounding and internal whitespace', () => {
    expect(analyteIdentity(row({ bezeichnung: '  Free  Testosterone ' }))).toBe('free testosterone')
  })

  it('is unaffected by the raw analyse field differing when bezeichnung is present', () => {
    expect(analyteIdentity(row({ analyse: 'CHOL', bezeichnung: 'Cholesterin' }))).toBe(
      analyteIdentity(row({ analyse: 'cholesterin-total', bezeichnung: 'Cholesterin' })),
    )
  })

  it('treats genuinely different labels as different identities', () => {
    expect(analyteIdentity(row({ bezeichnung: 'AP' }))).not.toBe(
      analyteIdentity(row({ bezeichnung: 'Alk. Phosphatase' })),
    )
  })
})
