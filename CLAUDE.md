# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A React + Vite SPA reading two **independent** providers — connect either alone, or both:

- **Google Health** — browser-only OAuth 2.0 implicit flow, no client secret, **no backend**. Ships
  as pure static files; the browser calls `health.googleapis.com` directly because the API returns
  permissive CORS headers. Focused on activity and sleep.
- **Withings** — authorization-code OAuth, which *requires* a `client_secret` for both the exchange
  and every refresh. A browser cannot hold that, so `broker/` exists: a small stateless Azure
  Function doing only token exchange and refresh. Measurement fetching still happens in the browser.

The single most important structural fact: **nothing is shared between the two providers** beyond
the page they render on. `src/api/{google,withings}/` and `src/auth/{google,withings}/` mirror that.

## Commands

```bash
# SPA (repo root)
npm install       # requires Node 20.19+ or 22.12+ (Vite 7)
npm run dev       # dev server at http://localhost:5173 (port is fixed in vite.config.ts)
npm run build     # tsc -b && vite build
npm run typecheck # tsc -b --noEmit
npm run test      # vitest, no jsdom — pure logic only
npm run preview   # serve the production build

# Broker (broker/) — a separate npm project with its own package.json and tsconfig
cd broker && npm install && npm run build && npm run test
cd broker && npm start   # tsc + func start on http://localhost:7071
```

No linter is configured. `npm run typecheck` (strict TS, with `noUnusedLocals`/
`noUnusedParameters`) plus `npm run test` are the checks — run both after changes, in **both**
projects if you touched both.

## Configuration

Google config is **required** (the Pages build fails without it); Withings config is **optional**
(a missing value only warns, and the site deploys Google-only). Keep that asymmetry.

| Variable | Provider | Notes |
| --- | --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | Google | Required. OAuth Web-application client ID, public by design. |
| `VITE_WITHINGS_CLIENT_ID` | Withings | Public by design, same posture as the Google one. |
| `VITE_WITHINGS_BROKER_URL` | Withings | Base URL of the `broker/` Function, no trailing slash. |
| `VITE_WITHINGS_REDIRECT_URI` | Withings | Optional override; defaults to origin + base path. |
| `VITE_WITHINGS_DEMO` | Withings | `1` appends `mode=demo` — exercises the flow with no scale. |

Copy `.env.example` to `.env.local`. There is **no** API-base override for Google: the URL is a
constant in `src/api/google/healthApi.ts`, because the API is CORS-open and there is nothing to
point it at.

Origin/redirect rules differ per provider and are a common source of failure:

- **Google** wants a JavaScript *origin* (`http://localhost:5173`, plus the production origin).
  Mismatches surface as `origin_mismatch` at sign-in.
- **Withings** wants a *redirect URI* matched byte-for-byte, trailing slash included, and **HTTPS
  only** — so local dev needs a second Withings app registration with an `https://localhost:5173/`
  callback.

## Architecture

Both providers flow one way: **auth → fetch → normalize → render**. Each has its own directory
under `src/api/` and `src/auth/`; nothing crosses between them.

### Google Health

Data flows **auth → fetch → normalize → group → render**.

- **Auth** (`src/auth/google/`). `googleAuth.ts` wraps Google Identity Services (loaded async via a
  `<script>` in `index.html`, so `waitForGoogleIdentityServices` polls for it). The access token
  lives in `sessionStorage` and dies with the tab — there is no refresh token by design.
  `GoogleAuthContext.tsx` exposes `useGoogleAuth()` and proactively drops the session one minute
  before the token's real expiry so the UI never sits on a dead token.

