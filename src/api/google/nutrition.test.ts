import { describe, expect, it } from 'vitest'
import { normalizeDataPoint } from './normalize'
import {
  MACROS,
  hasMacros,
  humanizeMealType,
  macroKcal,
  macroShares,
  nutritionDays,
  nutritionTotals,
  parseNutritionRecord,
} from './nutrition'
import type { DataTypeDef, HealthRecord, RawDataPoint } from './types'

const NUTRITION_LOG: DataTypeDef = {
  id: 'nutrition-log',
  label: 'Nutrition log',
  category: 'Nutrition',
  recordType: 'session',
  scope: 'nutrition.readonly',
}

/**
 * Shaped after the `NutritionLog` message in the REST reference: carbs and fat
 * are top-level WeightQuantities, protein is only ever an entry in `nutrients`,
 * and energy is an EnergyQuantity in kcal.
 */
function point(nutritionLog: Record<string, unknown>, name = 'n1'): RawDataPoint {
  return { name, dataSource: { platform: 'FITBIT' }, nutritionLog }
}

function record(raw: RawDataPoint): HealthRecord {
  return normalizeDataPoint(raw, NUTRITION_LOG, 0)
}

function meal(
  startTime: string,
  { carbs = 0, fat = 0, protein = 0, kcal = 0 }: Record<string, number> = {},
  name = 'n1',
): RawDataPoint {
  return point(
    {
      interval: { startTime, startUtcOffset: '7200s', endTime: startTime, endUtcOffset: '7200s' },
      foodDisplayName: 'Porridge',
      mealType: 'BREAKFAST',
      totalCarbohydrate: { grams: carbs, userProvidedUnit: 'GRAM' },
      totalFat: { grams: fat, userProvidedUnit: 'GRAM' },
      nutrients: [
        { nutrient: 'PROTEIN', quantity: { grams: protein } },
        { nutrient: 'SODIUM', quantity: { grams: 0.4 } },
      ],
      energy: { kcal, userProvidedUnit: 'KILOCALORIE' },
    },
    name,
  )
}

describe('parseNutritionRecord', () => {
  const entry = parseNutritionRecord(
    record(meal('2026-08-17T07:30:00Z', { carbs: 60, fat: 12, protein: 20, kcal: 428 })),
  )

  it('reads carbs and fat from their total fields', () => {
    expect(entry.grams.carbs).toBe(60)
    expect(entry.grams.fat).toBe(12)
  })

  /**
   * The reason this module exists. Protein has no total field -- it is only an
   * entry in `nutrients[]`, which `flatten()` renders as "2 entries", so the
   * generic path cannot reach it however many `summaryKeys` are added.
   */
  it('digs protein out of the nutrients array', () => {
    expect(entry.grams.protein).toBe(20)
  })

  it('keeps the logged energy as sent', () => {
    expect(entry.loggedKcal).toBe(428)
  })

  it('reads the name, meal type and recording offset', () => {
    expect(entry.name).toBe('Porridge')
    expect(entry.mealType).toBe('BREAKFAST')
    expect(entry.utcOffsetSeconds).toBe(7200)
  })

  it('falls back to carbohydrates in the nutrients array when there is no total', () => {
    const odd = point({
      interval: { startTime: '2026-08-17T07:30:00Z' },
      nutrients: [{ nutrient: 'CARBOHYDRATES', quantity: { grams: 45 } }],
    })
    expect(parseNutritionRecord(record(odd)).grams.carbs).toBe(45)
  })

  // A silent zero would read as "you ate no protein" rather than as a parse miss.
  it('matches the nutrient enum case-insensitively', () => {
    const lower = point({
      interval: { startTime: '2026-08-17T07:30:00Z' },
      nutrients: [{ nutrient: 'protein', quantity: { grams: 31 } }],
    })
    expect(parseNutritionRecord(record(lower)).grams.protein).toBe(31)
  })

  it('treats an unspecified meal type as no meal type', () => {
    const anon = point({
      interval: { startTime: '2026-08-17T07:30:00Z' },
      mealType: 'MEAL_TYPE_UNSPECIFIED',
    })
    expect(parseNutritionRecord(record(anon)).mealType).toBeNull()
  })

  it('survives a payload with no macros at all', () => {
    const bare = point({ interval: { startTime: '2026-08-17T07:30:00Z' } })
    const parsed = parseNutritionRecord(record(bare))
    expect(parsed.grams).toEqual({ carbs: 0, fat: 0, protein: 0 })
    expect(parsed.loggedKcal).toBeNull()
    expect(parsed.name).toBe('Logged food')
  })

  // Fat has no total in the nutrient enum -- it is broken into saturated, trans
  // and unsaturated. Summing those would under-count whatever was not broken out.
  it('never assembles fat from the sub-fat nutrients', () => {
    const subFats = point({
      interval: { startTime: '2026-08-17T07:30:00Z' },
      nutrients: [
        { nutrient: 'SATURATED_FAT', quantity: { grams: 4 } },
        { nutrient: 'TRANS_FAT', quantity: { grams: 1 } },
      ],
    })
    expect(parseNutritionRecord(record(subFats)).grams.fat).toBe(0)
  })
})

