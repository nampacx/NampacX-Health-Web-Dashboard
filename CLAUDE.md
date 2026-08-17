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

- **Render** (`src/components/`). `Dashboard.tsx` orchestrates controls + list; it refetches when
  data-type selection / lookback / page size change, but applies the text `query` and the
  `showAll` toggle **client-side without refetching**. A `requestId` ref guards against a slow
  earlier request overwriting a newer result. Note: with `showAll` off, the list is filtered to
  only `exercise` and `sleep` records (the default focus view).

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

- **Measure catalog** (`src/api/withings/measureTypes.ts`). `MEASURE_TYPES` **labels and orders**
  types; it deliberately does **not** filter — an unknown type still renders as `Type <n>` so a
  firmware update can't silently hide data. Section membership is a *separate* explicit list,
  `BODY_COMPOSITION_TYPES`. **Keep those two apart.** Deriving membership from the catalog is a
  live bug: heart pulse (11) is in the catalog for labelling but is also emitted by the blood-
  pressure monitor, so a derived set would file every BP reading as a weigh-in.

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