- **Data catalog** (`src/api/google/dataTypes.ts`). `DATA_TYPES` is the single source of truth for every
  readable data type, its OAuth scope, and optional `summaryKeys`. Write-only types (moods,
  symptoms, etc.) are intentionally absent — they can't be listed. `REQUESTED_SCOPES` asks for all
  read scopes up front so consent happens once; `DEFAULT_SELECTED_IDS` is what loads on first
  sign-in.

  **A `.readonly` scope in the Cloud console does not mean the data is readable.** The console
  offers `reproductive_health.readonly`, `logged_symptoms.readonly` and `mindfulness.readonly`,
  which reads as though menstrual-period, ovulation-test, symptoms and moods had become listable.
  They are not. Those four data types document exactly three operations — `create`, `update`,
  `batchDelete` — and `dataPoints.list` accepts a **closed set** of seven scopes:
  `activity_and_fitness`, `health_metrics_and_measurements`, `location`, `nutrition`, `sleep`,
  `irn`, `ecg`. Nothing else is on it. Granting those three unlocks no readable endpoint anywhere in
  v4, so `UNREADABLE_SCOPES` names them and `REQUESTED_SCOPES` deliberately leaves them out —
  requesting them would widen the consent screen, with the most sensitive wording on it, for zero
  rows. **Check `dataPoints.list`'s scope list, not the console, before adding a data type.**

  Two scopes gate an *endpoint* rather than a data type, so no `DataTypeDef` carries them and
  `ENDPOINT_SCOPES` has to name them explicitly or they silently go unrequested:
  `location.readonly` (the TCX route export) and `profile.readonly` (`users/me/profile`).

  Left unbuilt on purpose: `settings.readonly`, which really does read — `users/me/settings` and
  `users/me/pairedDevices` (device type, battery level, last sync time). Nothing renders it yet.

  **Three catalogued types do not support `list`.** `floors` and `calories-in-heart-rate-zone` are
  `rollup`/`dailyRollup` only, and `total-calories` likewise — yet `floors` and `total-calories` sit
  in `DEFAULT_SELECTED_IDS`, so they are expected to come back as per-type errors in
  `OutcomeSummary` rather than rows. Fixing that means implementing `dataPoints.rollUp`, which is a
  separate endpoint with a separate response shape, not a tweak to the catalog.

- **Fetch** (`src/api/google/healthApi.ts`). `fetchLatestRecords` fans out across selected data types with
  bounded concurrency (`mapWithConcurrency`, limit 6). A per-type failure becomes a `FetchOutcome`
  rather than failing the whole load. The time filter is applied **optimistically**: if the API
  rejects `interval.civil_start_time` with a 400 for a type lacking that field, the request is
  retried unfiltered so the type still contributes rows.

- **Normalize** (`src/api/google/normalize.ts`) — the trickiest file. Google does not document every data
  type's payload shape, so this works **structurally, not per-type**: locate the payload object,
  search `TIMESTAMP_PATHS` for an observation time, flatten remaining leaves into label/value chips,
  and infer units from field-name suffixes (`caloriesKcal`, `distanceMillimiters`, `durationMillis`).
  A data type's `summaryKeys` are only *hints* for the headline value; when they miss, the generic
  "first numeric leaf" heuristic still applies, so a bad guess degrades the headline rather than
  breaking the row. Unrecognized data is always still visible under Raw JSON. **When adding a data
  type, prefer adding `summaryKeys` over special-casing here.**

