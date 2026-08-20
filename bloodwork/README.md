# Bloodwork tracking function

## Why this exists

Lab-report PDFs and scans aren't structured data. This is a small Azure Function app
(.NET 10, isolated worker model) that accepts an uploaded document, runs it through
Azure AI Document Intelligence's prebuilt layout model asynchronously, and stores the
extracted analyte values in Table Storage so they can be listed, charted, and
corrected over time.

It is fully independent of `broker/` — different language, different storage
account, different concern (document processing, not OAuth token exchange). The only
thing shared with the rest of the repo is the Google OAuth client ID: this function
reuses the access token the SPA already holds from Google sign-in (see
`src/auth/google/`) instead of adding a second auth flow.

## Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/bloodwork/upload` | Upload a PDF/JPG/PNG. Returns `202 {documentId}` immediately; processing happens asynchronously off a queue. |
| `GET` | `/bloodwork/jobs/{documentId}` | Poll processing status: `pending` / `processing` / `completed` / `failed`. |
| `GET` | `/bloodwork/data` | Extracted analyte rows, grouped by report date. Optional `?from=&to=` (inclusive ISO dates). |
| `PUT` | `/bloodwork/data/{date}/{analyte}` | Correct one stored value. |
| `DELETE` | `/bloodwork/data/{date}` | Erase one report: its rows, its job, and the uploaded document. `204`, or `404` if that date holds nothing of yours. |

`GET /bloodwork/data` answers `{ "results": {…}, "truncated": bool }`. `truncated`
means the response hit `MAX_RESULT_ROWS` and older reports were left behind — the
data is still there, the response was capped. When it truncates, the oldest date
group is dropped whole rather than returned half-read, since a report missing some
of its analytes is indistinguishable from a lab that never measured them. Narrow
with `from`/`to` to see past the cap.

All five require `Authorization: Bearer <token>` — but **not** the token the SPA
uses against `health.googleapis.com`. That one carries every
`googlehealth.*.readonly` scope the app requests, and this API needs an identity,
not a health record: anyone able to read it (a compromise here, an over-broad log
sink, a bad transitive dependency) could read the user's whole Google Health
history straight from Google until it expired. So the SPA mints a second token
from the same grant, scoped to `userinfo.email` alone, and sends that one —
`useGoogleAuth().getIdentityToken()`, defined in `src/auth/google/googleAuth.ts`.
Nothing here can enforce it (a token is opaque, and its scopes are the client's to
choose), so the constraint lives where the token is requested.

**That mint sets `include_granted_scopes: false`, and it does not work without it.**
GIS defaults the flag to *true*, so asking for a subset of an existing grant returns
a token covering the entire grant — every `googlehealth.*.readonly` scope included.
The narrow token is only narrow because incremental authorization is switched off
for it. The SPA also checks the scopes Google actually returned and discards a
grant that came back wider than requested, so getting this wrong fails loudly
rather than quietly sending the wrong token.

`GoogleAuthMiddleware` then answers three questions in order, and all three have to
pass before any handler runs:

**0. Rate — has this caller already had its share?** Every route is
`AuthorizationLevel.Anonymous` behind a public URL, and authenticating one request
costs an outbound call to Google. A limit applied after authentication would be a
limit applied after the expense it exists to bound, so `RequestRateLimiter` runs
first: `RATE_LIMIT_REQUESTS` per `RATE_LIMIT_WINDOW_SECONDS` per client address,
refused with `429` and a `Retry-After`. It is in-process, so the ceiling is per
instance rather than per app — a shared counter would mean a storage round-trip
per request, which is the cost being avoided. It bounds the damage; an edge limiter
(Front Door or APIM) is what would bound it exactly.

