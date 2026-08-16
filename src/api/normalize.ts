import type { DataTypeDef, HealthRecord, RawDataPoint } from '../types'

/**
 * Data point payloads are not documented field-by-field for every data type, and
 * new fields appear over time. Rather than hard-coding a shape per data type,
 * everything here works structurally: find the payload, find a timestamp in it,
 * then flatten whatever leaves remain into displayable pairs. Anything not
 * understood still shows up under "raw JSON" in the UI.
 */

const ENVELOPE_KEYS = new Set(['name', 'dataSource'])

/** `daily-resting-heart-rate` -> `dailyRestingHeartRate` */
function toCamelCase(dataTypeId: string): string {
  return dataTypeId.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

type Json = Record<string, unknown>

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The payload sits under a key named after the data type, e.g. `exercise`. */
function extractPayload(point: RawDataPoint, dataType: DataTypeDef): Json {
  const expected = point[toCamelCase(dataType.id)]
  if (isPlainObject(expected)) return expected

  for (const [key, value] of Object.entries(point)) {
    if (!ENVELOPE_KEYS.has(key) && isPlainObject(value)) return value
  }
  return {}
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null
  // Civil timestamps carry no zone; the Date constructor reads them as local,
  // which is the intended reading for a "civil" time.
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Ordered by how well each field represents "when this happened". */
const TIMESTAMP_PATHS = [
  'interval.endTime',
  'interval.startTime',
  'interval.civilEndTime',
  'interval.civilStartTime',
  'endTime',
  'startTime',
  'time',
  'civilTime',
  'date',
  'civilDate',
  'logTime',
  'updateTime',
]

function readPath(source: Json, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    return isPlainObject(acc) ? acc[segment] : undefined
  }, source)
}

function extractTimestamp(payload: Json): Date | null {
  for (const path of TIMESTAMP_PATHS) {
    const parsed = parseDate(readPath(payload, path))
    if (parsed) return parsed
  }
  return null
}

interface Leaf {
  path: string
  value: string | number | boolean
}

/** Paths that describe *when*, not *what* — the UI renders time separately. */
const TIME_NOISE = /(^|\.)(interval|updateTime|createTime|logTime|.*UtcOffset)($|\.)/

function flatten(value: unknown, prefix: string, out: Leaf[], depth = 0): void {
  if (depth > 3) return

  if (Array.isArray(value)) {
    if (value.length === 0) return
    // Arrays of scalars read fine inline; arrays of objects would flood the row.
    if (value.every((item) => typeof item !== 'object' || item === null)) {
      out.push({ path: prefix, value: value.join(', ') })
    } else {
      out.push({ path: prefix, value: `${value.length} entries` })
    }
    return
  }

  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out, depth + 1)
    }
    return
  }

  if (value === null || value === undefined || value === '') return
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out.push({ path: prefix, value })
  }
}

/**
 * Unit-carrying suffixes. `formatLeaf` renders these into the value itself, so
 * leaving them in the label yields "Duration millis: 8 h 15 min".
 */
const UNIT_SUFFIX =
  /\s+(kcal|millim[ie]ters|millis|milliseconds|seconds|minutes|percent|percentage|kilograms?|grams?|centimeters|meters|milliliters|celsius|bpm)$/i

/** camelCase path -> "Calories" (the unit lives in the formatted value) */
function humanizePath(path: string): string {
  const last = path.split('.').pop() ?? path
  const words = last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
  // Only strip when something meaningful survives: a bare "minutes" field has
  // nothing else to go by.
  const trimmed = words.replace(UNIT_SUFFIX, '').trim()
  const label = trimmed || words
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** int64 fields arrive as strings, so numeric strings count as numbers here. */
function asNumber(value: Leaf['value']): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value)
  return null
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

/** Protobuf durations serialise as e.g. "900s". */
function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
  if (minutes > 0) return `${minutes} min`
  return `${seconds} s`
}

/**
 * Google Health encodes units in the field name (`caloriesKcal`,
 * `distanceMillimiters`), so the suffix is what gets read here.
 */