- **Sleep** (`src/api/google/sleep.ts`, `sleepMetrics.ts`, `src/charts/Hypnogram.tsx`). The one
  place that deliberately breaks the "prefer `summaryKeys` over special-casing" rule above, and it
  has to: `stages` is an **array of objects**, and `flatten()` collapses those to `"23 entries"`.
  A stage timeline is unrecoverable from a flattener, so sleep gets a typed parser and
  `normalize.ts` stays structural. Do not merge them.

  **The RPC reference does not describe the REST JSON. Do not write sleep code from the docs.**
  This cost a full rewrite: every field name in
  `google.devicesandservices.health.v4.Sleep` differs from what the API actually sends, so every
  read missed and every night rendered "0 min asleep" while passing a green test suite built from
  the same wrong names.

  | RPC reference says | The API actually sends |
  | --- | --- |
  | `sleep.start_time` | `sleep.interval.startTime` |
  | `sleep_stages[].stage_type` = `SLEEP_STAGE_DEEP` | `stages[].type` = `DEEP` |
  | `sleepSummary.stageSummaries[].duration` = `"3060s"` | `summary.stagesSummary[].minutes` = `"51"` |
  | `sleepMetadata.stagesState` | `metadata.stagesStatus` |
  | `outOfBedSegments[]` | `shortAwakenings[]` |

  `src/api/google/sleepNight.fixture.ts` is a real captured night and is the authority; the tests
  assert its actual numbers (23 segments, 468 min asleep, 51 min deep over 5 episodes, 22 short
  awakenings). **If a field needs adding, capture a real payload first** — a synthetic fixture only
  proves the parser agrees with itself.

  Four more things that are easy to get wrong:

  - **Render through `startUtcOffset`, never as a bare instant.** The fixture's `20:18Z` is a 22:18
    bedtime at +02:00. Formatting in the browser's zone agrees only while the viewer sits at the
    same offset the watch did, and lies silently after any travel. `wallClock`/`clockLabel`/
    `localDateKey` in `sleep.ts` do this; they return Dates whose **UTC** getters read as local.
  - **Overnight HRV and heart rate are not a join.** `daily-heart-rate-variability` already carries
    `deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds` (HRV while asleep) and
    `nonRemHeartRateBeatsPerMinute` (heart rate while asleep), both computed over the night. There
    is no need to intersect raw HRV samples with the sleep interval — don't build it.
  - **Daily metrics are keyed on the morning a night *ended*, in the recording zone.** A session
    from 22:18 to 06:16 is the *next* day's HRV record. Keying on the start date, or resolving the
    day in UTC, silently pairs every night with the wrong day's numbers and nothing looks broken.
  - **Totals come from `summary` when present**, segments otherwise. `minutesAsleep` and
    `stagesSummary[].minutes` are what the Google Health app shows, and matching the app matters
    more than matching our own hypnogram. They are different fields from the ones the timeline is
    drawn from, so they disagree by up to a minute per stage (the summary is whole minutes; the
    segments carry `:30` boundaries). A test pins that gap at ≤ 1 minute.

  **Sleep Score and recovery are not in this API.** No data type exposes them, and no message in
  `google.devicesandservices.health.v4` carries a score field — they are computed in the Google
  Health app and on the watch. This has been checked against the full data-type enumeration and
  the RPC reference; the sleep view says so on the page so it doesn't read as a bug.

- **Exercise** (`src/api/google/exercise.ts`). The mirror image of the sleep decision, and the
  contrast is the point: sleep needs a typed parser because a stage timeline cannot survive
  `flatten()`; exercise must **not** have one, because its fields differ per activity — a run
  carries distance and pace, a swim carries lengths, a strength session carries almost nothing.
  Pinning a schema would mean rendering one activity well and quietly dropping the rest.

  So it consumes `payloadLeaves()` (exported from `normalize.ts`, one flattening and one unit
  formatter for the whole app) and **ranks** the result. The documented names appear only in
  `STAT_ORDER`'s patterns, so a wrong or renamed field moves a stat down the card instead of
  blanking it. Do not turn this into a schema.

  Two smaller rules: `activeDuration` beats `end - start` when present, because it excludes paused
  time; and `exerciseTotals` sums energy only from paths matching `kcal`, since adding a joules
  field to a kcal one produces a confident wrong number, which is worse than no total.

  **Sets, reps and resistance are not in this API.** Google *Fit*'s `com.google.activity.exercise`
  had `repetitions` and `resistance`; they did not survive into the Health API, and Health Connect —
  which feeds it — has no field for them either. Search results conflating the two are the usual
  source of confusion. The Exercise view says so on the page.

- **GPS routes** (`src/api/google/exerciseTcx.ts`). **There is no `location` data type and no
  coordinate anywhere in the data point JSON.** The entire `DataPoint` union contains two
  location-adjacent fields, both in `exercise.metadata`: `hasGps` (a boolean) and
  `poolLengthMillimeters`. Granting `location.readonly` does not add a route array to the exercise
  payload and does not make a new data type listable — it unlocks exactly one custom method,
  `dataPoints.exportExerciseTcx`, which returns the track as a TCX file per session. So a route can
  be handed to the user, but it cannot be flattened into a stat chip, and a map would mean parsing
  XML. Don't go looking for a lat/lon field.

  Three details in that method's contract:

  - **`?alt=media` is mandatory.** Without it the method returns JSON wrapping a `tcxData` string,
    which for a proto `bytes` field means base64 to undo.
  - **It needs two scopes.** The reference lists them as "one of" and then contradicts itself in a
    note: the call wants an `activity_and_fitness` scope **and** a `location` one. A 403 here is a
    scope problem, not a missing route, and the error message says so.
  - The `:exportExerciseTcx` colon is gRPC-transcoding syntax — percent-encoding it 404s, so only
    the data point id is passed through `encodeURIComponent`.

  `ExerciseSession` carries `hasGps` and `dataPointId`; the card offers the download only when it has
  both, since a data point that arrived without a resource name has no server-side id to export.
  `hasGps` is filtered out of the stat grid because as a stat it reads "Has gps: No" on every indoor
  session. The blob-download plumbing lives in `ExerciseCard.tsx`, not in the API module, so that
  module stays DOM-free and testable — **the suite runs without jsdom.**

