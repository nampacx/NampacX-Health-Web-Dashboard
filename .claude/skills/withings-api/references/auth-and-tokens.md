# Auth and tokens

## The flow

Authorization-code OAuth 2.0. Requires a `client_secret` at both the exchange and
every refresh, so a browser-only integration is not possible.

**1. Send the user to the authorization URL**

```
https://account.withings.com/oauth2_user/authorize2
  ?response_type=code
  &client_id=...
  &scope=user.info,user.metrics,user.activity
  &redirect_uri=...
  &state=...
```

`state` is CSRF protection: generate it per attempt, and validate the returned
value before touching the `code`.

**2. User is redirected back** to `redirect_uri` with `code` and `state`.

**3. Exchange the code — within 30 seconds.** The authorization code is valid for
**30 seconds only**. Anything that adds latency between the redirect and the
exchange (a cold-start function, an interactive step) has to be pre-warmed.

```
POST https://wbsapi.withings.net/v2/oauth2
  action=requesttoken
  grant_type=authorization_code
  client_id=...
  client_secret=...
  code=...
  redirect_uri=...
```

**4. Refresh** with the same endpoint, `grant_type=refresh_token`.

Response body (inside the `body` envelope):

```json
{ "userid": 363, "access_token": "...", "refresh_token": "...",
  "expires_in": 10800, "scope": "user.info,user.metrics",
  "csrf_token": "...", "token_type": "Bearer" }
```

## Lifetimes — and the rotation rule that matters

| Token | Lifetime |
|---|---|
| Authorization code | **30 seconds** |
| `access_token` | **3 hours** (`expires_in: 10800`) |
| `refresh_token` | **1 year** |
| *Old* `refresh_token` after a refresh | **8 hours after the new one is issued, or immediately once the new access token is used** |

Consequences worth designing around:

- **Persist the new refresh token synchronously**, the instant the response
  parses — before using the new access token for anything. A crash between
  "received" and "stored" costs the connection.
- **Keep the previous token as a fallback.** The 8-hour grace exists precisely so
  a client that missed the write can recover. Storing `{current, previous}` is
  the pattern.
- **Single-flight refreshes.** Two concurrent refreshes each issue a new token
  and invalidate the other's. In a browser, that means in-tab de-duplication
  *and* a cross-tab lock (Web Locks where available).
- **Only clear on a real `invalid_grant`.** A network error, a 5xx, or a timeout
  is retryable and must not be treated as "the grant is dead" — otherwise a flaky
  connection permanently unlinks the account.
- A year-long credential in `localStorage` is a large XSS blast radius. Prefer
  session-scoped storage unless the user explicitly opts into staying connected.

## Scopes

| Scope | Grants |
|---|---|
| `user.info` | Account info, linked devices, goals, device linking. Required to list/subscribe to user notifications. |
| `user.metrics` | **Measure - Getmeas**, Heart v2 Get/List, Measure v2 Confirmuser, User v2 Getgoals, Stetho v2 Get/List. Also required for notification management. |
| `user.activity` | Measure v2 Getactivity / Getintradayactivity / Getworkouts, Sleep v2 Get / Getsummary. Also required for notification management. |
| `user.sleepevents` | Bed in/out and bed-presence notifications. |

Comma-separated in the authorize URL. The token response echoes the scopes the
user actually granted — read it rather than assuming you got what you asked for.

**Body composition, blood pressure, temperature and SpO₂ all come from
`user.metrics` via `getmeas`.** Sleep *summaries* and activity are a different
scope and different services.

## Redirect URI rules

- Matched **byte-for-byte**, trailing slash included.
- **HTTPS only.** This bites in local development: `http://localhost` is
  rejected, so local dev needs either an HTTPS dev server or a second app
  registration pointing at `https://localhost:PORT/`.

## Request signing

Some endpoints require an HMAC-SHA256 signature rather than (or as well as) the
client secret in the body:

1. **Get a nonce** — `Signature v2 - Getnonce`, with `action`, `client_id`,
   `timestamp`, and a `signature` that is HMAC-SHA256 of
   `action,client_id,timestamp` keyed by the client secret.
2. **Sign the call** — concatenate the parameter *values* sorted alphabetically
   by key name, comma-separated, HMAC-SHA256 keyed by the client secret, and send
   as `signature`.

Nonces are single-use; fetch a fresh one per signed request.

## Access token usage

Documented form is the header:

```
Authorization: Bearer <access_token>
```

Some services have historically also accepted `access_token` as a form field in
the POST body. The header is what the reference specifies — prefer it, and treat
a form-field implementation as legacy worth migrating.

## Demo mode

`OAuth 2.0 - Get access to demo access` (`oauth2-getdemoaccess`) issues tokens
against a demo account populated with sample data. Appending `mode=demo` to the
authorize URL exercises the full flow without owning a device — the only way to
test an integration end to end before hardware exists.
