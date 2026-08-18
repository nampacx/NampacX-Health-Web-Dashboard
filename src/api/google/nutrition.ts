/**
 * Nutrition logs, grouped into days, for the Nutrition sub-tab.
 *
 * **A typed parser, for the same reason sleep has one.** The rule in
 * `normalize.ts` is to prefer `summaryKeys` over special-casing, and this is the
 * second place that rule has to give way: `protein` exists *only* as an entry in
 * the `nutrients[]` array, and `flatten()` renders an array of objects as
 * `"7 entries"`. No amount of `summaryKeys` can reach inside it, so the single
 * number the user actually asked for is unreachable from the generic path.
 *
 * The payload, from the `NutritionLog` message:
 *
 * ```
 * interval          SessionTimeInterval   when the food was eaten
 * totalCarbohydrate WeightQuantity        { grams }
 * totalFat          WeightQuantity        { grams }
 * nutrients[]       NutrientQuantity[]    { nutrient: 'PROTEIN', quantity: { grams } }
 * energy            EnergyQuantity        { kcal } — what was logged
 * foodDisplayName   string
 * mealType          enum
 * ```
 *
 * Three things worth knowing before changing this:
 *
 * - **Carbs and fat are top-level, protein is not.** There is no `totalProtein`,
 *   and the `Nutrient` enum has no total-fat member either — only
 *   `SATURATED_FAT`, `TRANS_FAT`, `MONOUNSATURATED_FAT` and friends. So fat comes
 *   from `totalFat` and nothing else: summing the sub-fats would silently
 *   under-count whatever the food did not break down.
 * - **Logged energy and macro-derived energy are different numbers**, and both
 *   are shown rather than reconciled. `energy.kcal` is what the food actually
 *   carries; 4/4/9 over the macros ignores alcohol and fibre and rounds, so the
 *   two disagree by a few percent on real data. Presenting the derived figure as
 *   *the* calorie count would quietly overwrite the source of truth.
 * - **Days are keyed in the recording zone**, through `startUtcOffset`, exactly
 *   as `sleep.ts` does. A 22:30 snack at +02:00 is `20:30Z`; keyed in UTC it
 *   lands on the right day here but on the previous one an hour later, and
 *   nothing about the result would look wrong.
 */

import { localDateKey, parseInterval } from './time'
import type { HealthRecord, RawDataPoint } from './types'

export type MacroId = 'carbs' | 'fat' | 'protein'

export interface MacroDef {
  id: MacroId
  label: string
  /**
   * Atwater factor: kilocalories per gram. General factors, which is what a food
   * label uses — food-specific factors exist but the API does not send them.
   */
  kcalPerGram: number
}

/** Ordered as the chart and the table render them. */
export const MACROS: MacroDef[] = [
  { id: 'carbs', label: 'Carbs', kcalPerGram: 4 },
  { id: 'fat', label: 'Fat', kcalPerGram: 9 },
  { id: 'protein', label: 'Protein', kcalPerGram: 4 },
]

export type MacroGrams = Record<MacroId, number>

/** One logged food or meal. */
export interface NutritionEntry {
  key: string
  name: string
  mealType: string | null
  /** When it was eaten, as an instant. Null when the payload carried no time. */
  at: Date | null
  utcOffsetSeconds: number
  grams: MacroGrams
  /** `energy.kcal` as logged. Null when the food carried no energy figure. */
  loggedKcal: number | null
  raw: RawDataPoint
}

export interface NutritionDay {
  /** `2026-08-17` in the recording zone — also the React key. */
  dateKey: string
  /** Midnight of that civil day, for formatting only. Read with `getUTC*`. */
  date: Date
  entries: NutritionEntry[]
  grams: MacroGrams
  /** Per-macro energy, derived at 4/4/9. */
  kcal: MacroGrams
  /** Sum of `kcal` — what the table's calorie column adds up to. */
  derivedKcal: number
  /** Sum of `energy.kcal`. Null when no entry that day reported energy. */
  loggedKcal: number | null
  /**
   * The row budget cut this day off part-way, so its totals understate what was
   * eaten. Only ever the oldest day on screen: the API returns newest-first, so
   * a fetch that stops early stops in the middle of the earliest day it reached.
   * Rendering it as a normal day would show a wrong pie with no hint it is wrong.
   */
  partial: boolean
}