- **Profile** (`src/api/google/profile.ts`). `users/me/profile`, behind `profile.readonly`. Not a
  data point: its own endpoint, one of it, no observation time, never in a `FetchOutcome` — so it
  gets a typed parser, which does not contradict `normalize.ts`'s structural rule (that exists
  because data-type payloads are undocumented and grow fields; this is five documented ones).
  Fetched once per sign-in in `googleData.tsx`, in its own effect — it depends on the token and
  nothing else, so sharing the records effect would refetch it on every control change.

  Two field-level traps:

  - **The stride lengths are gated on a second scope.** `profile.readonly` returns the resource, but
    each `*StrideLengthMm` field *additionally* requires an `activity_and_fitness` scope. A token
    holding only `profile.readonly` gets a profile with the strides silently **absent** — not a 403 —
    so missing strides parse to `null` rather than throwing.
  - **`membershipStartDate` is a civil date, not an instant.** It is `{year, month, day}` with no
    zone, so `new Date(y, m-1, d)` renders the day before anywhere west of UTC. `formatCivilDate`
    builds it with `Date.UTC` and pins the formatter to `timeZone: 'UTC'` — the same trick `time.ts`
    uses for session wall clocks.

  **No name, birth date, sex, height or weight.** The resource exposes an *age* Google derives from
  the birth date, never the date. Height and weight are separate data types; the account name on the
  page comes from Google sign-in, not from Google Health. The Profile view says so.

- **Render** (`src/components/`). `Dashboard.tsx` owns the Google tab: controls, fetch outcomes,
  and a **sub-tab bar** (Sleep / Exercise / All activity / Profile, `GOOGLE_TAB_IDS` in
  `state/tabs.ts`). It refetches
  when data-type selection / lookback / page size change, but applies the text `query`
  **client-side without refetching**. A `requestId` ref guards against a slow earlier request
  overwriting a newer result.

  Two structural points here:

  - **Controls sit above the sub-tabs, not inside one.** The data-type selection and time range
    decide what *both* views have to work with; nesting them under one sub-tab would imply they
    only apply there. Profile is the one exception and the only sub-tab without a count badge: it is
    a single object at its own endpoint with no time range to apply, which the view states on the
    page rather than leaving to be inferred from widgets that visibly do nothing.
  - **`Tabs.tsx` is generic over the tab id** and takes an `idPrefix`. That prefix is load-bearing
    now that tab bars nest: two elements with `id="tab-sleep"` would break `aria-controls` for
    both tablists. Each bar also stores its position under its own sessionStorage key.

  There used to be a "show all activities" checkbox that filtered the list down to `exercise` and
  `sleep`. It went when Sleep got its own sub-tab — it had become a control whose default hid most
  of what had just been fetched.

### Withings

Data flows **auth (via broker) → fetch → normalize → render**. No grouping step: one card per
weigh-in.

- **Auth** (`src/auth/withings/`). `withingsAuth.ts` builds the authorize redirect and calls the
  broker; `withingsOAuthState.ts` owns CSRF `state` generation and validation; the callback is
  captured at module scope so a React double-mount can't consume the one-shot `code` twice.
  `WithingsAuthContext.tsx` exposes `useWithingsAuth()`.

- **Token store** (`src/auth/withings/withingsTokenStore.ts`) — the subtlest file in the repo. The
  Withings refresh token is a ~1-year credential that **rotates on every use**: Withings kills the
  old one the instant a new one is issued. So writes are synchronous the moment a broker response
  parses, both `{current, previous}` are kept, and refreshes are single-flighted in-tab and (via a
  Web Lock, where supported) cross-tab. **Only a broker `401 invalid_grant` ever clears the stored
  token** — a network blip or a broker `5xx` must never look the same, or a flaky connection would
  permanently break the link. Defaults to `sessionStorage`; `localStorage` is opt-in behind an
  explicit "keep me connected" checkbox, since a year-long credential is a big XSS blast radius.

