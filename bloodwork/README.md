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
| `GET` | `/bloodwork/data` | All extracted analyte rows, grouped by report date. |
| `PUT` | `/bloodwork/data/{date}/{analyte}` | Correct one stored value. |

All four require `Authorization: Bearer <google access token>` — the same token
`useGoogleAuth().getAccessToken()` already returns in the SPA. The token is verified
per-request against Google's `tokeninfo` endpoint, checking the `aud` claim matches
`GOOGLE_CLIENT_ID`.

### Error contract

Every non-2xx response is `{ "error": string, "message": string }` with a real HTTP
status code:

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Malformed request (e.g. no correctable fields in a `PUT` body). |
| 401 | `unauthorized` | Missing/invalid/expired Google access token, or wrong `aud`. |
| 404 | `not_found` | Unknown `documentId`, or no row at that date/analyte. |
| 413 | `payload_too_large` | Upload exceeds `MAX_UPLOAD_BYTES`. |
| 415 | `unsupported_media_type` | `Content-Type` isn't `application/pdf`, `image/jpeg`, or `image/png`. |
| 500 | `internal` | Unexpected error. |
| 502 | `upstream_auth` | Google's `tokeninfo` endpoint was unreachable. |

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

Implemented entirely in `Services/CorsService.cs`, applied via
`Middleware/ErrorHandlingMiddleware.cs`'s response path — not the platform's CORS
setting, which must stay empty (both together emit two
`Access-Control-Allow-Origin` headers and browsers reject the response outright).
Same posture as `broker/src/lib/cors.ts`.
