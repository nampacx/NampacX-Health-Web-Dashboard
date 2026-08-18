---
name: google-health-api
description: Working knowledge of the Google Health API (health.googleapis.com/v4) — the data-type catalog, OAuth scopes, reading data points, filters, rollups, and the payload shapes. Use this whenever a task touches Google Health data types, scopes, sleep/exercise/nutrition/profile data, dataPoints.list or dailyRollUp, GPS/TCX export, or an unexplained 400/403 from health.googleapis.com. Load it BEFORE adding a data type, widening scopes, writing a filter, or parsing a payload — several of this API's rules are the opposite of what its own documentation first suggests.
---

# Google Health API

`https://health.googleapis.com/v4`. Reads Fitbit / Pixel Watch data through the
same account that feeds the Google Health app.

Two facts that shape everything else:

- **It is CORS-open.** It returns `Access-Control-Allow-Origin` for arbitrary
  origins and accepts the `authorization` header, so a browser can call it
  directly. A backend proxy is not required and adding one buys nothing.
- **The documentation contradicts itself in specific, expensive ways.** Most of
  this skill is those contradictions. Trust the tables in `references/`, and
  verify anything else against the *REST* reference — never the RPC one.

## The five that cost the most

**1. The RPC reference does not describe the REST JSON.** Field names in
`google.devicesandservices.health.v4` differ from what the API actually sends —
not subtly, but completely. Writing a parser from the RPC page produces code
where every read misses while the tests pass, because the tests were built from
the same wrong names. Sleep is the worst offender; see
`references/payload-shapes.md`.

**2. A `.readonly` scope in the Cloud console does not mean the data is
readable.** The console offers `reproductive_health.readonly`,
`logged_symptoms.readonly` and `mindfulness.readonly`. Nothing anywhere in v4
accepts them: `dataPoints.list` takes a **closed set** of seven scopes, and those
three are not on it. The four data types behind them are create/update/delete
only. Granting them widens the consent screen — with the most sensitive wording
available — and returns nothing.

**3. Three data types cannot be listed at all.** `floors`, `total-calories` and
`calories-in-heart-rate-zone` answer `dataPoints.list` with a 400 naming the
operations they do support. They are readable only through
`dataPoints:dailyRollUp`, a POST with a different response shape.

**4. There is one filter grammar but five time fields**, chosen by the data
type's *record type*, plus two per-type exceptions. A wrong field is a 400 — and
if the caller falls back to an unfiltered request, the time range silently stops
applying while everything still looks fine.

**5. Civil time is not an instant.** Sessions carry the UTC offset they were
recorded at; civil timestamps carry no zone at all. Rendering either through the
viewer's zone agrees only while the viewer sits where the device did, and lies
silently after any travel.

## Before you do X, check Y

| Doing this | Check this first |
|---|---|
| Adding a data type | Its row in `references/data-types.md` — does it support `list`? What record type? |
| Adding a scope | Is it accepted by an actual method? See the scope table in `references/reading-data.md` |
| Writing a filter | The record-type → field table in `references/reading-data.md` |
| Parsing a payload | `references/payload-shapes.md` — several shapes are not what the name suggests |
| Debugging a 400 | Almost always: wrong filter field, unlistable data type, or a rollup range over the cap |
| Debugging a 403 | A scope that was never granted, or a method needing **two** scopes (TCX export) |
| Expecting a field to exist | The "does not exist" list below — several obvious ones genuinely do not |

## Things that do not exist

Do not go looking for these; they are absent by design, and search results
conflating this API with Google Fit or Health Connect are the usual source of
the confusion.

- **Sleep score, readiness, recovery.** Computed in the app and on the watch. No
  data type and no message field carries them.
- **Sets, reps, resistance.** Google *Fit* had `repetitions` and `resistance`;
  they did not survive into this API, and Health Connect has no field either. A
  strength session is a labelled time window.
- **Latitude and longitude — anywhere.** The whole `DataPoint` union has two
  location-adjacent fields, both booleans/scalars in `exercise.metadata`. Routes
  exist only as a TCX file from a separate method.
- **Name, birth date, sex on the profile.** It exposes an *age* derived from the
  birth date, never the date. Height and weight are separate data types.
- **A total-fat nutrient.** The `Nutrient` enum breaks fat into saturated, trans,
  mono- and poly-unsaturated and never totals it.

## Reference files

| File | What it answers |
|---|---|
| `references/data-types.md` | Every data type: id, record type, supported operations, scope |
| `references/reading-data.md` | Scopes, `list`, filters, pagination, `dailyRollUp`, the non-dataPoint endpoints |
| `references/payload-shapes.md` | The payloads whose shape surprises — sleep, exercise, nutrition, profile, rollup values |

## Working style that suits this API

- **Parse structurally, not per type, wherever you can.** Payloads are
  undocumented field-by-field for many types and grow new fields over time. A
  flattener that finds a timestamp and renders the remaining leaves degrades
  gracefully when a field is renamed; a hand-written schema blanks out.
- **Except where a structure cannot survive flattening.** Arrays of objects —
  sleep stages, nutrition `nutrients[]` — collapse to "N entries" and need a
  typed parser. That is the whole test: can a flattener represent it?
- **Fail per data type, never per load.** One type's 400 must not empty the
  screen. Collect per-type outcomes and show them.
- **Capture a real payload before trusting a field name.** A synthetic fixture
  only proves the parser agrees with itself.
