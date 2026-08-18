# Reading data

## Scopes

All prefixed `https://www.googleapis.com/auth/googlehealth.`.

`dataPoints.list` accepts **exactly these seven**, and nothing else:

```
activity_and_fitness.readonly
health_metrics_and_measurements.readonly
location.readonly
nutrition.readonly
sleep.readonly
irn.readonly
ecg.readonly
```

That list is the authority on whether data is readable. Two consequences:

- **`reproductive_health.readonly`, `logged_symptoms.readonly` and
  `mindfulness.readonly` read nothing.** The Cloud console offers them, which
  makes menstrual-period, ovulation-test, symptoms and moods look listable. They
  are not — those four are create/update/delete only. Requesting these scopes
  widens the consent screen, with the most sensitive wording on it, for zero
  rows.
- **Some scopes gate an endpoint rather than a data type**, so nothing in a
  data-type catalog will pull them in and they must be requested explicitly:

| Scope | Unlocks |
|---|---|
| `location.readonly` | `dataPoints:exportExerciseTcx` only. **Not** a data type, and it adds no field to any payload. |
| `profile.readonly` | `users/me/profile`, `users/me/identity` |
| `settings.readonly` | `users/me/settings`, `users/me/pairedDevices` |

A scope requested at sign-in must also be enabled on the OAuth client. One that
is not simply comes back ungranted — visible in the granted-scope list, and as
403s from whatever needed it, rather than as a failed sign-in.

## `dataPoints.list`

```
GET /v4/users/me/dataTypes/{dataType}/dataPoints?page_size=&page_token=&filter=
```

- Results are ordered **by interval start time, descending** — newest first.
  Anything that groups rows into a larger unit (days, nights) must assume its
  *oldest* group is the clipped one when the row budget runs out.
- **Page size caps at 25 for `sleep` and `exercise`** (default 25 too); 10000 for
  everything else, default 1440. Values above the cap are truncated silently, so
  asking for 50 nights in one request returns 25 and looks like there were only
  25. Follow `nextPageToken` to go further.
- A leftover `nextPageToken` means the *budget* ran out, not the data. Worth
  surfacing.

### The filter grammar

Time filters only. The field depends on the data type's **record type**, and two
data types are exceptions to their own record type:

| Record type | Field | Literal format |
|---|---|---|
| Interval | `{type}.interval.civil_start_time` | `YYYY-MM-DD[THH:mm:ss]` |
| Interval | `{type}.interval.start_time` | RFC-3339 |
| Sample | `{type}.sample_time.civil_time` | `YYYY-MM-DD[THH:mm:ss]` |
| Sample | `{type}.sample_time.physical_time` | RFC-3339 |
| Daily | `{type}.date` | `YYYY-MM-DD` — **date only, a time part is rejected** |
| Session | `{type}.interval.civil_start_time` | `YYYY-MM-DD[THH:mm:ss]` |

Exceptions:

- **Sleep** is explicitly excluded from the session start-time pattern. It
  filters on the **end**: `sleep.interval.civil_end_time` or
  `sleep.interval.end_time`. This is also the right reading — a night belongs to
  the morning it ended on.
- **ECG** takes `electrocardiogram.interval.start_time`, RFC-3339, and supports
  `>=` only. No end-time filtering.
- **Food** types have no time field. Nothing to filter on.

Operators: `>=` and `<`. Logical `AND` (plus `OR` for sleep only).

**A wrong field is a 400, not an ignored parameter.** If your client falls back
to an unfiltered request on 400, the type silently returns its newest N rows and
the time range stops meaning anything, with nothing visibly broken.

**How the data type is spelled in a filter is not settled by the docs.** Every
example is a single-word type (`steps`, `weight`, `sleep`, `exercise`) where
camelCase and snake_case are identical — except the one multi-word example,
`dailyHeartRateVariability.date`, which is camelCase, in a grammar whose *field*
names are plainly snake_case. If you cannot test against a live token, try one
spelling, retry the other on a 400, and remember which worked.

**Snap the window to a day boundary.** A range computed as `now − N×24h` cuts the
oldest day at whatever time of day it happens to be, and every day-grouped view
then shows a partial day drawn identically to a whole one.

## `dataPoints:dailyRollUp`

The read path for the types `list` refuses, and a genuinely different call.

```
POST /v4/users/me/dataTypes/{dataType}/dataPoints:dailyRollUp
{
  "range": { "start": {"date":{"year":,"month":,"day":}},
             "end":   {"date":{"year":,"month":,"day":}} },
  "windowSizeDays": 1,
  "pageSize": 100
}
```

- **Civil, closed-open range.** `time` omitted defaults to midnight. The start
  "must be aligned with the aggregation window" — a day boundary for
  `windowSizeDays: 1`. The exclusive end must be *tomorrow* or today is missing.
- **The range cap is not uniform.** 14 days for `total-calories`,
  `calories-in-heart-rate-zone`, `heart-rate` and `active-minutes`; 90 days for
  everything else. Over-asking is a 400.
- Response is `{ "rollupDataPoints": [...] }`. Each point has `civilStartTime`,
  `civilEndTime`, and **one union member named after the data type in
  camelCase** (`floors`, `totalCalories`, `caloriesInHeartRateZone`).
- **A window with no data omits the union member entirely** rather than sending
  a zero. A generic "find the payload object" heuristic will then latch onto
  `civilStartTime` and render its `year`/`month`/`day` as data. Drop valueless
  windows first.
- Value fields are named `{field}_{aggregation}` → `countSum`, `kcalSum`,
  `confidenceMin`. Unit inference keyed on field-name suffixes must tolerate the
  aggregation word or `kcalSum` renders as a bare number.

`dataPoints:rollUp` is the physical-time sibling, taking an `Interval` and a
`windowSize` duration instead. Prefer `dailyRollUp` for anything calendar-shaped.

## Endpoints that are not data points

| Method | Returns | Scope |
|---|---|---|
| `GET users/me/profile` | age, `membershipStartDate`, 4 stride lengths | `profile.readonly` |
| `GET users/me/identity` | legacy Fitbit id + Google health id | any read scope |
| `GET users/me/settings` | user settings | `settings.readonly` |
| `GET users/me/pairedDevices` | device type, battery level, last sync | `settings.readonly` |
| `GET .../dataPoints/{id}:exportExerciseTcx?alt=media` | the workout's GPS track as TCX | `location.readonly` **and** an `activity_and_fitness` scope |

Notes on the TCX export:

- **`?alt=media` is mandatory.** Without it you get JSON wrapping a `tcxData`
  string, which for a proto `bytes` field means base64 to undo.
- **It needs two scopes.** The reference lists them as "one of" and then
  contradicts itself in a note. A 403 here is a scope problem, not a missing
  route.
- The `:exportExerciseTcx` colon is gRPC-transcoding syntax. Percent-encoding it
  404s — encode the data point id only.
- `?partialData=true` returns a TCX even when there is no GPS track.
