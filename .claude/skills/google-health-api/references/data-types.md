# Data type catalog

Transcribed from <https://developers.google.com/health/data-types>. The columns
that matter and are easy to get wrong are **Record type** (it picks the filter
field — see `reading-data.md`) and **Operations** (three types cannot be listed).

Scope column is the read scope, prefixed
`https://www.googleapis.com/auth/googlehealth.`. Types with a `.writeonly` scope
cannot be read by any method.

## Activity & fitness — `activity_and_fitness.readonly`

| Data type id | Record type | Operations |
|---|---|---|
| `active-energy-burned` | Interval | list, reconcile, rollup, dailyRollup |
| `active-minutes` | Interval | list, reconcile, rollup, dailyRollup |
| `active-zone-minutes` | Interval | list, reconcile, rollup, dailyRollup |
| `activity-level` | Interval | list, reconcile |
| `altitude` | Interval | list, reconcile, rollup, dailyRollup |
| `calories-in-heart-rate-zone` | Interval | **rollup, dailyRollup only** |
| `daily-vo2-max` | Daily | list, reconcile |
| `distance` | Interval | list, reconcile, rollup, dailyRollup |
| `exercise` | Session | list, get, reconcile, create, update, batchDelete |
| `floors` | Interval | **reconcile, rollup, dailyRollup only** |
| `run-vo2-max` | Sample | list, reconcile, rollup, dailyRollup |
| `sedentary-period` | Interval | list, reconcile, rollup, dailyRollup |
| `steps` | Interval | list, reconcile, rollup, dailyRollup |
| `swim-lengths-data` | Interval | list, reconcile, rollup, dailyRollup |
| `time-in-heart-rate-zone` | Interval | list, reconcile, rollup, dailyRollup |
| `total-calories` | Interval | **rollup, dailyRollup only** |
| `vo2-max` | Sample | list, reconcile |

## Health metrics & measurements — `health_metrics_and_measurements.readonly`

| Data type id | Record type | Operations |
|---|---|---|
| `blood-glucose` | Sample | list, get, reconcile, rollup, dailyRollup |
| `body-fat` | Sample | list, get, reconcile, rollup, dailyRollup, create, update, batchDelete |
| `core-body-temperature` | Sample | list, get, reconcile, rollup, dailyRollup |
| `daily-heart-rate-variability` | Daily | list, reconcile |
| `daily-heart-rate-zones` | Daily | list, reconcile |
| `daily-oxygen-saturation` | Daily | list, reconcile |
| `daily-respiratory-rate` | Daily | list, reconcile |
| `daily-resting-heart-rate` | Daily | list, reconcile |
| `daily-sleep-temperature-derivations` | Daily | list, reconcile |
| `heart-rate` | Sample | list, reconcile, rollup, dailyRollup |
| `heart-rate-variability` | Sample | list, reconcile |
| `height` | Sample | list, get, reconcile, create, update, batchDelete |
| `oxygen-saturation` | Sample | list, reconcile |
| `respiratory-rate-sleep-summary` | Sample | list, reconcile |
| `weight` | Sample | list, get, reconcile, rollup, dailyRollup, create, update, batchDelete |

## Sleep — `sleep.readonly`

| Data type id | Record type | Operations |
|---|---|---|
| `sleep` | Session | list, get, reconcile, create, update, batchDelete |

## Nutrition — `nutrition.readonly`

| Data type id | Record type | Operations |
|---|---|---|
| `food` | Food | list, get |
| `food-measurement-unit` | Food | list, get |
| `hydration-log` | Session | list, get, reconcile, rollup, dailyRollup, create, update, batchDelete |
| `nutrition-log` | Sample — but see below | list, get, reconcile, rollup, dailyRollup, create, update, batchDelete |

> **`nutrition-log`'s record type is wrong for filtering purposes.** The table
> files it as a Sample, but the `NutritionLog` message carries an `interval` (a
> `SessionTimeInterval`) and **no `sample_time` field at all**. The filter
> grammar names real proto fields, so `nutrition_log.sample_time.civil_time`
> cannot resolve. Filter it as a Session:
> `nutrition_log.interval.civil_start_time`.

## Specialised

| Data type id | Record type | Operations | Scope |
|---|---|---|---|
| `electrocardiogram` | Session | list | `ecg.readonly` |
| `irregular-rhythm-notification` | Session | list | `irn.readonly` |

## Write-only — not readable by anything

These four exist, and the Cloud console offers `.readonly` variants of their
scopes. **The readonly variants unlock no read method anywhere in v4.** See the
scope table in `reading-data.md`.

| Data type id | Record type | Operations | Scope |
|---|---|---|---|
| `menstrual-period` | Interval | create, update, batchDelete | `reproductive_health.writeonly` |
| `ovulation-test` | Sample | create, update, batchDelete | `reproductive_health.writeonly` |
| `symptoms` | Sample | create, update, batchDelete | `logged_symptoms.writeonly` |
| `moods` | Sample | create, update, batchDelete | `mindfulness.writeonly` |

## Quick lookups

**Cannot be listed** — use `dataPoints:dailyRollUp`:
`floors`, `total-calories`, `calories-in-heart-rate-zone`.

**Daily record type** (filter on a bare `date`, no time part):
`daily-heart-rate-variability`, `daily-heart-rate-zones`,
`daily-oxygen-saturation`, `daily-respiratory-rate`, `daily-resting-heart-rate`,
`daily-sleep-temperature-derivations`, `daily-vo2-max`.

**Session record type**: `exercise`, `sleep`, `hydration-log`,
`electrocardiogram`, `irregular-rhythm-notification`, and effectively
`nutrition-log`.

**Food record type** — no time field, nothing to filter on: `food`,
`food-measurement-unit`.
