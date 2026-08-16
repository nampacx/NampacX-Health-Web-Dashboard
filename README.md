# Google Health Web Dashboard

A React + Vite single-page app that signs you in with Google and lists your latest
[Google Health API](https://developers.google.com/health/about) data.

- Browser-only OAuth 2.0 (implicit token flow via Google Identity Services) — **no client secret in the app**
- Reads `GET /v4/users/me/dataTypes/{dataType}/dataPoints` across the data types you pick
- Merges everything into one list sorted newest-first, with per-record detail chips and raw JSON

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
| [src/components/Dashboard.tsx](src/components/Dashboard.tsx) | Controls + list orchestration |

### The dev proxy

`health.googleapis.com` does not advertise CORS headers for arbitrary browser origins, so
[vite.config.ts](vite.config.ts) proxies `/health-api/**` to it during development. The access token
is still minted in the browser; the proxy only forwards the request. For a deployment you need an
equivalent proxy (any small server or an edge function) — set `VITE_HEALTH_API_BASE` to point at it.

### Timestamps and field names

Google documents the payload of only a few data types in detail, and the field set differs per type.
Rather than hard-coding a shape per data type, `normalize.ts` works structurally: it locates the
payload object, searches known timestamp paths (`interval.endTime`, `time`, `date`, …), and flattens
the rest into label/value chips, inferring units from field-name suffixes (`caloriesKcal`,
`distanceMillimiters`). Anything it does not understand is still visible under **Raw JSON** on each
row.

Likewise, the optional time filter (`<type>.interval.civil_start_time >= "…"`) is applied
optimistically — if the API rejects it with a 400 for a data type that has no such field, the request
is retried unfiltered so that type still contributes rows.

## Notes

- Only data types with a `.readonly` scope are listed. `moods`, `symptoms`, `menstrual-period` and
  `ovulation-test` expose write-only scopes, so they cannot be read back.
- The access token lives in `sessionStorage` and dies with the tab. There is no refresh token —
  by design, since that would require a client secret and a backend.
