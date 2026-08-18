import type { DataTypeDef, ReadScope } from './types'

const SCOPE_PREFIX = 'https://www.googleapis.com/auth/googlehealth.'

export function scopeUrl(scope: ReadScope): string {
  return SCOPE_PREFIX + scope
}

/**
 * Read-capable data types from https://developers.google.com/health/data-types.
 * Types that only expose a `.writeonly` scope (moods, symptoms, menstrual-period,
 * ovulation-test) are intentionally omitted — they cannot be listed. See
 * `UNREADABLE_SCOPES` below, because the Cloud console makes that look untrue.
 */
export const DATA_TYPES: DataTypeDef[] = [
  // Activity & fitness
  { id: 'steps', label: 'Steps', category: 'Activity', recordType: 'interval', scope: 'activity_and_fitness.readonly', summaryKeys: ['steps', 'count', 'stepCount'] },
  { id: 'distance', label: 'Distance', category: 'Activity', recordType: 'interval', scope: 'activity_and_fitness.readonly', summaryKeys: ['distanceMillimiters', 'distanceMillimeters', 'distance'] },
  { id: 'exercise', label: 'Exercise', category: 'Activity', recordType: 'session', scope: 'activity_and_fitness.readonly', summaryKeys: ['displayName', 'exerciseType'] },
  { id: 'floors', label: 'Floors', category: 'Activity', recordType: 'interval', scope: 'activity_and_fitness.readonly', summaryKeys: ['countSum', 'floors', 'count'] },
  { id: 'active-minutes', label: 'Active minutes', category: 'Activity', recordType: 'interval', scope: 'activity_and_fitness.readonly', summaryKeys: ['activeMinutes', 'minutes', 'duration'] },
  { id: 'active-zone-minutes', label: 'Active zone minutes', category: 'Activity', recordType: 'interval', scope: 'activity_and_fitness.readonly', summaryKeys: ['activeZoneMinutes', 'totalMinutes', 'minutes'] },
  { id: 'active-energy-burned', label: 'Active energy burned', category: 'Activity', recordType: 'interval', scope: 'activity_and_fitness.readonly', summaryKeys: ['caloriesKcal', 'energyKcal', 'calories'] },
  { id: 'total-calories', label: 'Total calories', category: 'Activity', recordType: 'interval', scope: 'activity_and_fitness.readonly', summaryKeys: ['kcalSum', 'caloriesKcal', 'calories'] },
  { id: 'calories-in-heart-rate-zone', label: 'Calories in HR zone', category: 'Activity', recordType: 'interval', scope: 'activity_and_fitness.readonly', summaryKeys: ['caloriesInHeartRateZones'] },
  { id: 'time-in-heart-rate-zone', label: 'Time in HR zone', category: 'Activity', recordType: 'interval', scope: 'activity_and_fitness.readonly' },
  { id: 'activity-level', label: 'Activity level', category: 'Activity', recordType: 'interval', scope: 'activity_and_fitness.readonly' },
  { id: 'sedentary-period', label: 'Sedentary period', category: 'Activity', recordType: 'interval', scope: 'activity_and_fitness.readonly' },
  { id: 'altitude', label: 'Altitude', category: 'Activity', recordType: 'interval', scope: 'activity_and_fitness.readonly' },
  { id: 'swim-lengths-data', label: 'Swim lengths', category: 'Activity', recordType: 'interval', scope: 'activity_and_fitness.readonly' },
  { id: 'vo2-max', label: 'VO2 max', category: 'Activity', recordType: 'sample', scope: 'activity_and_fitness.readonly' },
  { id: 'daily-vo2-max', label: 'Daily VO2 max', category: 'Activity', recordType: 'daily', scope: 'activity_and_fitness.readonly' },
  { id: 'run-vo2-max', label: 'Run VO2 max', category: 'Activity', recordType: 'sample', scope: 'activity_and_fitness.readonly' },

  // Health metrics & measurements
  { id: 'heart-rate', label: 'Heart rate', category: 'Metrics', recordType: 'sample', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'daily-resting-heart-rate', label: 'Resting heart rate', category: 'Metrics', recordType: 'daily', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'heart-rate-variability', label: 'HRV', category: 'Metrics', recordType: 'sample', scope: 'health_metrics_and_measurements.readonly' },
  {
    id: 'daily-heart-rate-variability',
    label: 'Daily HRV',
    category: 'Metrics',
    recordType: 'daily',
    scope: 'health_metrics_and_measurements.readonly',
    // Carries the overnight numbers the sleep view is built on: deep-sleep
    // RMSSD and non-REM heart rate. Both are already computed over the night,
    // so no intersection with the sleep interval is needed.
    summaryKeys: [
      'deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds',
      'averageHeartRateVariabilityMilliseconds',
    ],
  },
  { id: 'daily-heart-rate-zones', label: 'Daily HR zones', category: 'Metrics', recordType: 'daily', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'weight', label: 'Weight', category: 'Metrics', recordType: 'sample', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'height', label: 'Height', category: 'Metrics', recordType: 'sample', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'body-fat', label: 'Body fat', category: 'Metrics', recordType: 'sample', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'blood-glucose', label: 'Blood glucose', category: 'Metrics', recordType: 'sample', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'oxygen-saturation', label: 'SpO2', category: 'Metrics', recordType: 'sample', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'daily-oxygen-saturation', label: 'Daily SpO2', category: 'Metrics', recordType: 'daily', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'daily-respiratory-rate', label: 'Respiratory rate', category: 'Metrics', recordType: 'daily', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'respiratory-rate-sleep-summary', label: 'Respiratory rate (sleep)', category: 'Metrics', recordType: 'sample', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'core-body-temperature', label: 'Body temperature', category: 'Metrics', recordType: 'sample', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'daily-sleep-temperature-derivations', label: 'Sleep temperature', category: 'Metrics', recordType: 'daily', scope: 'health_metrics_and_measurements.readonly' },

  // Sleep
  {
    id: 'sleep',
    label: 'Sleep',
    category: 'Sleep',
    recordType: 'session',
    scope: 'sleep.readonly',
    summaryKeys: ['durationMillis', 'durationMs', 'duration', 'timeAsleepMinutes', 'minutesAsleep', 'efficiency'],
  },

  // Nutrition
  // `recordType: 'session'` contradicts the data-type table, which files this as
  // a Sample — but the filter grammar names real proto fields, and `NutritionLog`
  // has an `interval` (a SessionTimeInterval) and no `sample_time` at all. A
  // `nutrition_log.sample_time.civil_time` filter therefore cannot resolve, and
  // the time range would silently stop applying to nutrition.
  { id: 'nutrition-log', label: 'Nutrition log', category: 'Nutrition', recordType: 'session', scope: 'nutrition.readonly' },
  { id: 'hydration-log', label: 'Hydration log', category: 'Nutrition', recordType: 'session', scope: 'nutrition.readonly' },
  { id: 'food', label: 'Food', category: 'Nutrition', recordType: 'food', scope: 'nutrition.readonly' },
  // A reference table, not an observation: the units a food can be logged in.
  // Carries no timestamp, so its rows sort to the bottom of the activity list.
  { id: 'food-measurement-unit', label: 'Food measurement units', category: 'Nutrition', recordType: 'food', scope: 'nutrition.readonly' },

  // Specialised
  { id: 'electrocardiogram', label: 'ECG', category: 'Specialised', recordType: 'session', scope: 'ecg.readonly' },
  { id: 'irregular-rhythm-notification', label: 'Irregular rhythm', category: 'Specialised', recordType: 'session', scope: 'irn.readonly' },
]

