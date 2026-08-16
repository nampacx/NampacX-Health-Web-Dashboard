import type { DataTypeDef, ReadScope } from '../types'

const SCOPE_PREFIX = 'https://www.googleapis.com/auth/googlehealth.'

export function scopeUrl(scope: ReadScope): string {
  return SCOPE_PREFIX + scope
}

/**
 * Read-capable data types from https://developers.google.com/health/data-types.
 * Types that only expose a `.writeonly` scope (moods, symptoms, menstrual-period,
 * ovulation-test) are intentionally omitted — they cannot be listed.
 */
export const DATA_TYPES: DataTypeDef[] = [
  // Activity & fitness
  { id: 'steps', label: 'Steps', category: 'Activity', scope: 'activity_and_fitness.readonly', summaryKeys: ['steps', 'count', 'stepCount'] },
  { id: 'distance', label: 'Distance', category: 'Activity', scope: 'activity_and_fitness.readonly', summaryKeys: ['distanceMillimiters', 'distanceMillimeters', 'distance'] },
  { id: 'exercise', label: 'Exercise', category: 'Activity', scope: 'activity_and_fitness.readonly', summaryKeys: ['displayName', 'exerciseType'] },
  { id: 'floors', label: 'Floors', category: 'Activity', scope: 'activity_and_fitness.readonly', summaryKeys: ['floors', 'count'] },
  { id: 'active-minutes', label: 'Active minutes', category: 'Activity', scope: 'activity_and_fitness.readonly', summaryKeys: ['activeMinutes', 'minutes', 'duration'] },
  { id: 'active-zone-minutes', label: 'Active zone minutes', category: 'Activity', scope: 'activity_and_fitness.readonly', summaryKeys: ['activeZoneMinutes', 'totalMinutes', 'minutes'] },
  { id: 'active-energy-burned', label: 'Active energy burned', category: 'Activity', scope: 'activity_and_fitness.readonly', summaryKeys: ['caloriesKcal', 'energyKcal', 'calories'] },
  { id: 'total-calories', label: 'Total calories', category: 'Activity', scope: 'activity_and_fitness.readonly', summaryKeys: ['caloriesKcal', 'calories'] },
  { id: 'calories-in-heart-rate-zone', label: 'Calories in HR zone', category: 'Activity', scope: 'activity_and_fitness.readonly' },
  { id: 'time-in-heart-rate-zone', label: 'Time in HR zone', category: 'Activity', scope: 'activity_and_fitness.readonly' },
  { id: 'activity-level', label: 'Activity level', category: 'Activity', scope: 'activity_and_fitness.readonly' },
  { id: 'sedentary-period', label: 'Sedentary period', category: 'Activity', scope: 'activity_and_fitness.readonly' },
  { id: 'altitude', label: 'Altitude', category: 'Activity', scope: 'activity_and_fitness.readonly' },
  { id: 'swim-lengths-data', label: 'Swim lengths', category: 'Activity', scope: 'activity_and_fitness.readonly' },
  { id: 'vo2-max', label: 'VO2 max', category: 'Activity', scope: 'activity_and_fitness.readonly' },
  { id: 'daily-vo2-max', label: 'Daily VO2 max', category: 'Activity', scope: 'activity_and_fitness.readonly' },
  { id: 'run-vo2-max', label: 'Run VO2 max', category: 'Activity', scope: 'activity_and_fitness.readonly' },

  // Health metrics & measurements
  { id: 'heart-rate', label: 'Heart rate', category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'daily-resting-heart-rate', label: 'Resting heart rate', category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'heart-rate-variability', label: 'HRV', category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'daily-heart-rate-variability', label: 'Daily HRV', category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'daily-heart-rate-zones', label: 'Daily HR zones', category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'weight', label: 'Weight', category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'height', label: 'Height', category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'body-fat', label: 'Body fat', category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'blood-glucose', label: 'Blood glucose', category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'oxygen-saturation', label: 'SpO2', category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'daily-oxygen-saturation', label: 'Daily SpO2', category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'daily-respiratory-rate', label: 'Respiratory rate', category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'respiratory-rate-sleep-summary', label: 'Respiratory rate (sleep)', category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'core-body-temperature', label: 'Body temperature', category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' },
  { id: 'daily-sleep-temperature-derivations', label: 'Sleep temperature', category: 'Metrics', scope: 'health_metrics_and_measurements.readonly' },

  // Sleep
  {
    id: 'sleep',
    label: 'Sleep',
    category: 'Sleep',
    scope: 'sleep.readonly',
    summaryKeys: ['durationMillis', 'durationMs', 'duration', 'timeAsleepMinutes', 'minutesAsleep', 'efficiency'],
  },

  // Nutrition
  { id: 'nutrition-log', label: 'Nutrition log', category: 'Nutrition', scope: 'nutrition.readonly' },
  { id: 'hydration-log', label: 'Hydration log', category: 'Nutrition', scope: 'nutrition.readonly' },
  { id: 'food', label: 'Food', category: 'Nutrition', scope: 'nutrition.readonly' },

  // Specialised
  { id: 'electrocardiogram', label: 'ECG', category: 'Specialised', scope: 'ecg.readonly' },
  { id: 'irregular-rhythm-notification', label: 'Irregular rhythm', category: 'Specialised', scope: 'irn.readonly' },
]

export const DATA_TYPES_BY_ID = new Map(DATA_TYPES.map((d) => [d.id, d]))

/** The categories the dashboard is built around. */
export const FOCUS_CATEGORIES = ['Activity', 'Sleep']

/** Ordered so the focus categories come first in the picker. */
export const CATEGORY_ORDER = [...FOCUS_CATEGORIES, 'Metrics', 'Nutrition', 'Specialised']

/**
 * Loaded on first sign-in: the activity and sleep types, minus the niche ones
 * (VO2 max variants, swim lengths, altitude) that would mostly add empty rows.
 */
export const DEFAULT_SELECTED_IDS = [
  'steps',
  'distance',
  'floors',
  'active-minutes',
  'active-zone-minutes',
  'active-energy-burned',
  'total-calories',
  'exercise',
  'sleep',
]

/** Every activity and sleep type, for the "All activity + sleep" preset. */
export const FOCUS_IDS = DATA_TYPES.filter((d) => FOCUS_CATEGORIES.includes(d.category)).map(
  (d) => d.id,
)

/**
 * Every read scope the app can ever need. Google shows one consent screen, so
 * asking once up front beats re-prompting each time a data type is toggled on.
 * Trim this list if you would rather request less.
 */
export const REQUESTED_SCOPES: string[] = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  ...Array.from(new Set(DATA_TYPES.map((d) => d.scope))).map(scopeUrl),
]
