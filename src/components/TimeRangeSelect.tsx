import { useTimeRange } from '../state/timeRange'

const LOOKBACK_OPTIONS = [
  { value: 1, label: 'Last 24 hours' },
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 0, label: 'No time filter' },
]

/** Shared between the Google and Withings sections; see src/state/timeRange.tsx. */
export default function TimeRangeSelect() {
  const { lookbackDays, setLookbackDays } = useTimeRange()

  return (
    <section className="card">
      <label className="field">
        <span>Time range</span>
        <select value={lookbackDays} onChange={(event) => setLookbackDays(Number(event.target.value))}>
          {LOOKBACK_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  )
}
