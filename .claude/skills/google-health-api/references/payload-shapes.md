# Payload shapes

## The envelope

```json
{
  "name": "users/{user}/dataTypes/{dataType}/dataPoints/{id}",
  "dataSource": { "recordingMethod": "...", "platform": "FITBIT" },
  "<dataTypeInCamelCase>": { ...the payload... }
}
```

The payload key is the data type id in camelCase — `daily-resting-heart-rate` →
`dailyRestingHeartRate`. Same key the rollup response uses for its union member,
so one "find the payload" routine serves both.

Units are encoded in **field names**, not in a unit field: `caloriesKcal`,
`distanceMillimeters` (also spelled `distanceMillimiters` on some types),
`durationMillis`, `beatsPerMinute`. Infer from the suffix. int64 fields arrive as
**strings**.

Protobuf durations serialise as `"1800s"`. Civil timestamps carry no zone.

## Sleep — the one that cost a rewrite

**The RPC reference does not describe the REST JSON.** Every field name in
`google.devicesandservices.health.v4.Sleep` differs from what is actually sent.
Code written from that page misses every read and renders "0 min asleep" while a
test suite built from the same names stays green.

| RPC reference says | The API actually sends |
|---|---|
| `sleep.start_time` | `sleep.interval.startTime` |
| `sleep_stages[].stage_type` = `SLEEP_STAGE_DEEP` | `stages[].type` = `DEEP` |
| `sleepSummary.stageSummaries[].duration` = `"3060s"` | `summary.stagesSummary[].minutes` = `"51"` |
| `sleepMetadata.stagesState` | `metadata.stagesStatus` |
| `outOfBedSegments[]` | `shortAwakenings[]` |

Four more traps:

- **`stages` is an array of objects.** A generic flattener renders it as
  "23 entries" and the timeline is unrecoverable. This is the case that justifies
  a typed parser.
- **Render through `startUtcOffset`, never as a bare instant.** `20:18Z` is a
  22:18 bedtime at +02:00. Formatting in the viewer's zone agrees only while the
  viewer sits where the watch did.
- **Totals come from `summary` when present**, segments otherwise. The summary is
  whole minutes while segments carry `:30` boundaries, so they disagree by up to
  a minute per stage. The summary is what the Google Health app shows.
- **Daily metrics key on the morning the night *ended*, in the recording zone.**
  A 22:18→06:16 session is the *next* day's HRV record.

Overnight HRV and heart rate need no join: `daily-heart-rate-variability`
already carries `deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds` and
`nonRemHeartRateBeatsPerMinute`, both computed over the night.

## Exercise

Fields differ per activity — a run has distance and pace, a swim has lengths, a
strength session has almost nothing. **Do not pin a schema**; rank whatever
leaves turn up. Documented names include `metricsSummary.caloriesKcal`,
`metricsSummary.distanceMillimeters`,
`metricsSummary.averageHeartRateBeatsPerMinute`, `splitSummaries[]`,
`exerciseEvents[]`, `metricsSummary.mobilityMetrics.*`.

- `activeDuration` beats `end − start` when present — it excludes paused time.
- Sum energy only from fields whose name says `kcal`. Adding a joules field to a
  kcal one produces a confident wrong number.
- `metadata` holds exactly `hasGps` (boolean) and `poolLengthMillimeters`.
  **These are the only location-adjacent fields in the entire DataPoint union.**

## Nutrition

```json
{
  "interval": { "startTime": "...", "startUtcOffset": "7200s" },
  "totalCarbohydrate": { "grams": 60, "userProvidedUnit": "GRAM" },
  "totalFat": { "grams": 12 },
  "nutrients": [ { "nutrient": "PROTEIN", "quantity": { "grams": 20 } } ],
  "energy": { "kcal": 428, "userProvidedUnit": "KILOCALORIE" },
  "mealType": "BREAKFAST",
  "foodDisplayName": "Porridge",
  "serving": { ... },
  "food": "users/me/..."
}
```

- **Carbs and fat are top-level; protein is not.** There is no `totalProtein` —
  protein exists only inside `nutrients[]`, which a flattener collapses to
  "N entries". Another case where a typed parser is required.
- **Never assemble fat from `nutrients[]`.** The `Nutrient` enum has no total-fat
  member — only `SATURATED_FAT`, `TRANS_FAT`, `MONOUNSATURATED_FAT`,
  `POLYUNSATURATED_FAT`, `UNSATURATED_FAT`. Summing them under-counts whatever a
  food did not break out.
- **`energy.kcal` and a 4/4/9 macro derivation are different numbers.** Alcohol
  and fibre carry energy that is not one of the three, and each food rounds on
  its own. Show both or pick one deliberately; do not present the derived figure
  as the logged one.
- One row is **one logged food**, not one day. A row budget that looks generous
  for sleep runs out in a day or two here.

## Profile

```json
{ "name": "users/{user}/profile", "age": 41,
  "membershipStartDate": { "year": 2019, "month": 3, "day": 14 },
  "userConfiguredWalkingStrideLengthMm": 720,
  "userConfiguredRunningStrideLengthMm": 1180,
  "autoWalkingStrideLengthMm": 748,
  "autoRunningStrideLengthMm": 1224 }
```

- **The stride fields need a second scope.** `profile.readonly` returns the
  resource, but each `*StrideLengthMm` additionally requires an
  `activity_and_fitness` scope. Without it they are silently **absent** — not a
  403 — so treat missing as null rather than an error.
- **`membershipStartDate` is a civil date.** `new Date(y, m-1, d)` renders the
  day before anywhere west of UTC. Build with `Date.UTC` and format pinned to
  `timeZone: 'UTC'`.
- No name, birth date, sex, height or weight. `age` is derived by Google.

## Rollup values

Aggregated fields are `{field}_{aggregation}`:

| Data type | Value shape |
|---|---|
| `floors` | `{ "countSum": "12" }` (int64 as string) |
| `total-calories` | `{ "kcalSum": 2345 }` |
| `calories-in-heart-rate-zone` | `{ "caloriesInHeartRateZones": [ { "heartRateZone": "...", "kcal": 120 } ] }` |

The third is an array of objects, so a flattener shows "4 entries" — a per-zone
view needs to read it explicitly.

## Paired devices — `settings.readonly`

`{ name, deviceType (TRACKER|SCALE), batteryStatus, batteryLevel, lastSyncTime,
deviceVersion, macAddress, features[] }`. `features[]` is a long capability
list — `GPS`, `SMART_SLEEP`, `SPO2`, `ACTIVE_ZONE_MINUTES` and many more — and is
the most reliable way to know what a given device can actually record.
