# Services, notifications and status codes

## The status contract

**Every call returns HTTP 200.** Failure is reported in the body:

```json
{ "status": 601, "error": "Too many request" }
```

So `if (!response.ok) throw` catches almost nothing. Read `status`, treat
non-zero as an error, and map it through the table below. Many responses also
carry a human-readable `error` naming the offending parameter — surface it.

### Status codes

| Value | Family |
|---|---|
| 0 | **Operation was successful** |
| 100..102, 200, 401 | Authentication failed |
| 214, 277, 2553, 2555 | Unauthorized |
| 522 | Timeout |
| 524 | Bad state |
| 601 | **Too many requests** (rate limit) |
| 2554 | Not implemented |
| 201..213, 216..218, 220..221, 223, 225, 227..230, 234..236, 238, 240..252, 254, 260..267, 271..272, 275..276, 283..288, 290, 293..295, 297, 300..304, 321, 323..353, 380..382, 400, 501..511, 523, 532, 3017..3019 | Invalid params |
| 215, 219, 222, 224, 226, 231..233, 237, 253, 255..259, 268..270, 273..274, 278..282, 289, 291..292, 296, 298, 305..320, 322, 370..375, 383, 391, 402, 516..521, 525..531, 533, 602, 700, 1051..1054, 2551..2552, 2556..2559, 3000..3016, 3020..3024, 5000..5006, 6000, 6010..6011, 9000, 10000 | An error occurred |

What to do per family, per the reference:

- **Timeout** — retry.
- **Authentication failed** — check the tokens are correct and properly set.
- **Invalid params** — check tokens and params.
- **Not Implemented** — the service does not exist.
- **Unauthorized** — you are not allowed to call this service.
- **An error occurred** — check tokens and params; if it persists, contact support.

**Do not clear a stored refresh token on a transient family.** Only a genuine
authentication failure on a *refresh* means the grant is dead. Treat timeouts,
rate limits and generic errors as retryable, or a flaky connection permanently
unlinks the user.

## Rate limits

**120 requests per minute across the whole application** on the standard plan —
not per user. Polling burns it fast and adds latency you cannot tune. Status 601
is the symptom. Higher limits require an Enterprise plan.

The intended pattern is webhooks: Withings tells you when data is ready, you
fetch only that.

## Notifications (webhooks)

Subscribe with `Notify - Subscribe`; Withings then POSTs
`application/x-www-form-urlencoded` to your callback URL. Standard fields:
`userid`, `appli`, `startdate`, `enddate`, `date`, `deviceid`, `action`.

Your endpoint must return HTTP < 400 within a few seconds. On failure Withings
retries over **5 cycles across roughly 5 hours** (T+0, +10s, +1min, +1h, +4h),
each cycle making 2 attempts — 10 total, with jitter on the later ones.

### Categories (`appli`)

| appli | Scope | Category | Follow-up call |
|---|---|---|---|
| 1 | `user.metrics` | Weight & body composition | Getmeas |
| 2 | `user.metrics` | Temperature | Getmeas |
| 4 | `user.metrics` | Blood pressure & heart rate | Getmeas |
| 16 | `user.activity` | Activity (steps, distance, workouts) | Getactivity / Getintradayactivity / Getworkouts |
| 44 | `user.activity` | Sleep summary | Sleep v2 - Getsummary |
| 46 | `user.info` | User profile change (`action` = delete/unlink/update) | none |
| 50 / 51 / 52 | `user.sleepevents` | Bed in / Bed out / Sleep sensor inflated | none |
| 53 | — | Unassociated device setup | none |
| 54 / 55 | `user.metrics` | ECG measurement / ECG measurement failed | Getmeas / none |
| 58 | `user.metrics` | Glucose | Getmeas |
| 60 | `user.data` | Survey answered | Answers v2 - Get |
| 61 | `user.metrics` | Stethoscope | Stetho v2 |
| 62 | `user.metrics` | Heart Rate Variability | Getmeas |
| 98 / 99 / 100 | `user.sleepevents` | Bed occupied / empty / in-out, 10-minute poll | none |

98–100 require a Withings contract enabling Live Sync plus device activation.

A notification is a *hint that data exists*, not the data. Always fetch — and
because a webhook can be retried or duplicated, the fetch must be idempotent
(dedupe on `grpid`).

## Every service and action

Grouped by area. Endpoint is `https://wbsapi.withings.net/<path>` with the action
as a POST parameter.

**OAuth / signature**
`oauth2-authorize`, `oauth2-getaccesstoken`, `oauth2-recoverauthorizationcode`,
`oauth2-listusers`, `oauth2-revoke`, `oauth2-getdemoaccess`,
`oauth2-createclient`, `signaturev2-getnonce`

**Measures** — `user.metrics`
`measure-getmeas`, `measurev2-confirmuser`

**Activity & workouts** — `user.activity`
`measurev2-getactivity`, `measurev2-getintradayactivity`, `measurev2-getworkouts`

**Sleep** — `user.activity`
`sleepv2-get` (per-minute series), `sleepv2-getsummary` (per-night summary)

**Heart / ECG** — `user.metrics`
`heartv2-get`, `heartv2-list`

**Stethoscope** — `user.metrics`
`stethov2-get`, `stethov2-list`

**User & devices** — `user.info`
`userv2-get`, `userv2-getdevice`, `userv2-getgoals`, `userv2-activate`,
`userv2-link`, `userv2-unlink`, `userv2-addtorpm`

**Notifications**
`notify-subscribe`, `notify-get`, `notify-list`, `notify-update`, `notify-revoke`

**Raw signal / surveys / nudges** (contract-gated)
`rawdatav2-activate`, `rawdatav2-deactivate`, `rawdatav2-get`,
`surveyv2-*`, `answersv2-get`, `nudgev2-*`, `nudgecampaignv2-*`

**Logistics** (contract-gated)
`dropshipmentv2-*`, `orderv2-getdetail`, `devicev2-enablefeature`,
`devicev2-disablefeature`, `devicev2-endpartnerprogram`

## `Sleep v2 - Get` data fields

Requested via `data_fields=` (comma-separated), not returned by default:

`hr` (bpm), `rr` (breaths/min), `snoring` (seconds), `sdnn_1` (HRV, SD of NN over
1 min, ms), `rmssd` (HRV, RMS of successive differences, ms), `hrv_quality`,
`mvt_score` (movement intensity 0–255, Sleep Analyzer EU / Sleep Rx US only),
`chest_movement_rate`, `withings_index` (breathing-event index, Sleep Rx).

Ask only for what you render — the series are per-minute and get large.