export interface NutritionDaysOptions {
  /**
   * The fetch hit its row limit with more data available — `FetchOutcome.truncated`
   * for `nutrition-log`. One nutrition row is one logged food, not one day, so
   * this is routine rather than exceptional: a handful of items per day exhausts
   * a small row budget within a day or two.
   */
  truncated?: boolean
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Numbers may arrive as int64 strings, the same latitude `normalize.ts` takes. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value)
  return null
}

/** A `WeightQuantity`/`EnergyQuantity` reduced to its one meaningful number. */
function quantity(value: unknown, unitKey: 'grams' | 'kcal'): number | null {
  if (!isObject(value)) return null
  return asNumber(value[unitKey])
}

const EMPTY_GRAMS: MacroGrams = { carbs: 0, fat: 0, protein: 0 }

/**
 * Grams of one nutrient from the `nutrients[]` array.
 *
 * Matched case-insensitively on the enum name so a payload that ever switches to
 * a different casing keeps working — the alternative is a silent zero, which
 * reads as "you ate no protein" rather than as a parsing failure.
 */
function nutrientGrams(payload: Json, nutrient: string): number | null {
  const nutrients = payload.nutrients
  if (!Array.isArray(nutrients)) return null

  for (const item of nutrients) {
    if (!isObject(item)) continue
    if (String(item.nutrient ?? '').toUpperCase() !== nutrient) continue
    const grams = quantity(item.quantity, 'grams')
    if (grams !== null) return grams
  }
  return null
}

/** The payload object, with the same envelope fallback the other parsers use. */
function extractPayload(raw: RawDataPoint): Json {
  if (isObject(raw.nutritionLog)) return raw.nutritionLog
  const found = Object.entries(raw).find(
    ([key, value]) => key !== 'name' && key !== 'dataSource' && isObject(value),
  )
  return found ? (found[1] as Json) : {}
}

/** `BEFORE_LUNCH` -> `Before lunch`. */
export function humanizeMealType(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function parseNutritionRecord(record: HealthRecord): NutritionEntry {
  const payload = extractPayload(record.raw)
  const { start, offsetSeconds } = parseInterval(payload)

  // Carbs have a total field and an enum member; fat has only the total field,
  // since the enum breaks fat down by type and never totals it.
  const carbs = quantity(payload.totalCarbohydrate, 'grams') ?? nutrientGrams(payload, 'CARBOHYDRATES')
  const fat = quantity(payload.totalFat, 'grams')
  const protein = nutrientGrams(payload, 'PROTEIN')

  const mealType =
    typeof payload.mealType === 'string' && payload.mealType !== 'MEAL_TYPE_UNSPECIFIED'
      ? payload.mealType
      : null

  const name =
    typeof payload.foodDisplayName === 'string' && payload.foodDisplayName
      ? payload.foodDisplayName
      : 'Logged food'

  return {
    key: record.key,
    name,
    mealType,
    at: start,
    utcOffsetSeconds: offsetSeconds,
    grams: { carbs: carbs ?? 0, fat: fat ?? 0, protein: protein ?? 0 },
    loggedKcal: quantity(payload.energy, 'kcal'),
    raw: record.raw,
  }
}

export function macroKcal(grams: MacroGrams): MacroGrams {
  return MACROS.reduce<MacroGrams>(
    (acc, macro) => ({ ...acc, [macro.id]: grams[macro.id] * macro.kcalPerGram }),
    { ...EMPTY_GRAMS },
  )
}

export function totalGrams(grams: MacroGrams): number {
  return MACROS.reduce((sum, macro) => sum + grams[macro.id], 0)
}

/**
 * The nutrition records, summed per civil day and sorted newest-first.
 *
 * Entries with no timestamp are dropped rather than pooled into a placeholder
 * day: a nutrition log without an interval cannot be attributed to a date, and
 * inventing one would put food on a day it was not eaten.
 */
export function nutritionDays(
  records: HealthRecord[],
  { truncated = false }: NutritionDaysOptions = {},
): NutritionDay[] {
  const byDate = new Map<string, NutritionEntry[]>()

  for (const record of records) {
    if (record.dataType.id !== 'nutrition-log') continue
    const entry = parseNutritionRecord(record)
    if (!entry.at) continue

    const dateKey = localDateKey(entry.at, entry.utcOffsetSeconds)
    const existing = byDate.get(dateKey)
    if (existing) existing.push(entry)
    else byDate.set(dateKey, [entry])
  }

  const days = Array.from(byDate, ([dateKey, entries]) => {
    const grams = entries.reduce<MacroGrams>(
      (acc, entry) => ({
        carbs: acc.carbs + entry.grams.carbs,
        fat: acc.fat + entry.grams.fat,
        protein: acc.protein + entry.grams.protein,
      }),
      { ...EMPTY_GRAMS },
    )

    const kcal = macroKcal(grams)
    const withEnergy = entries.filter((entry) => entry.loggedKcal !== null)

    return {
      dateKey,
      // Built in UTC so its getUTC* face is the civil day, the trick `time.ts`
      // and `profile.ts` both use.
      date: new Date(`${dateKey}T00:00:00Z`),
      entries: entries.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0)),
      grams,
      kcal,
      derivedKcal: totalGrams(kcal),
      loggedKcal:
        withEnergy.length > 0
          ? withEnergy.reduce((sum, entry) => sum + (entry.loggedKcal ?? 0), 0)
          : null,
      partial: false,
    }
  }).sort((a, b) => b.dateKey.localeCompare(a.dateKey))

  // Newest-first, so the truncated tail is the last element and only that one.
  const oldest = days[days.length - 1]
  if (truncated && oldest) oldest.partial = true

  return days
}

