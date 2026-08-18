# Measure types and the measure payload

## `Measure - Getmeas`

```
POST https://wbsapi.withings.net/measure
Authorization: Bearer <access_token>

action=getmeas
meastype=1                 # one type, or…
meastypes=1,4,12           # …a comma-separated list
category=1                 # 1 = real measures, 2 = user objectives
startdate=<unix>&enddate=<unix>
lastupdate=<unix>          # everything created/updated since — use for sync
offset=<n>                 # from a previous response's `offset`
```

Scope: `user.metrics`.

Response:

```json
{ "status": 0,
  "body": { "updatetime": "...", "timezone": "Europe/Paris",
            "measuregrps": [ ... ], "more": 1, "offset": 300 } }
```

`more`/`offset` drive pagination. `lastupdate` beats a date window for
incremental sync — it catches back-dated and edited measurements that a
`startdate`/`enddate` query silently misses.

## The measure group

```json
{ "grpid": 12, "attrib": 0, "category": 1,
  "date": 1594245600, "created": 1594246600, "modified": 1594257200,
  "deviceid": "...", "hash_deviceid": "...",
  "measures": [ { "value": 65750, "type": 1, "unit": -3 } ] }
```

A group bundles measures taken **at the same moment** — a blood-pressure reading
arrives as one group holding systolic, diastolic and pulse. Groups are updated in
place when a measurement is re-taken, so **the same `grpid` can reappear with new
values**: dedupe on `grpid`, and prefer the newer `modified`.

Timestamps are **UNIX seconds**. `date` = when measured, `created` = when stored,
`modified` = when last changed.

### `value × 10^unit`

`unit` is a power of ten, usually negative. `{value: 65750, unit: -3}` →
**65.750 kg**. Never render `value` on its own.

### `category`

`1` = a real measurement. `2` = a user **objective** (a goal). Rendering a
category-2 row as a measurement invents a data point the user never recorded.

### `attrib` — how the measure was attributed

| Value | Meaning |
|---|---|
| 0 | Captured by a device, known to belong to this user |
| 1 | Captured by a device but **may belong to another user** — ambiguous |
| 2 | Entered manually for this user |
| 4 | Entered manually during user creation — **may not be accurate** |
| 5 | Auto; blood-pressure monitor only, the device's computed best value |
| 7 | Confirmed — the user confirmed a detected activity |
| 8 | Same as 0 |
| 15 | Performed under specific guided conditions (Nerve Health Score) |

Ignoring `attrib` means a shared household scale's ambiguous readings (1) and
setup-time guesses (4) render exactly like verified ones.

## `meastype` catalog

From the `Measure - Getmeas` reference. Neighbouring numbers are easy to
transpose — check against this table rather than memory.

| Type | Meaning | Unit |
|---|---|---|
| 1 | Weight | kg |
| 4 | Height | m |
| 5 | Fat Free Mass | kg |
| 6 | Fat Ratio | % |
| 8 | Fat Mass Weight | kg |
| 9 | Diastolic Blood Pressure | mmHg |
| 10 | Systolic Blood Pressure | mmHg |
| 11 | Heart Pulse | bpm — **BPM and scale devices only** |
| 12 | Temperature | °C |
| 54 | SpO₂ | % |
| 71 | Body Temperature | °C |
| 73 | Skin Temperature | °C |
| 76 | Muscle Mass | kg |
| 77 | Hydration | kg |
| 88 | Bone Mass | kg |
| 91 | Pulse Wave Velocity | m/s |
| 123 | **VO2 max** | ml/min/kg |
| 130 | **Atrial fibrillation result** | classification — see below |
| 135 | QRS interval duration (ECG) | ms |
| 136 | PR interval duration (ECG) | ms |
| 137 | QT interval duration (ECG) | ms |
| 138 | Corrected QT interval duration (ECG) | ms |
| 139 | Atrial fibrillation result from PPG | classification |
| 155 | Vascular age | years |
| 167 | Nerve Health Score, conductance 2 electrodes (feet) | |
| 168 | **Extracellular Water** | kg |
| 169 | **Intracellular Water** | kg |
| 170 | **Visceral Fat** | no unit |
| 173 | Fat Free Mass for segments | |
| 174 | Fat Mass for segments | mass |
| 175 | Muscle Mass for segments | |
| 196 | Nerve Response Score (NRS) | |
| 226 | Basal Metabolic Rate (BMR) | kcal |
| 227 | Metabolic Age | years |
| 229 | Electrochemical Skin Conductance (ESC) | |

**The confusable set:** `123` VO2 max vs `168` extracellular water vs `170`
visceral fat. Crossing these renders a body-water figure (~15–20) as a VO2 max
score — a completely believable number in the wrong field.

### Type 130 is not a measurement

Atrial fibrillation results are classification integers, not physical values:

| 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Negative | Positive | Inconclusive | No signal | Other | Noise | Low HR |

| 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|---|---|---|---|---|---|---|
| High HR | Inconclusive US | Negative normal HR | Negative high HR | Positive normal HR | Positive high HR | No Diagnosis |

A generic `value × 10^unit` renderer turns this into a meaningless number.
Type 139 (AF from PPG) is the same kind of field.

## Catalog design advice

Three questions look like one and are not. Keep them as separate lists:

1. **What is this type called, in what unit, at what precision?** — a labelling
   catalog. It should *not* filter: an unknown type should still render as
   `Type <n>` so new firmware metrics appear rather than vanish.
2. **Does this group count as a weigh-in / a BP reading / …?** — membership. Must
   be written out explicitly. Deriving it from the labelling catalog is a live
   bug: heart pulse (11) is in any sensible label list but is emitted by the
   blood-pressure monitor, so a derived set files every BP reading as a weigh-in.
3. **Which measures does a card actually show?** — presentation. Adding a label
   for debugging should never silently add a row to a card.
