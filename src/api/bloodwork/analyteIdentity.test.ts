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
    expect(analyteIdentity(row({ analyse: 'crp', bezeichnung: '' }))).toBe('crp')
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
    expect(analyteIdentity(row({ bezeichnung: 'Glucose' }))).not.toBe(
      analyteIdentity(row({ bezeichnung: 'Cholesterin' })),
    )
  })

  describe('curated aliases', () => {
    // Real report-format variants that don't normalize to the same string on
    // their own, confirmed by hand -- see ANALYTE_ALIASES in analyteIdentity.ts.
    it.each([
      ['AP', 'Alk. Phosphatase'],
      ['Eosinoph. absolut', 'Eosinophile absolut'],
      ['Lymphozyt absolut', 'Lymphozyten absolut'],
      ['Neutroph. absolut', 'Neutrophile seg. absolut'],
      ['ges. Bilirubin', 'Bilirubin gesamt'],
      ['Hamstoff', 'Harnstoff'],
    ])('matches %j to %j', (a, b) => {
      expect(analyteIdentity(row({ bezeichnung: a }))).toBe(analyteIdentity(row({ bezeichnung: b })))
    })

    it('is case-/whitespace-insensitive on the alias lookup too', () => {
      expect(analyteIdentity(row({ bezeichnung: '  ap  ' }))).toBe(
        analyteIdentity(row({ bezeichnung: 'Alk. Phosphatase' })),
      )
    })
  })
})
