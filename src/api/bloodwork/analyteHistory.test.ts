import { describe, expect, it } from 'vitest'
import {
  buildAnalyteHistory,
  formatReportDate,
  inferDecimals,
  parseAnalyteValue,
  reportDateToUtcDate,
} from './analyteHistory'
import type { BloodworkResultRow, BloodworkResultsByDate } from './types'

function row(overrides: Partial<BloodworkResultRow>): BloodworkResultRow {
  return {
    rowKey: 'chol',
    analyse: 'chol',
    bezeichnung: 'Cholesterin',
    ergebniswert: '5,1',
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

describe('buildAnalyteHistory', () => {
  it('returns only rows for the requested analyte, oldest first', () => {
    const byDate: BloodworkResultsByDate = {
      '2026-06-15': [row({ ergebniswert: '5,1' }), row({ analyse: 'hdl', rowKey: 'hdl' })],
      '2026-01-01': [row({ ergebniswert: '5,4' })],
    }

    const history = buildAnalyteHistory(byDate, 'chol')

    expect(history.map((entry) => entry.date)).toEqual(['2026-01-01', '2026-06-15'])
    expect(history.every((entry) => entry.row.analyse === 'chol')).toBe(true)
  })

  it('returns nothing for an analyte that was never recorded', () => {
    const byDate: BloodworkResultsByDate = { '2026-01-01': [row({})] }
    expect(buildAnalyteHistory(byDate, 'unknown')).toEqual([])
  })
})

describe('parseAnalyteValue', () => {
  it('parses a German-formatted decimal', () => {
    expect(parseAnalyteValue('4,70')).toBe(4.7)
  })

  it('parses a plain integer', () => {
    expect(parseAnalyteValue('539')).toBe(539)
  })

  it('returns null for a text result', () => {
    expect(parseAnalyteValue('positive')).toBeNull()
  })

  it('returns null for an empty result', () => {
    expect(parseAnalyteValue('')).toBeNull()
    expect(parseAnalyteValue('   ')).toBeNull()
  })
})

describe('reportDateToUtcDate / formatReportDate', () => {
  it('round-trips a report date at UTC midnight', () => {
    const date = reportDateToUtcDate('2026-08-10')
    expect(date.getUTCFullYear()).toBe(2026)
    expect(date.getUTCMonth()).toBe(7)
    expect(date.getUTCDate()).toBe(10)
    expect(date.getUTCHours()).toBe(0)
  })

  it('formats without shifting a day west of UTC', () => {
    expect(formatReportDate(reportDateToUtcDate('2026-08-10'))).toContain('2026')
  })
})

describe('inferDecimals', () => {
  it('finds the highest fractional-digit count, dot or comma', () => {
    expect(inferDecimals(['4,70', '5.1', '539'])).toBe(2)
  })

  it('returns 0 when every value is a whole number', () => {
    expect(inferDecimals(['539', '540'])).toBe(0)
  })

  it('caps at 2 even when a value carries more precision', () => {
    expect(inferDecimals(['1,2345'])).toBe(2)
  })

  it('returns 0 for no values', () => {
    expect(inferDecimals([])).toBe(0)
  })
})