describe('nutritionDays', () => {
  const days = nutritionDays([
    record(meal('2026-08-17T07:30:00Z', { carbs: 60, fat: 12, protein: 20, kcal: 428 }, 'a')),
    record(meal('2026-08-17T12:00:00Z', { carbs: 40, fat: 8, protein: 30, kcal: 352 }, 'b')),
    record(meal('2026-08-16T12:00:00Z', { carbs: 10, fat: 2, protein: 5, kcal: 78 }, 'c')),
  ])

  it('sums the macros within a day', () => {
    expect(days[0].grams).toEqual({ carbs: 100, fat: 20, protein: 50 })
  })

  it('derives per-macro energy at 4/4/9', () => {
    expect(days[0].kcal).toEqual({ carbs: 400, fat: 180, protein: 200 })
    expect(days[0].derivedKcal).toBe(780)
  })

  // The logged figure is the source of truth and is kept separately -- 4/4/9
  // ignores alcohol and fibre, so the two legitimately disagree.
  it('keeps logged energy apart from derived energy', () => {
    expect(days[0].loggedKcal).toBe(780)
    expect(days[1].loggedKcal).toBe(78)
  })

  it('sorts days newest-first and orders entries within a day', () => {
    expect(days.map((day) => day.dateKey)).toEqual(['2026-08-17', '2026-08-16'])
    expect(days[0].entries.map((entry) => entry.key)).toEqual(['a', 'b'])
  })

  /**
   * Keyed through the recording offset, not the viewer's zone. A 00:30 snack at
   * +02:00 is `22:30Z` the day before -- keyed in UTC it lands on the wrong day
   * and nothing about the result looks wrong.
   */
  it('keys the day in the recording zone', () => {
    const lateSnack = point(
      {
        interval: { startTime: '2026-08-17T22:30:00Z', startUtcOffset: '7200s' },
        totalCarbohydrate: { grams: 5 },
      },
      'late',
    )
    expect(nutritionDays([record(lateSnack)])[0].dateKey).toBe('2026-08-18')
  })

  // A log with no interval cannot be attributed to a date, and inventing one
  // would put food on a day it was not eaten.
  it('drops entries with no timestamp rather than inventing a day', () => {
    const undated = point({ totalCarbohydrate: { grams: 5 } }, 'undated')
    expect(nutritionDays([record(undated)])).toEqual([])
  })

  it('ignores records that are not nutrition logs', () => {
    const steps = normalizeDataPoint({ name: 's', steps: { steps: 900 } }, {
      ...NUTRITION_LOG,
      id: 'steps',
    }, 0)
    expect(nutritionDays([steps])).toEqual([])
  })

  it('reports null logged energy when no food carried one', () => {
    const noEnergy = point(
      { interval: { startTime: '2026-08-17T07:30:00Z' }, totalCarbohydrate: { grams: 5 } },
      'x',
    )
    expect(nutritionDays([record(noEnergy)])[0].loggedKcal).toBeNull()
  })
})

describe('macroShares', () => {
  /**
   * Shares are of *energy*, not weight. 100 g carbs and 20 g fat is 83 % carbs
   * by weight but 69 % by energy -- drawing the gram split would render a
   * high-fat day as a low-fat one.
   */
  it('splits by energy, not by grams', () => {
    const shares = macroShares(macroKcal({ carbs: 100, fat: 20, protein: 0 }))
    expect(shares.carbs).toBeCloseTo(400 / 580, 5)
    expect(shares.fat).toBeCloseTo(180 / 580, 5)
  })

  it('sums to 1', () => {
    const shares = macroShares(macroKcal({ carbs: 100, fat: 20, protein: 50 }))
    expect(MACROS.reduce((sum, macro) => sum + shares[macro.id], 0)).toBeCloseTo(1, 10)
  })

  // Guards the pie against dividing by zero on an energy-only day.
  it('is all zero when there is nothing to divide', () => {
    expect(macroShares({ carbs: 0, fat: 0, protein: 0 })).toEqual({
      carbs: 0,
      fat: 0,
      protein: 0,
    })
  })
})

