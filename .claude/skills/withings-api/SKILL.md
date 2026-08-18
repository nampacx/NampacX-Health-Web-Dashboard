---
name: withings-api
description: Working knowledge of the Withings Health Data API (wbsapi.withings.net) — OAuth with rotating refresh tokens, the measure-type catalog, Getmeas, sleep/activity/heart services, webhooks, and the status-code contract. Use this whenever a task touches Withings scales, sleep mats, watches or blood-pressure monitors, measure types, `getmeas`, `access_token`/`refresh_token` handling, webhook notifications, or an unexplained Withings failure. Load it BEFORE writing token-refresh logic, parsing a measure group, or reading a `status` field — this API reports failures with HTTP 200 and rotates the credential that keeps you connected.
---

# Withings Health Data API

`https://wbsapi.withings.net`. Reads scales, sleep mats, watches, blood-pressure
monitors and thermometers from a user's Withings account.

Three facts that shape any integration:

- **It needs a `client_secret`, so it needs a backend.** The token exchange and
  every refresh are authenticated with the secret. A browser cannot hold one, so
  a pure SPA integration is impossible — you need a small server-side component
  for token operations, even if data fetching happens client-side.
- **Errors arrive as HTTP 200.** The transport succeeds and the body carries
  `status`. Code that checks `response.ok` and stops there treats every failure
  as success. See `references/services-and-status.md`.
- **The refresh token rotates on every use.** Each refresh returns a *new* one
  and starts a clock on the old. Losing the new one loses the connection, and
  the recovery path is "ask the user to re-authorize".

## The five that cost the most

**1. Every refresh issues a new refresh token, and the old one dies.** The
documented rule: the old token expires **8 hours after the new one is issued, or
immediately once the new access token is used** — whichever comes first. So:
persist the new token *synchronously* the moment a response parses, keep the
previous one as a fallback for that grace window, and single-flight refreshes so
two tabs cannot race and burn each other's credential.

**2. Only a genuine `invalid_grant` should ever clear a stored token.** A
network blip, a 5xx or a timeout must not look the same as a dead grant — treat
them as retryable. Deleting a year-long credential because Wi-Fi dropped
permanently breaks the link and forces re-authorization.

**3. Measure values are `value × 10^unit`.** `unit` is a *power of ten* and is
usually negative: `{value: 65750, unit: -3}` is 65.750 kg. Rendering `value`
raw produces numbers that are wrong by orders of magnitude but look plausible.

**4. A "measure group" is not a weigh-in.** `getmeas` returns everything the
account holds — a blood-pressure reading is a group too. Notably **heart pulse
(type 11) is emitted by both the BP monitor and scales**, so treating it as a
marker of a body-composition measurement files every BP reading as a weigh-in.
Decide group membership from types that only a scale reports.

**5. `category` separates measurements from goals.** `category: 1` is a real
measure; `category: 2` is a user *objective*. A weight goal rendered as a weigh-in
is a fabricated data point. Filter on it.

## Before you do X, check Y

| Doing this | Check this first |
|---|---|
| Writing token refresh | The rotation rules in `references/auth-and-tokens.md` |
| Parsing a measure | `value × 10^unit`, and `attrib` — see `references/measure-types.md` |
| Labelling a measure type | The catalog in `references/measure-types.md`. Several numbers are easy to confuse |
| Handling a failure | The status table in `references/services-and-status.md` — **not** the HTTP code |
| Polling for data | Don't. 120 req/min across the whole app; use webhooks |
| Choosing a scope | `user.metrics` vs `user.activity` split in `references/auth-and-tokens.md` |
| Building a redirect URI | Byte-for-byte match, **HTTPS only** — trailing slash included |

## Traps that produce plausible wrong numbers

These are the ones that do not throw, do not log, and quietly render something
believable:

- **`value × 10^unit` ignored** → 65750 kg.
- **`meastype` 130 (atrial fibrillation) is a classification, not a
  measurement.** Values 0–13 map to Negative / Positive / Inconclusive / … A
  generic numeric renderer shows "AF: 2".
- **`attrib` ignored.** `attrib: 1` means the measurement *may belong to another
  user* — an ambiguous reading on a shared scale. `2` and `4` are manually
  entered, `4` explicitly "may not be accurate".
- **Confusing neighbouring type numbers.** 123 is VO2 max; 168 is *extracellular
  water*. 170 is visceral fat. Getting these crossed renders a body-water figure
  as a fitness score, in a believable range.
- **Timestamps are UNIX seconds, not milliseconds.** `date` is when the measure
  was taken, `created` when it was stored, `modified` when last updated.
  Sync on `lastupdate`/`modified`; display `date`.

## Pagination and sync

`getmeas` returns `more: 1` and `offset: N` when there is more. Loop until `more`
is falsy, feeding `offset` back in. **Deduplicate by `grpid`** across page
boundaries — groups can repeat, and a re-measured group is *updated* in place
rather than appended, so the same `grpid` legitimately reappears with new values.

For incremental sync use `lastupdate` rather than `startdate`/`enddate`: it
catches measurements that were back-dated or edited after the fact, which a date
window silently misses.

## Reference files

| File | What it answers |
|---|---|
| `references/auth-and-tokens.md` | OAuth flow, scopes, token lifetimes and rotation, request signing, demo mode |
| `references/measure-types.md` | Every `meastype`, the measure/measure-group shape, `attrib`, `category` |
| `references/services-and-status.md` | Every service and action, webhook categories, the full status-code table, rate limits |
