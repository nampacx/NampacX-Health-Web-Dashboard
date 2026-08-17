import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * The lookback window used to live inside Dashboard's ControlsState, but a
 * Withings-only visitor never renders Controls, so they had no way to change
 * it. Lifted out so both sections share one control.
 */
interface TimeRangeState {
  lookbackDays: number
  setLookbackDays: (days: number) => void
}

/** Two weeks, so the Withings charts open with enough points to show a trend. */
const DEFAULT_LOOKBACK_DAYS = 14

const TimeRangeContext = createContext<TimeRangeState | null>(null)

export function TimeRangeProvider({ children }: { children: ReactNode }) {
  const [lookbackDays, setLookbackDays] = useState(DEFAULT_LOOKBACK_DAYS)
  const value = useMemo(() => ({ lookbackDays, setLookbackDays }), [lookbackDays])
  return <TimeRangeContext.Provider value={value}>{children}</TimeRangeContext.Provider>
}

export function useTimeRange(): TimeRangeState {
  const ctx = useContext(TimeRangeContext)
  if (!ctx) throw new Error('useTimeRange must be used inside <TimeRangeProvider>')
  return ctx
}