describe('nutritionTotals', () => {
  const days = nutritionDays([
    record(meal('2026-08-17T07:30:00Z', { carbs: 60, fat: 12, protein: 20, kcal: 400 }, 'a')),
    record(meal('2026-08-16T12:00:00Z', { carbs: 40, fat: 8, protein: 30, kcal: 200 }, 'c')),
  ])

  it('counts days and entries, and averages grams per day', () => {
    const totals = nutritionTotals(days)
    expect(totals.days).toBe(2)
    expect(totals.entries).toBe(2)
    expect(totals.averageGramsPerDay).toEqual({ carbs: 50, fat: 10, protein: 25 })
  })

  it('averages over logged days only', () => {
    expect(nutritionTotals(days).averageKcalPerDay).toBe(300)
  })

  it('handles an empty list', () => {
    expect(nutritionTotals([])).toEqual({
      days: 0,
      entries: 0,
      averageKcalPerDay: null,
      averageGramsPerDay: { carbs: 0, fat: 0, protein: 0 },
    })
  })
})

describe('hasMacros', () => {
  it('is false for a day logged with energy but no breakdown', () => {
    const energyOnly = point(
      { interval: { startTime: '2026-08-17T07:30:00Z' }, energy: { kcal: 500 } },
      'e',
    )
    expect(hasMacros(nutritionDays([record(energyOnly)])[0])).toBe(false)
  })

  it('is true as soon as one macro has grams', () => {
    const some = point(
      { interval: { startTime: '2026-08-17T07:30:00Z' }, totalFat: { grams: 3 } },
      'f',
    )
    expect(hasMacros(nutritionDays([record(some)])[0])).toBe(true)
  })
})

describe('humanizeMealType', () => {
  it('turns the enum into a sentence', () => {
    expect(humanizeMealType('BREAKFAST')).toBe('Breakfast')
    expect(humanizeMealType('BEFORE_LUNCH')).toBe('Before lunch')
  })
})

/**
 * One nutrition row is one logged food, not one day, so a modest row budget runs
 * out inside a day or two. Results arrive newest-first, which means the fetch
 * stops part-way through the *oldest* day it reached — and that day's pie and
 * totals understate it with nothing on screen saying so.
 */
describe('nutritionDays, partial boundary day', () => {
  const records = [
    record(meal('2026-08-17T07:30:00Z', { carbs: 60, fat: 12, protein: 20, kcal: 400 }, 'a')),
    record(meal('2026-08-16T12:00:00Z', { carbs: 40, fat: 8, protein: 30, kcal: 200 }, 'b')),
    record(meal('2026-08-15T12:00:00Z', { carbs: 10, fat: 2, protein: 5, kcal: 100 }, 'c')),
  ]

  it('marks only the oldest day when the row budget ran out', () => {
    const days = nutritionDays(records, { truncated: true })
    expect(days.map((day) => day.partial)).toEqual([false, false, true])
  })

  it('marks nothing when the data ran out on its own', () => {
    const days = nutritionDays(records, { truncated: false })
    expect(days.every((day) => !day.partial)).toBe(true)
  })

  it('defaults to marking nothing, so a caller that does not know cannot cry wolf', () => {
    expect(nutritionDays(records).every((day) => !day.partial)).toBe(true)
  })

  it('marks the only day when a single day was cut', () => {
    const one = [record(meal('2026-08-17T07:30:00Z', { carbs: 60 }, 'a'))]
    expect(nutritionDays(one, { truncated: true })[0].partial).toBe(true)
  })

  it('survives truncation with nothing to mark', () => {
    expect(nutritionDays([], { truncated: true })).toEqual([])
  })

  // A half-day would drag the mean down by however much was cut off, and an
  // average is the one figure here that cannot show its own uncertainty.
  it('keeps partial days out of the totals and the average', () => {
    const totals = nutritionTotals(nutritionDays(records, { truncated: true }))
    expect(totals.days).toBe(2)
    expect(totals.entries).toBe(2)
    expect(totals.averageGramsPerDay).toEqual({ carbs: 50, fat: 10, protein: 25 })
    expect(totals.averageKcalPerDay).toBe(300)
  })

  it('counts every day when none was cut', () => {
    const totals = nutritionTotals(nutritionDays(records, { truncated: false }))
    expect(totals.days).toBe(3)
    expect(totals.averageKcalPerDay).toBeCloseTo(700 / 3, 6)
  })

  // The day itself still renders — it is incomplete, not wrong.
  it('leaves the partial day figures themselves intact', () => {
    const oldest = nutritionDays(records, { truncated: true })[2]
    expect(oldest.grams).toEqual({ carbs: 10, fat: 2, protein: 5 })
    expect(oldest.loggedKcal).toBe(100)
  })
})
