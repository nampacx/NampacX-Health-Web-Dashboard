# Withings token broker

A small, stateless Azure Function that holds the Withings OAuth `client_secret` and does two
things: exchange an authorization code for tokens, and refresh an access token. Nothing else —
fetching measurements happens directly from the browser against `wbsapi.withings.net`, which is
CORS-open.

## Why this exists

Google's OAuth flow (see the [top-level README](../README.md)) is browser-only: no client secret,
no refresh token. Withings does not offer that option. Verified against the live token endpoint:
sending `code_verifier` (PKCE) in place of `client_secret` produces the exact same "Missing params"
response as sending nothing at all. `client_secret` is required for both `grant_type=authorization_code`
and `grant_type=refresh_token`, so a static single-page app cannot complete either grant on its own —
hence this Function.

## Routes

| Route | Body (form-encoded) | Purpose |
| --- | --- | --- |
| `POST /api/withings/token/exchange` | `code`, `redirect_uri` | First connect |
| `POST /api/withings/token/refresh` | `refresh_token` | Renew an access token |
| `GET /api/withings/warmup` | — | Fired before the OAuth redirect so the exchange doesn't land on a cold start |

Responses are JSON, camelCased (`accessToken`, `refreshToken`, `expiresIn`, `scope`, `userId`) —
Withings' own envelope never reaches the SPA.

### Error contract

Real HTTP status codes, deliberately unlike Withings' own API (which reports everything as HTTP 200
with a status code buried in the body). The SPA's decision to keep or discard the user's stored
refresh token hinges on this:

| Status | Meaning | SPA behaviour |
| --- | --- | --- |
| `400` | Bad request — missing field, or `redirect_uri` not on the allowlist | Report, don't retry |
| `401` `invalid_grant` | The grant itself is dead | **Only this clears the stored token** |
| `500` `misconfigured` | The broker's own config or credentials are wrong | Keep the token, surface the error |
| `502` `upstream` | Withings unreachable, or an unrecognised failure | Keep the token, retry later |

The 401-vs-500 split for a rejected token grant is a heuristic, not a documented Withings contract
— see the comment in [src/lib/withings.ts](src/lib/withings.ts) for the live evidence behind it
(Withings reports a bad `client_secret` and a dead refresh token with the *same* status code; only
the error text differs, and only for the credentials case).

## Setup

### 1. Local development

```bash
cd api
npm install
cp local.settings.json.example local.settings.json   # if you don't already have one
```

Fill in `WITHINGS_CLIENT_ID` / `WITHINGS_CLIENT_SECRET` (a dev-only Withings app registration — see
the top-level README's Withings setup section for the localhost-callback caveat) and run:

```bash
npm start
```

This runs `tsc` then `func start`. `AzureWebJobsStorage` is intentionally left as an empty string in
`local.settings.json` — Azure Functions Core Tools supports HTTP-only apps with no storage emulator
at all, which avoids needing Azurite installed just to develop this. Verify the routes registered:

```bash
curl http://localhost:7071/api/withings/warmup
```

**`func start` reads env vars at startup only.** Changing `local.settings.json` needs a restart.

### 2. Tests

```bash
npm run test
```

Vitest, same posture as the SPA's: no jsdom, pure logic only, fake `HttpRequest`/`InvocationContext`
objects in `src/test/` rather than a real Functions runtime.

### 3. Deploy

```bash
azd auth login
azd env set WITHINGS_CLIENT_ID <id>
azd env set WITHINGS_CLIENT_SECRET <secret>
azd up
```

Provisions (see [infra/main.bicep](../infra/main.bicep)): a Flex Consumption Function App (Linux,
Node 22, scales to zero), its storage account, and Application Insights. `azd up` prints the
deployed `BROKER_URL` output — that's what goes into the SPA's `VITE_WITHINGS_BROKER_URL`.

**The Withings `client_secret` is stored as a plain Function App setting**, not a Key Vault
reference — app settings are already encrypted at rest and access-controlled via the Function
App's own RBAC, which is a reasonable default at this scale. If that's not enough for your threat
model, the upgrade path is a Key Vault resource plus an
`@Microsoft.KeyVault(SecretUri=...)` reference in `main.bicep`, using the Function's
already-provisioned system-assigned managed identity for access.

### 4. CI (optional)

[.github/workflows/deploy-function.yml](../.github/workflows/deploy-function.yml) redeploys on any
push touching `api/`, `infra/`, or `azure.yaml`. It authenticates via OIDC federated credentials —
no publish profile, no long-lived secret in GitHub. Needs, as repo secrets:
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `WITHINGS_CLIENT_SECRET`; and as repo
variables: `AZURE_LOCATION`, `WITHINGS_CLIENT_ID`, `WITHINGS_ALLOWED_ORIGINS`,
`WITHINGS_ALLOWED_REDIRECT_URIS`. Setting up the federated credential itself (an app registration
trusting `repo:<owner>/<repo>:ref:refs/heads/main`) is a one-time manual step in the Azure portal —
see [Microsoft's OIDC guide](https://learn.microsoft.com/azure/developer/github/connect-from-azure-openid-connect).

## CORS

Implemented entirely in [src/lib/cors.ts](src/lib/cors.ts), not the platform's own CORS setting.
If both emit `Access-Control-Allow-Origin`, the browser sees two values on the response and rejects
it outright — so the portal's CORS blade is left empty, and `local.settings.json` never sets
`Host.CORS`. The allowlist comes from the `ALLOWED_ORIGINS` app setting.

Origin checking here is a browser-abuse control, not a security boundary — `curl` sends whatever
`Origin` header it likes. The actual security boundary is the `client_secret` staying server-side.

## Known limitation

The broker is anonymous and public — anyone can call it. In practice they can't do much: minting a
token needs an authorization code, and those are only obtainable through Withings' own consent
screen and this app's registered redirect URI. But it is a free cost/availability surface, since
every call still reaches Withings' token endpoint. A budget alert on the resource group is the
cheap mitigation; a real per-IP rate limit (Azure Front Door / APIM) is the correct one if this
ever needs to withstand abuse rather than just accidents.
