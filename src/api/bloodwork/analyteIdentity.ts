import type { BloodworkResultRow } from './types'

/**
 * A case-/whitespace-insensitive key for "the same analyte" across different
 * report uploads.
 *
 * There is no stable code to key on here: `analyse` is not an internal lab
 * code, it's literally whatever text sat in the source report's own
 * "Analyse" table column for that row (see `bloodwork/Services/LayoutParser.cs`),
 * which is exactly as free-form as `bezeichnung` and can differ between
 * report formats -- two different lab providers, or the same lab a year
 * apart, can and do use different text there for the identical test.
 *
 * What *is* consistent is the text every table already renders
 * (`bezeichnung || analyse`): when two rows print the same name, they
 * should collapse into one summary row and one history, even when OCR left
 * a trailing space or a different case on one of them. Grouping by the raw
 * `analyse` field instead of this was a real bug -- it let a single test
 * split into two summary rows whenever two reports' "Analyse" cells didn't
 * match byte-for-byte, despite both displaying identically.
 *
 * Genuine label variants between report formats -- `"AP"` vs
 * `"Alk. Phosphatase"`, an OCR-mangled `"Hamstoff"` vs `"Harnstoff"` -- are
 * different strings even after normalizing, so they fall through to
 * `ANALYTE_ALIASES` below: a short, hand-curated list, checked only after an
 * exact match fails. Guessing these algorithmically (fuzzy matching,
 * anything smarter) risks silently merging two unrelated analytes' history,
 * which is worse than leaving them split -- so only add an entry here once
 * you've confirmed both sides really are the same test.
 */

/**
 * Known same-test label variants, confirmed by hand from real duplicate
 * rows across different report formats (see PR #75). Keys and values are
 * already normalized -- trimmed, whitespace-collapsed, lowercased -- since
 * they're matched after `analyteIdentity` normalizes its input the same way.
 */
const ANALYTE_ALIASES: Record<string, string> = {
  // Abbreviation vs. full name, seen across different report formats.
  'ap': 'alk. phosphatase',
  'eosinoph. absolut': 'eosinophile absolut',
  'lymphozyt absolut': 'lymphozyten absolut',
  'neutroph. absolut': 'neutrophile seg. absolut',
  // Word order.
  'ges. bilirubin': 'bilirubin gesamt',
  // OCR dropped the "r".
  'hamstoff': 'harnstoff',
}

export function analyteIdentity(row: BloodworkResultRow): string {
  const normalized = (row.bezeichnung || row.analyse).trim().replace(/\s+/g, ' ').toLowerCase()
  return ANALYTE_ALIASES[normalized] ?? normalized
}