**1. Authentication — did this caller sign in through our OAuth client?** The token
is verified per-request against Google's `tokeninfo` endpoint, checking the `aud`
claim matches `GOOGLE_CLIENT_ID`. That only proves the caller came through this
app's consent screen, not *which* caller — every row and job is additionally tagged
with the verified token's `sub` at write time, and every read/list/correct is scoped
to the caller's own `sub` (see `CallerContext`, populated once by
`GoogleAuthMiddleware`). Without that, any Google account able to complete the
consent screen could read or edit every other user's lab results, since
`GOOGLE_CLIENT_ID` and the Function App's URL are both public by design, not secrets.

**2. Authorization — is this account allowed in at all?** Any Google account on
earth can pass step 1. The `bloodworkUsers` table is the allowlist that decides who
actually gets in: `UsersRepository.IsApprovedAsync` looks the caller's `sub` up and
lets the request through only when the row exists **and** carries `Approved = true`.
Anything else is a `403 forbidden`, and an account nobody has seen before is
recorded as unapproved on the way out — see [Approving a user](#approving-a-user).

The gate lives in the middleware rather than in one function so it covers every
route uniformly. Gating only `GET /bloodwork/data` would leave `POST
/bloodwork/upload` open, and an unapproved account could still push lab reports into
the storage account and spend Document Intelligence quota, which is most of what
there is to abuse here.

### Error contract

Every non-2xx response is `{ "error": string, "message": string }` with a real HTTP
status code:

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Malformed request (e.g. no correctable fields in a `PUT` body). |
| 401 | `unauthorized` | Missing/invalid/expired Google access token, or wrong `aud`. |
| 403 | `forbidden` | Valid token, but the account is not approved in `bloodworkUsers`. |
| 404 | `not_found` | Unknown `documentId`, or no row at that date/analyte. |
| 413 | `payload_too_large` | Upload exceeds `MAX_UPLOAD_BYTES`. |
| 415 | `unsupported_media_type` | `Content-Type` isn't `application/pdf`, `image/jpeg`, or `image/png` — or the file's leading bytes contradict the type it declared. |
| 429 | `too_many_requests` | Rate limit spent for this window. Carries `Retry-After`. Distinct from `403`: this one clears on its own. |
| 500 | `internal` | Unexpected error. |
| 502 | `upstream_auth` | Google's `tokeninfo` endpoint was unreachable. |

`message` is always safe to display: it is text this app wrote. Two paths
deliberately do **not** echo what they caught — `misconfigured` would name the
configuration key at fault, and a failed job's `errorMessage` used to carry the
storage or Document Intelligence endpoint host and the service's own request id.
Both are still logged in full; neither leaves the process. A failed job also
carries an `errorCode`: a `LayoutParser` code (`report_date_not_found`,
`results_table_not_found`) where the user can act on it, `processing_failed`
otherwise.

## Approving a user

There is **no approval endpoint, and no configuration value that grants access**.
The only way to approve someone is to edit their row in the `bloodworkUsers` table
by hand. That is the design, not a missing feature: code that cannot grant access
cannot be tricked into granting it, and a table with one boolean column is a
smaller thing to get right than an admin route with its own authentication.

The `bloodworkUsers` table holds one row per Google account that has ever presented
a valid token to this app:

| Column | |
| --- | --- |
| `PartitionKey` | Always `user`. |
| `RowKey` | The account's Google `sub` — the same value tagging its jobs and result rows. |
| `Approved` | `false` until a human flips it. **The app only ever writes `false`.** |
| `Email` | Display-only, so you can tell whose account a 21-digit `sub` is. Absent if the token carried no email scope. Never used for authorization — addresses change, `sub` does not. |
| `FirstSeenAt` | ISO 8601, when the account first presented a valid token. |

The flow:

1. A new user signs in to the SPA. Their first request creates their row with
   `Approved = false` and comes back `403`; the Bloodwork tab shows the message from
   that response as an error banner.
2. Open the storage account → **Storage browser** → **Tables** → `bloodworkUsers`
   (or use Azure Storage Explorer). Find the row by `Email`.
3. Set `Approved` to `true` and save.
4. The user reloads. No sign-out or re-consent needed — the gate is checked per
   request, so the next one simply passes.

To revoke, set it back to `false`; the next request is refused. Their stored rows
are untouched, so re-approving restores access exactly as it was.

**Bootstrapping.** You are not special-cased — after the first deploy, sign in once,
then approve your own row. The same applies locally against Azurite, where the table
is created on first run by `CreateIfNotExists`.

## The async pipeline

`upload` writes the blob, a `bloodworkJobs` row (`status: pending`), and a queue
message in one request, then returns. A Storage Queue trigger
(`ProcessDocumentFunction`) picks the message up, calls Document Intelligence,
parses the result (`Services/LayoutParser.cs`), writes one `bloodworkResults` row per
analyte, and marks the job `completed` or `failed`.

A queue trigger was chosen over a blob trigger deliberately: Flex Consumption only
supports the *event-based* blob trigger, which needs Event Grid topic/subscription
infrastructure a plain queue trigger doesn't. Failures are split into permanent
(`ParseException` — header row or report date not found, zero surviving rows;
retrying can't help, so the job is marked `failed` immediately) and transient
(anything else — DI throttling, storage timeouts; left to the queue extension's
built-in retry via `host.json`'s `maxDequeueCount`, only marked `failed` on the final
attempt).

### Storage layout

| Table | PartitionKey | RowKey |
| --- | --- | --- |
| `bloodworkJobs` | `job` (constant) | `documentId` (a GUID) |
| `bloodworkResults` | the owner's Google `sub` | `{reportDate}\|{analyteCode}` |
| `bloodworkUsers` | `user` (constant) | the account's Google `sub` |

**The owner is the partition key in `bloodworkResults`, and that is load-bearing.**
Rows used to be keyed `(reportDate, analyteCode)` with the owner as an ordinary
column. That read correctly — every list and lookup filtered on it — but it did not
*write* correctly: `WriteRowsAsync` upserts, and the upsert matched on date and
analyte alone, so any two accounts holding a report from the same day silently
overwrote each other on every shared lab code, owner included. Lab short codes are
shared across every patient of a lab and report dates cluster on weekdays, so that
was an ordinary accident, not just an attack. Keying by owner makes the collision
unrepresentable rather than guarded against, and turns `GET /bloodwork/data` into a
single-partition read instead of a scan across every user's rows.

The route contract is unchanged by this: the API returns, and `PUT
/bloodwork/data/{date}/{analyte}` accepts, the **analyte half** of the RowKey — the
date already travels as its own path segment (`ResultsRepository.AnalyteKeyOf`).

> **One-time step when deploying this change.** Rows written under the old layout
> are keyed by report date and the new queries will not find them, so they read as
> missing. Clear `bloodworkResults` (Storage browser → Tables → select all → delete)
> and re-upload the reports: every source document is still in the
> `bloodwork-documents` container, since nothing deletes them. Re-uploading
> regenerates every row under the new keys. **Manual corrections do not survive
> this** — they live only on the result rows, so re-apply them afterwards. Nothing
> in `bloodworkJobs` needs touching.

`Services/LayoutParser.cs` matches the results table **structurally** — by scanning
for a header row whose cells match a known set of German column names (`Analyse`,
`Bezeichnung`, `Ergebniswert`, `+/-`, `Einheit`, `Ergebnistext`, `Normbereich`) —
rather than hardcoding cell coordinates, so it tolerates page-to-page layout drift
and a couple of OCR-mangled header cells.

## Setup

### 1. Local development

Needs [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite)
(a real queue trigger and blob/table/queue clients, unlike `broker/`'s HTTP-only
app):

```bash
npx azurite --silent &
cd bloodwork
cp local.settings.json.example local.settings.json   # fill in the blanks
dotnet build
func start --port 7072   # 7071 is broker's
```

For `DOCUMENT_INTELLIGENCE_KEY`, either paste a real key from the Azure portal (fast
iteration), or leave it blank and run `az login` so `DefaultAzureCredential` picks up
your own signed-in identity — but that identity then also needs the `Cognitive
Services User` role on the dev Document Intelligence resource.

Four settings are ceilings with defaults, so they can be left out entirely; a value
of `0` is rejected at startup rather than read as "unlimited", since a typo must not
silently switch off the control it configures.

| Setting | Default | Bounds |
| --- | --- | --- |
| `MAX_UPLOAD_BYTES` | 20 MiB | What one upload may buffer. Enforced *during* the read, so nothing past it is ever held in memory — a chunked request sends no `Content-Length` to pre-check against. |
| `MAX_RESULT_ROWS` | 5000 | Rows one `GET /bloodwork/data` may return, before it reports `truncated`. |
| `RATE_LIMIT_REQUESTS` | 120 | Requests per client per window, counted before authentication. |
| `RATE_LIMIT_WINDOW_SECONDS` | 60 | Length of that window. |

### 2. Tests

```bash
cd bloodwork
dotnet test
```

xUnit + Moq. No live network calls, no live Azurite — `GoogleTokenVerifier` is tested
against a mocked `HttpMessageHandler`, table/blob/queue clients are mocked at the
constructor-injection boundary, and `LayoutParser` is tested against a real captured
(and redacted) Document Intelligence response fixture rather than synthetic data.

### 3. Deploy

Provisioned by the shared `infra/main.bicep` alongside `broker/`'s resources (own
storage account, own Flex Consumption plan, plus a Document Intelligence resource),
deployed by `.github/workflows/deploy-azure-functions.yml` via `azd up`. See that
file and `infra/main.bicep` for the resource list. Document Intelligence auth in
Azure uses the Function App's own system-assigned managed identity (`Cognitive
Services User` role) — no key is stored anywhere in the deployed app settings.

## CORS

**Two layers, unlike the broker.** The broker's rule — code CORS or platform CORS,
never both, since two `Access-Control-Allow-Origin` headers make a browser reject
the response outright — still holds here. This section used to say the platform
setting "must stay empty". It is not empty, and that was wrong. The two layers stay
off each other by answering *different requests*, rather than by one of them being
switched off:

- **Preflight (`OPTIONS`)** is answered by the platform, from the Function App's
  own `siteConfig.cors.allowedOrigins` in `infra/main.bicep`. On Flex Consumption
  the platform intercepts every `OPTIONS` before user code runs — confirmed by
  making the middleware's preflight branch throw unconditionally and watching the
  client still get a clean `204`. `CorsService.BuildPreflightHeaders` therefore
  only ever takes effect under local `func start`, where there is no platform
  layer at all. Leaving the platform list empty was tried, and every authenticated
  browser call then failed with no `Access-Control-Allow-Origin` on its preflight.
- **Actual requests** (`GET`/`POST`/`PUT`/`DELETE`) are answered by
  `Services/CorsService.cs`, applied in `Middleware/GoogleAuthMiddleware.cs` before
  the handler runs, so the headers are present on error responses too. The platform
  adds nothing of its own to these, which is why exactly one header is emitted.

Both lists are fed from the same Bicep parameter (`bloodworkAllowedOrigins` →
`ALLOWED_ORIGINS` and `siteConfig.cors.allowedOrigins`), so they cannot drift by
accident — but they are stored in different places, so changing one without going
through that parameter would silently diverge from the other.

The origin check is a browser-abuse control, not a security boundary: a non-browser
caller forges `Origin` trivially. The real boundary is the token check.

## Retention and erasure

Uploaded documents are full PDFs and scans carrying a name, a date of birth and a
complete result set. Two things bound how long they stay:

- **Time.** A blob lifecycle rule on the storage account deletes anything in
  `bloodwork-documents` after `bloodworkDocumentRetentionDays` (default 90). The
  extracted rows in `bloodworkResults` are what the app actually reads; the
  original is only needed until a parse has succeeded and been checked.
- **The user asking.** `DELETE /bloodwork/data/{date}` removes the rows, the job
  rows and the documents together, scoped to the caller's own partition. Rows go
  first, then the blob, then the job row — so a failure part-way through leaves
  strictly less data than it started with, never a report that lost its rows but
  kept its scan.