export const DATA_TYPES_BY_ID = new Map(DATA_TYPES.map((d) => [d.id, d]))

/**
 * Data types that **cannot be listed**. `dataPoints.list` answers these with a
 * 400 spelling out which operations they do support — `floors` allows
 * `reconcile`, `rollup` and `dailyRollUp`, the other two only the latter pair.
 *
 * They stay in the catalog, and two of them stay in `DEFAULT_SELECTED_IDS`,
 * because the data is perfectly readable — just through `dataPoints:dailyRollUp`
 * instead. `fetchLatestRecords` routes on this set; see `rollup.ts`.
 */
export const ROLLUP_ONLY_IDS = new Set(['floors', 'total-calories', 'calories-in-heart-rate-zone'])

/** The categories the dashboard is built around. */
export const FOCUS_CATEGORIES = ['Activity', 'Sleep']

/** Ordered so the focus categories come first in the picker. */
export const CATEGORY_ORDER = [...FOCUS_CATEGORIES, 'Metrics', 'Nutrition', 'Specialised']

/**
 * The overnight cardio types the sleep view reads. They sit in Metrics rather
 * than Sleep — Google files them as daily health metrics — so the sleep view
 * has to name them explicitly instead of taking the Sleep category.
 */
export const SLEEP_METRIC_IDS = [
  'daily-heart-rate-variability',
  'daily-resting-heart-rate',
  'respiratory-rate-sleep-summary',
]

