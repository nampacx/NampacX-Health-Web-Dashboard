# Google Health Web Dashboard

A React + Vite single-page app that reads your [Google Health API](https://developers.google.com/health/about)
activity and sleep data, and — separately — your [Withings](https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/public-health-data-api-overview)
body-composition weigh-ins. The two providers are independent: connect either one, or both.

**Google Health**
- Browser-only OAuth 2.0 (implicit token flow via Google Identity Services) — **no client secret in the app**
- Reads `GET /v4/users/me/dataTypes/{dataType}/dataPoints` across the data types you pick
- Defaults to steps, distance, floors, active minutes, active zone minutes, energy burned, total
  calories, exercise and sleep — the other categories stay one click away in the picker
- Groups records by calendar day (Today / Yesterday / weekday), newest first, with per-record detail
  chips and raw JSON

**Withings**
- Authorization-code OAuth through a small [Azure Function broker](api/) — Withings requires a
  `client_secret` for both the token exchange and every refresh, so unlike Google this cannot be a
  browser-only flow (see [api/README.md](api/README.md) for why)
- Reads body-composition weigh-ins (weight, fat %, muscle mass, and more) directly from the browser
  once a token is issued — only the token exchange itself goes through the broker
- One card per weigh-in, with the change since the previous one

## Prerequisites

Node.js 20.19+ or 22.12+ (Vite 7 requires it). It is not currently installed on this machine:

```bash
winget install OpenJS.NodeJS.LTS
```

Open a new terminal afterwards so `node` and `npm` land on `PATH`.

## 1. Google Cloud setup

Per [developers.google.com/health/setup](https://developers.google.com/health/setup):

1. Create (or pick) a Google Cloud project.
2. Enable the **Google Health API**: <https://console.developers.google.com/apis/library/health.googleapis.com>
3. Configure the **OAuth consent screen**, publishing status *Testing*.
4. On the **Data access** page, click *Add or remove scopes* and add the `googlehealth.*.readonly`
   scopes you want. The app requests all read scopes listed in [dataTypes.ts](src/api/dataTypes.ts);
   trim `REQUESTED_SCOPES` there if you want a shorter consent screen.
5. On the **Audience** page, add your own Google account under *Test users*.
6. Create credentials → **OAuth client ID** → application type **Web application**, and add
   `http://localhost:5173` under **Authorized JavaScript origins**.

> The docs' walkthrough uses a "Web Server" client with a redirect URI because it demonstrates the
> authorization-code flow. This app uses the implicit token flow instead, which is the browser-safe
> option: it needs a JavaScript origin, not a redirect URI, and never handles a client secret.

Two limits worth knowing up front:

- While the consent screen is in *Testing*, only listed test users can sign in (max 100).
- Going beyond 100 users requires a **third-party security review**, per Google's setup docs.

## 2. Configure and run

```bash
npm install
```

Copy the env template and paste in your client ID:

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

Then open <http://localhost:5173> and click **Sign in with Google**.

Withings is optional and separate — see [Withings setup](#withings-setup) below. Skipping it leaves
the Google side fully usable; the Withings card just shows a "connect" prompt.

## Tests

```bash
npm run test
```

Vitest, no jsdom — everything under test (normalization, token rotation, OAuth state handling) is
pure logic; a DOM harness would be more setup than the components warrant. The Azure Function has
its own equivalent test suite: `cd api && npm run test`.

## How it works

| File | Role |
| --- | --- |
| [src/auth/googleAuth.ts](src/auth/googleAuth.ts) | GIS token client, token storage in `sessionStorage`, revoke on sign-out |
| [src/auth/AuthContext.tsx](src/auth/AuthContext.tsx) | React context; drops the session when the token expires |
| [src/api/dataTypes.ts](src/api/dataTypes.ts) | Catalog of readable data types and their scopes |
| [src/api/healthApi.ts](src/api/healthApi.ts) | REST calls, error mapping, bounded-concurrency fan-out |
| [src/api/normalize.ts](src/api/normalize.ts) | Turns a raw data point into a renderable row |
| [src/api/grouping.ts](src/api/grouping.ts) | Buckets records into calendar days |
| [src/components/Dashboard.tsx](src/components/Dashboard.tsx) | Controls + list orchestration |
| [src/api/withingsApi.ts](src/api/withingsApi.ts) | `getmeas` client — pagination, body-status error handling |
| [src/api/withingsNormalize.ts](src/api/withingsNormalize.ts) | Raw measure groups → renderable, unit-scaled `MeasureGroup`s |
| [src/auth/withingsAuth.ts](src/auth/withingsAuth.ts) | Authorize redirect, broker calls, module-scope callback capture |
| [src/auth/withingsTokenStore.ts](src/auth/withingsTokenStore.ts) | Token persistence and refresh-rotation safety (see below) |
| [api/](api/) | The Azure Function broker — holds the Withings `client_secret` |

### No proxy needed

`health.googleapis.com` returns permissive CORS headers — it echoes `Access-Control-Allow-Origin`
for arbitrary origins and allows the `authorization` request header:

```bash
curl -sS -o /dev/null -D - -X OPTIONS https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization'
```

So the browser calls the API directly and the app can be hosted as pure static files. Set
`VITE_HEALTH_API_BASE` only if you deliberately want to route through your own proxy.

### Timestamps and field names

Google documents the payload of only a few data types in detail, and the field set differs per type.
Rather than hard-coding a shape per data type, `normalize.ts` works structurally: it locates the
payload object, searches known timestamp paths (`interval.endTime`, `time`, `date`, …), and flattens
the rest into label/value chips, inferring units from field-name suffixes (`caloriesKcal`,
`distanceMillimiters`). Anything it does not understand is still visible under **Raw JSON** on each
row.

On top of that, each data type may declare `summaryKeys` — field names it would rather lead with
(`steps` for steps, `durationMillis` for sleep, `displayName` for exercise). These are hints matched
against the last path segment, tried exactly and then loosely; when none are present the generic
heuristic still applies, so a wrong guess degrades the headline rather than breaking the row. Units
are rendered into the value and stripped from the label, so a `durationMillis` field reads
"Duration: 8 h 15 min" rather than "Duration millis: 29700000".

Likewise, the optional time filter (`<type>.interval.civil_start_time >= "…"`) is applied
optimistically — if the API rejects it with a 400 for a data type that has no such field, the request
is retried unfiltered so that type still contributes rows.

## Withings setup

Withings' token endpoint requires a `client_secret` for both the authorization-code exchange and
every refresh — verified live: sending a PKCE `code_verifier` instead produces the exact same
"Missing params" response as sending nothing at all, so PKCE is not a substitute here the way it is
for most modern OAuth APIs. A static SPA cannot hold that secret, which is why [api/](api/) exists —
a small, stateless Azure Function that does only the token exchange and refresh. Everything else
(fetching measurements) happens directly from the browser; Withings' data API is CORS-open.

1. Register an app at the [Withings Partner dashboard](https://developer.withings.com/dashboard/) —
   name, description, and a callback URI matching your deployed origin **byte-for-byte**, trailing
   slash included (e.g. `https://mikokono.de/Google-Health-Web-Dashboard/`). Note the client ID and
   secret.
2. Deploy the broker: see [api/README.md](api/README.md) — `azd up` provisions an Azure Function
   (Flex Consumption, scales to zero) and wires the secret in as an app setting.
3. Set `VITE_WITHINGS_CLIENT_ID` and `VITE_WITHINGS_BROKER_URL` (copy `.env.example` to
   `.env.local` for local dev, or the repo variables described below for the deployed site).
4. For local development, register a *second* Withings app with a callback of
   `https://localhost:5173/` (Withings requires HTTPS callbacks; `@vitejs/plugin-basic-ssl` or
   similar gets you there) — the deployed app's registration won't accept a `localhost` redirect.
5. Click **Connect Withings**. No physical scale needed to try it: set `VITE_WITHINGS_DEMO=1` to
   append `mode=demo` to the authorize URL and sign in as Withings' demo account.

## Deploy to GitHub Pages

[.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) builds the app and
publishes it on every push to `main` (and on demand via *Run workflow*). Four one-time setup steps:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.** Without this the deploy job
   fails; the workflow does not enable Pages for you.
2. **Settings → Secrets and variables → Actions → Variables** → add `VITE_GOOGLE_CLIENT_ID`. The
   build fails fast with a clear error if it is missing, rather than shipping a site that cannot
   sign anyone in. A *variable*, not a secret, is correct here: an OAuth client ID is public by
   design and is readable in the shipped bundle regardless.
3. **Add the Pages origin to your OAuth client.** In Google Cloud Console, add the origin your site
   is actually served from to *Authorized JavaScript origins* — the scheme and host only, no repo
   path. Check **Settings → Pages** for the real value: if the account has a custom domain, project
   sites are served from it rather than from `<user>.github.io`. For this repo that is
   `https://mikokono.de`, not `https://nampacx.github.io`. Sign-in fails with `origin_mismatch`
   otherwise.
4. **Settings → Pages → Enforce HTTPS.** Google rejects `http://` JavaScript origins for anything
   other than `localhost`, so sign-in cannot work over plain HTTP. The certificate is already
   provisioned; this just makes HTTPS the canonical URL.

The base path is handled automatically: `actions/configure-pages` emits `base_path`, the workflow
passes it as `VITE_BASE_PATH`, and [vite.config.ts](vite.config.ts) normalises it into Vite's `base`.
Local builds still default to `/`.

Google needs no proxy, so the Pages site alone is enough to use it. Withings additionally needs the
Function broker (see [Withings setup](#withings-setup) above) — but that's optional and separate:
the site builds and serves Google-only if `VITE_WITHINGS_CLIENT_ID` / `VITE_WITHINGS_BROKER_URL`
are left unset, only logging a build-time warning rather than failing.

Add these to **Settings → Secrets and variables → Actions → Variables** alongside
`VITE_GOOGLE_CLIENT_ID` for the Withings side to work: `VITE_WITHINGS_CLIENT_ID`,
`VITE_WITHINGS_BROKER_URL`. The Function itself deploys separately, via
[.github/workflows/deploy-function.yml](.github/workflows/deploy-function.yml) — see
[api/README.md](api/README.md) for the secrets and OIDC setup it needs.

## Notes

- Only data types with a `.readonly` scope are listed. `moods`, `symptoms`, `menstrual-period` and
  `ovulation-test` expose write-only scopes, so they cannot be read back.
- The Google access token lives in `sessionStorage` and dies with the tab. There is no refresh
  token — by design, since that would require a client secret and a backend.
- The Withings refresh token is a ~1-year credential and **rotates on every use** — Withings
  invalidates the old one the instant a new one is issued. `withingsTokenStore.ts` exists almost
  entirely to make that safe: writes are synchronous the moment a broker response is parsed, both
  `{current, previous}` tokens are kept, and refreshes are single-flighted in-tab and (via a Web
  Lock, where supported) cross-tab. Only a broker `401 invalid_grant` response ever clears the
  stored token — a network blip or a broker `5xx` must never look the same, or a flaky connection
  would silently and permanently break the Withings link.
- Withings stores the refresh token in `sessionStorage` by default; `localStorage` is opt-in via an
  explicit, off-by-default "keep me connected" checkbox, since a year-long credential in
  `localStorage` is a much larger XSS blast radius than a session-scoped one.
- Withings' token endpoint reports every "Invalid Params" failure — a wrong `client_secret`, a dead
  refresh token, a bad code — as the same generic status. The broker separates them by matching the
  one wording Withings appears to reserve for credential problems ("invalid client id/secret");
  see the comment in [api/src/lib/withings.ts](api/src/lib/withings.ts) for the evidence and the
  reasoning. It is a heuristic, not a documented contract.