- **Fetch** (`src/api/withings/measureApi.ts`). `getmeas` client: pagination via `more`/`offset`,
  and Withings' habit of reporting failures as HTTP 200 with a `status` in the body is mapped to
  real errors here.

- **Measure catalog** (`src/api/withings/measureTypes.ts`). Three lists that look redundant and are
  not — they answer different questions, and **each must stay independently written out**:

  | List | Question |
  | --- | --- |
  | `MEASURE_TYPES` | What is this type called, in what unit, at what precision? |
  | `BODY_COMPOSITION_TYPES` | Is this group a weigh-in at all? |
  | `CARD_MEASURE_TYPES` | Which measures does a weigh-in card put on screen? |

  `MEASURE_TYPES` **labels and orders**; it deliberately does **not** filter — an unknown type
  still renders as `Type <n>` so a firmware update can't silently hide data. Deriving membership
  from the catalog was a live bug: heart pulse (11) is in the catalog for labelling but is also
  emitted by the blood-pressure monitor, so a derived set filed every BP reading as a weigh-in.
  The other two disagree in both directions today — visceral fat (122) marks a weigh-in but is not
  carded, basal metabolic rate (226) is carded but never marks one alone — so deriving either from
  the other is equally wrong. Anything left off the card is still under Raw JSON: the card is
  narrowed, no data is dropped.

- **Normalize** (`src/api/withings/normalize.ts`). Applies Withings' `value × 10^unit` scaling,
  drops `category !== 1` (a weight *goal* must never render as a weigh-in), dedupes by `grpid`
  across page boundaries, and sorts newest-first.

### The broker (`broker/`)

Stateless, two real routes (`/withings/token/exchange`, `/withings/token/refresh`) plus a warmup
pinged before the OAuth redirect so the exchange doesn't hit a cold start. Its **error contract is
load-bearing** — the SPA decides whether to keep or discard the user's refresh token from the
status code, so `401 invalid_grant` (grant is dead, clear it) vs `500 misconfigured` (our config is
wrong, keep it) vs `502 upstream` (retry later) must stay distinct. See `broker/README.md`.

CORS is implemented in `broker/src/lib/cors.ts`, **not** the platform's CORS setting — enabling
both emits two `Access-Control-Allow-Origin` headers and browsers reject the response outright.

## Deploy

Two independent workflows, matching the two independent providers.

- **SPA → GitHub Pages** (`.github/workflows/deploy-pages.yml`), on every push to `main`.
  `VITE_GOOGLE_CLIENT_ID` must be a repository **Variable** (not a secret) and is required — the
  build fails without it. The Withings variables are optional and only warn. The base path is
  handled automatically: `configure-pages` emits `base_path` → `VITE_BASE_PATH` → normalized into
  Vite's `base` in `vite.config.ts`.

- **Broker → Azure** (`.github/workflows/deploy-function.yml`), on pushes touching `broker/`,
  `infra/`, or `azure.yaml`. Authenticates by OIDC federated credential (no publish profile). Also
  runnable locally with `azd up`.

`infra/main.bicep` provisions the Function App (Flex Consumption, Node 22, scale-to-zero), storage,
Application Insights, and a Key Vault holding the Withings `client_secret`. Two things there are
easy to break:

- The Function App **must** carry `tags: { 'azd-service-name': 'broker' }`, matching the service key
  in `azure.yaml`. Without it `azd deploy` fails with "unable to find a resource tagged with…".
- The `client_secret` is a Key Vault reference resolved by a **user-assigned** identity, not the
  Function's system-assigned one — the latter does not exist yet when the app is created, so it
  cannot hold a vault grant in time. The system-assigned identity still owns the storage
  connections.

`broker/.funcignore` uses `.gitignore` syntax, where a slash-less pattern matches at **any** depth.
Keep the anchoring slashes on `/src` and `/test` — a bare `src` also matches `dist/src/`, which
ships a package containing no functions and deploys "successfully" to a 404.