export interface NutritionTotals {
  days: number
  entries: number
  /** Mean per *logged* day, which is the only day an average can speak for. */
  averageKcalPerDay: number | null
  grams: MacroGrams
}

/**
 * Window totals, over the **complete** days only.
 *
 * A partial day would drag the average down by however much of it was cut off,
 * and an average is the one figure here that cannot show its own uncertainty.
 * The count reports what was averaged, so a dropped day is visible rather than
 * silently absorbed.
 */
export function nutritionTotals(allDays: NutritionDay[]): NutritionTotals {
  const days = allDays.filter((day) => !day.partial)
  const grams = days.reduce<MacroGrams>(
    (acc, day) => ({
      carbs: acc.carbs + day.grams.carbs,
      fat: acc.fat + day.grams.fat,
      protein: acc.protein + day.grams.protein,
    }),
    { ...EMPTY_GRAMS },
  )

  // Prefer what was logged; fall back to the derived figure so a day whose foods
  // carried macros but no energy still counts toward the average.
  const perDay = days.map((day) => day.loggedKcal ?? day.derivedKcal)

  return {
    days: days.length,
    entries: days.reduce((sum, day) => sum + day.entries.length, 0),
    averageKcalPerDay:
      perDay.length > 0 ? perDay.reduce((sum, kcal) => sum + kcal, 0) / perDay.length : null,
    grams,
  }
}

/**
 * Each macro's share of the day's derived energy, as fractions summing to 1.
 *
 * **By energy, not by weight.** A macro split means the calorie split — fat
 * carries 9 kcal/g against 4, so a gram-weighted pie would draw a high-fat day
 * as a low-fat one. The gram figures are in the table beside it.
 */
export function macroShares(kcal: MacroGrams): MacroGrams {
  const total = totalGrams(kcal)
  if (total <= 0) return { ...EMPTY_GRAMS }
  return MACROS.reduce<MacroGrams>(
    (acc, macro) => ({ ...acc, [macro.id]: kcal[macro.id] / total }),
    { ...EMPTY_GRAMS },
  )
}

/**
 * True when a day carried no macro grams at all — its foods were logged with
 * energy only, or with nothing this parser recognises. The view says so rather
 * than drawing an empty circle.
 */
export function hasMacros(day: NutritionDay): boolean {
  return totalGrams(day.grams) > 0
}
