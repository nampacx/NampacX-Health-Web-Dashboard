# Google Health Web Dashboard

A React + Vite single-page app that signs you in with Google and lists your latest
[Google Health API](https://developers.google.com/health/about) data, focused on **activity and
sleep**.

- Browser-only OAuth 2.0 (implicit token flow via Google Identity Services) — **no client secret in the app**
- Reads `GET /v4/users/me/dataTypes/{dataType}/dataPoints` across the data types you pick
- Defaults to steps, distance, floors, active minutes, active zone minutes, energy burned, total
  calories, exercise and sleep — the other categories stay one click away in the picker
- Groups records by calendar day (Today / Yesterday / weekday), newest first, with per-record detail
  chips and raw JSON

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

Because the API needs no proxy, static hosting is enough — nothing else is required at runtime.

## Notes

- Only data types with a `.readonly` scope are listed. `moods`, `symptoms`, `menstrual-period` and
  `ovulation-test` expose write-only scopes, so they cannot be read back.
- The access token lives in `sessionStorage` and dies with the tab. There is no refresh token —
  by design, since that would require a client secret and a backend.
