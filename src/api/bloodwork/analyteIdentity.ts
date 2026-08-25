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
 * This does NOT catch genuine label variants between report formats
 * (`"AP"` vs `"Alk. Phosphatase"`, `"Harnstoff"` vs an OCR-mangled
 * `"Hamstoff"`) -- those really are different strings, and guessing they're
 * the same test without a curated alias list risks silently merging two
 * unrelated analytes' histories, which is worse than leaving them split.
 */
export function analyteIdentity(row: BloodworkResultRow): string {
  return (row.bezeichnung || row.analyse).trim().replace(/\s+/g, ' ').toLowerCase()
}