/**
 * Loaded on first sign-in: **one type per sub-tab that has one**, plus the
 * overnight metrics the sleep view reads.
 *
 * This used to be the whole activity block — steps, distance, floors, the
 * calorie and active-minute types. Those are aggregate daily counters that only
 * ever landed in the All activity list; they cost a request each on every
 * control change to fill a list nobody opened first. The three that remain are
 * the ones a sub-tab is actually built around.
 *
 * `SLEEP_METRIC_IDS` is the reason this list is longer than the picker's badge
 * suggests it should be: those three render nothing of their own, but without
 * them every night's HRV, resting heart rate and respiratory rate row is blank.
 * Removing them looks like tidying and reads as missing data.
 *
 * Everything omitted is still one click away in the picker, and the presets
 * ("All activity + sleep", "Everything") are unchanged.
 */
export const DEFAULT_SELECTED_IDS = [
  'exercise',
  'sleep',
  'nutrition-log',
  ...SLEEP_METRIC_IDS,
]

/** Every activity and sleep type, for the "All activity + sleep" preset. */
export const FOCUS_IDS = DATA_TYPES.filter((d) => FOCUS_CATEGORIES.includes(d.category)).map(
  (d) => d.id,
)

/**
 * Read scopes that unlock an endpoint rather than a data type, so no
 * `DataTypeDef` carries them and `REQUESTED_SCOPES` has to name them directly.
 *
 * - `location.readonly` gates a workout's GPS track. It does **not** add a
 *   coordinate to the exercise payload and it is not a listable data type — the
 *   only thing it buys is `dataPoints.exportExerciseTcx`. See `exerciseTcx.ts`.
 * - `profile.readonly` gates `users/me/profile`: age, join date, stride lengths.
 *   See `profile.ts`.
 */
export const ENDPOINT_SCOPES: ReadScope[] = ['location.readonly', 'profile.readonly']

/**
 * Scopes that read nothing, and why they are deliberately **not** requested even
 * when they are enabled on the OAuth client.
 *
 * The Cloud console offers `.readonly` variants of `reproductive_health`,
 * `logged_symptoms` and `mindfulness`, which reads as though menstrual-period,
 * ovulation-test, symptoms and moods had become listable. They have not. Those
 * four data types document exactly three operations — `create`, `update`,
 * `batchDelete` — and `dataPoints.list` accepts a closed set of seven scopes:
 * activity_and_fitness, health_metrics_and_measurements, location, nutrition,
 * sleep, irn, ecg. Nothing else is on the list, so granting these three unlocks
 * no readable endpoint anywhere in v4. Requesting them would widen the consent
 * screen — with women's-health wording, the most sensitive kind — in exchange for
 * zero rows. Checked against the data-type table and the REST reference on
 * 2026-08-17; revisit only if `dataPoints.list` grows the scope.
 *
 * `settings.readonly` is a different case and is listed here only because
 * nothing renders it yet: it really does read, backing `users/me/settings` and
 * `users/me/pairedDevices` (device type, battery level, last sync time).
 */
export const UNREADABLE_SCOPES = [
  'reproductive_health.readonly',
  'logged_symptoms.readonly',
  'mindfulness.readonly',
] as const

/**
 * Every read scope the app can ever need. Google shows one consent screen, so
 * asking once up front beats re-prompting each time a data type is toggled on.
 * Trim this list if you would rather request less.
 *
 * A scope requested here still has to be enabled on the OAuth client in the
 * Cloud console. One that is not simply comes back ungranted — visible as the
 * scope list on the technical tab, and as 403s from the data types that needed
 * it, rather than as a failed sign-in.
 */
export const REQUESTED_SCOPES: string[] = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  ...Array.from(new Set([...DATA_TYPES.map((d) => d.scope), ...ENDPOINT_SCOPES])).map(scopeUrl),
]
