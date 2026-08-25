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

  it('merges two reports whose raw analyse codes differ but display the same name', () => {
    // The real bug this guards: different lab report formats put different
    // text in the source "Analyse" column for what is otherwise plainly the
    // same test, and grouping by that raw field used to split them.
    const byDate: BloodworkResultsByDate = {
      '2024-11-21': [row({ analyse: 'CHOL', bezeichnung: 'Cholesterin', ergebniswert: '153' })],
      '2026-05-18': [row({ analyse: 'cholesterin-total', bezeichnung: 'Cholesterin', ergebniswert: '146' })],
    }

    const rows = buildSummaryRows(byDate)

    expect(rows).toHaveLength(1)
    expect(rows[0].lastTested).toBe('2026-05-18')
    expect(rows[0].row.ergebniswert).toBe('146')
  })

  it('merges across OCR whitespace/case noise in the displayed name', () => {
    const byDate: BloodworkResultsByDate = {
      '2024-11-21': [row({ bezeichnung: 'Cholesterin' })],
      '2026-05-18': [row({ bezeichnung: '  cholesterin ' })],
    }

    expect(buildSummaryRows(byDate)).toHaveLength(1)
  })

  it('keeps genuinely different display names as separate rows, even when they are the same test', () => {
    // "AP" vs "Alk. Phosphatase" are the same test in different report
    // formats -- there's no way to know that without a curated alias list,
    // so this correctly leaves them split rather than guessing.
    const byDate: BloodworkResultsByDate = {
      '2024-11-21': [row({ analyse: 'AP', bezeichnung: '' })],
      '2026-08-10': [row({ analyse: 'AP2', bezeichnung: 'Alk. Phosphatase' })],
    }

    expect(buildSummaryRows(byDate)).toHaveLength(2)
  })

  it('keeps distinct analytes as separate rows, sorted by label', () => {
    const byDate: BloodworkResultsByDate = {
      '2026-06-15': [
        row({ analyse: 'hdl', bezeichnung: 'HDL-Cholesterin', rowKey: 'hdl' }),
        row({ analyse: 'chol', bezeichnung: 'Cholesterin', rowKey: 'chol' }),
      ],
    }

    const rows = buildSummaryRows(byDate)

    expect(rows.map((r) => r.label)).toEqual(['Cholesterin', 'HDL-Cholesterin'])
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
