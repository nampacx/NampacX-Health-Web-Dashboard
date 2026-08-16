import type { HealthRecord } from '../types'

export interface DayGroup {
  key: string
  label: string
  /** Distinct data types present that day, for the group subheading. */
  types: string[]
  records: HealthRecord[]
}

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dayLabel(date: Date): string {
  const today = new Date()
  if (dayKey(date) === dayKey(today)) return 'Today'

  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday'

  return dayFormat.format(date)
}

/**
 * Buckets records by calendar day. Activity and sleep are inherently daily, so
 * a flat list forces the reader to do this grouping in their head.
 *
 * Input is expected newest-first (as `fetchLatestRecords` returns it); groups
 * come back in that same order, with undated records collected at the end.
 */
export function groupByDay(records: HealthRecord[]): DayGroup[] {
  const groups = new Map<string, HealthRecord[]>()
  const undated: HealthRecord[] = []

  for (const record of records) {
    if (!record.timestamp) {
      undated.push(record)
      continue
    }
    const key = dayKey(record.timestamp)
    const bucket = groups.get(key)
    if (bucket) bucket.push(record)
    else groups.set(key, [record])
  }

  const result: DayGroup[] = Array.from(groups.entries()).map(([key, dayRecords]) => ({
    key,
    // Every record in the bucket shares a day, so the first timestamp labels it.
    label: dayLabel(dayRecords[0].timestamp as Date),
    types: Array.from(new Set(dayRecords.map((r) => r.dataType.label))),
    records: dayRecords,
  }))

  if (undated.length > 0) {
    result.push({
      key: 'undated',
      label: 'No timestamp',
      types: Array.from(new Set(undated.map((r) => r.dataType.label))),
      records: undated,
    })
  }

  return result
}