function formatLeaf(leaf: Leaf): string {
  const key = leaf.path.split('.').pop() ?? leaf.path
  const numeric = asNumber(leaf.value)

  if (typeof leaf.value === 'string' && /^\d+(\.\d+)?s$/.test(leaf.value)) {
    return formatDurationSeconds(Number(leaf.value.slice(0, -1)))
  }

  if (numeric === null) {
    if (typeof leaf.value === 'boolean') return leaf.value ? 'Yes' : 'No'
    // Enum values arrive SCREAMING_SNAKE_CASE.
    if (typeof leaf.value === 'string' && /^[A-Z][A-Z0-9_]+$/.test(leaf.value)) {
      return leaf.value.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
    }
    return String(leaf.value)
  }

  // `Millimiters` is the spelling used by the API for distance fields.
  if (/milli(m[ie]ters)$/i.test(key)) {
    const meters = numeric / 1000
    return meters >= 1000
      ? `${numberFormat.format(meters / 1000)} km`
      : `${numberFormat.format(meters)} m`
  }
  if (/kcal$/i.test(key)) return `${numberFormat.format(numeric)} kcal`
  if (/(bpm|beatsperminute)$/i.test(key)) return `${numberFormat.format(numeric)} bpm`
  if (/percent(age)?$/i.test(key)) return `${numberFormat.format(numeric)} %`
  if (/kilograms?$/i.test(key)) return `${numberFormat.format(numeric)} kg`
  if (/grams?$/i.test(key)) return `${numberFormat.format(numeric)} g`
  if (/(centimeters|cm)$/i.test(key)) return `${numberFormat.format(numeric)} cm`
  if (/meters?$/i.test(key)) return `${numberFormat.format(numeric)} m`
  if (/milliliters?$/i.test(key)) return `${numberFormat.format(numeric)} ml`
  // Sleep durations tend to arrive as millisecond or minute counts.
  if (/milli(s|seconds)$/i.test(key)) return formatDurationSeconds(numeric / 1000)
  if (/seconds$/i.test(key)) return formatDurationSeconds(numeric)
  // Under an hour, "45 min" beats "45 min" via the h/m formatter's rounding.
  if (/minutes$/i.test(key)) {
    return numeric < 60 ? `${numberFormat.format(numeric)} min` : formatDurationSeconds(numeric * 60)
  }
  if (/^duration$/i.test(key)) return formatDurationSeconds(numeric)
  if (/efficiency$/i.test(key)) return `${numberFormat.format(numeric)} %`
  if (/celsius$/i.test(key)) return `${numberFormat.format(numeric)} °C`

  return numberFormat.format(numeric)
}

function lastSegment(path: string): string {
  return (path.split('.').pop() ?? path).toLowerCase()
}

/**
 * Finds the leaf a data type would rather lead with. Exact matches on the final
 * path segment win; a substring match is accepted as a second pass so that
 * e.g. `totalDistanceMillimiters` still answers to `distance`.
 */
function findPreferred(leaves: Leaf[], keys: string[]): Leaf | undefined {
  for (const key of keys) {
    const wanted = key.toLowerCase()
    const exact = leaves.find((leaf) => lastSegment(leaf.path) === wanted)
    if (exact) return exact
  }
  for (const key of keys) {
    const wanted = key.toLowerCase()
    const loose = leaves.find((leaf) => lastSegment(leaf.path).includes(wanted))
    if (loose) return loose
  }
  return undefined
}

/**
 * Picks the headline value: the data type's preferred field if it turned up,
 * then `displayName` (exercise rows read best as "Walk"), then the first
 * numeric leaf. The chosen leaf is returned so the caller can keep it out of
 * the detail chips.
 */
function buildSummary(
  leaves: Leaf[],
  summaryKeys: string[] | undefined,
): { text: string | null; leaf: Leaf | null } {
  const preferred = summaryKeys ? findPreferred(leaves, summaryKeys) : undefined
  if (preferred) {
    // A named activity ("Walk") is the whole story; a number needs its label.
    if (lastSegment(preferred.path) === 'displayname') {
      return { text: String(preferred.value), leaf: preferred }
    }
    return { text: `${humanizePath(preferred.path)}: ${formatLeaf(preferred)}`, leaf: preferred }
  }

  const named = leaves.find((leaf) => leaf.path.endsWith('displayName'))
  if (named) return { text: String(named.value), leaf: named }

  const chosen = leaves.find((leaf) => asNumber(leaf.value) !== null) ?? leaves[0]
  if (!chosen) return { text: null, leaf: null }

  return { text: `${humanizePath(chosen.path)}: ${formatLeaf(chosen)}`, leaf: chosen }
}

export function normalizeDataPoint(
  point: RawDataPoint,
  dataType: DataTypeDef,
  index: number,
): HealthRecord {
  const payload = extractPayload(point, dataType)

  const leaves: Leaf[] = []
  flatten(payload, '', leaves)
  const displayable = leaves.filter((leaf) => !TIME_NOISE.test(leaf.path))

  const summary = buildSummary(displayable, dataType.summaryKeys)

  const details = displayable
    .filter((leaf) => leaf !== summary.leaf)
    .slice(0, 8)
    .map((leaf) => ({ label: humanizePath(leaf.path), value: formatLeaf(leaf) }))

  const platform = point.dataSource?.platform
  const method = point.dataSource?.recordingMethod
  const source = [platform, method].filter((part): part is string => typeof part === 'string').join(' · ')

  return {
    key: point.name ?? `${dataType.id}:${index}`,
    dataType,
    timestamp: extractTimestamp(payload),
    summary: summary.text,
    details,
    source: source || null,
    raw: point,
  }
}
