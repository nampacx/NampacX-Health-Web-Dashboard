import { describe, expect, it } from 'vitest'
import { buildSummaryRows } from './summary'
import type { BloodworkResultRow, BloodworkResultsByDate } from './types'

function row(overrides: Partial<BloodworkResultRow>): BloodworkResultRow {
  return {
    rowKey: 'chol',
    analyse: 'chol',
    bezeichnung: 'Cholesterin',
    ergebniswert: '5.1',
    flag: '',
    einheit: 'mmol/l',
    ergebnistext: '',
    normbereich: '< 5.2',
    sourceDocumentId: 'doc-1',
    corrected: false,
    correctedAt: null,
    ...overrides,
  }
}

describe('buildSummaryRows', () => {
  it('keeps only the most recent row per analyte', () => {
    const byDate: BloodworkResultsByDate = {
      '2026-01-01': [row({ ergebniswert: '5.4' })],
      '2026-06-15': [row({ ergebniswert: '5.1' })],
    }

    const rows = buildSummaryRows(byDate)

    expect(rows).toHaveLength(1)
    expect(rows[0].lastTested).toBe('2026-06-15')
    expect(rows[0].row.ergebniswert).toBe('5.1')
  })

  it('groups by analyse, not bezeichnung, since the lab label can vary between reports', () => {
    const byDate: BloodworkResultsByDate = {
      '2026-01-01': [row({ bezeichnung: 'Chol.' })],
      '2026-06-15': [row({ bezeichnung: 'Cholesterin' })],
    }

    const rows = buildSummaryRows(byDate)

    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe('Cholesterin')
  })

  it('keeps distinct analytes as separate rows, sorted by label', () => {
    const byDate: BloodworkResultsByDate = {
      '2026-06-15': [
        row({ analyse: 'hdl', bezeichnung: 'HDL-Cholesterin', rowKey: 'hdl' }),
        row({ analyse: 'chol', bezeichnung: 'Cholesterin', rowKey: 'chol' }),
      ],
    }

    const rows = buildSummaryRows(byDate)

    expect(rows.map((r) => r.analyse)).toEqual(['chol', 'hdl'])
  })

  it('falls back to analyse for the label when bezeichnung is blank', () => {
    const byDate: BloodworkResultsByDate = {
      '2026-06-15': [row({ bezeichnung: '', analyse: 'crp' })],
    }

    const rows = buildSummaryRows(byDate)

    expect(rows[0].label).toBe('crp')
  })

  it('returns nothing for no results', () => {
    expect(buildSummaryRows({})).toEqual([])
  })
})
