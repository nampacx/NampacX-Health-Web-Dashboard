import { useCallback, useState } from 'react'

/** Top level: one tab per data source. */
export const TAB_IDS = ['google', 'withings', 'technical'] as const
export type TabId = (typeof TAB_IDS)[number]

export const TAB_LABELS: Record<TabId, string> = {
  google: 'Google Health',
  withings: 'Withings',
  technical: 'Technical details',
}

/**
 * Inside the Google tab. Sleep used to sit at the top level beside Google
 * Health, which read as a third provider — it is not, it is one view of the
 * same records, and it needs the same data-type selection and time range as
 * the activity list.
 */
export const GOOGLE_TAB_IDS = ['sleep', 'exercise', 'activity'] as const
export type GoogleTabId = (typeof GOOGLE_TAB_IDS)[number]

export const GOOGLE_TAB_LABELS: Record<GoogleTabId, string> = {
  sleep: 'Sleep',
  exercise: 'Exercise',
  activity: 'All activity',
}

/**
 * Remembers the open tab for the tab's lifetime, so a refresh — which happens
 * a lot while debugging, which is what the technical tab is for — does not
 * bounce you back to the first tab. sessionStorage rather than localStorage to
 * match how the Google token is scoped: the session dies with the tab.
 */
function useStoredTab<T extends string>(
  ids: readonly T[],
  storageKey: string,
  initial: T,
): [T, (next: T) => void] {
  const [tab, setTabState] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(storageKey)
      return stored !== null && (ids as readonly string[]).includes(stored) ? (stored as T) : initial
    } catch {
      // Private-mode Safari and friends throw on storage access.
      return initial
    }
  })

  const setTab = useCallback(
    (next: T) => {
      setTabState(next)
      try {
        sessionStorage.setItem(storageKey, next)
      } catch {
        // Losing the preference is not worth breaking navigation over.
      }
    },
    [storageKey],
  )

  return [tab, setTab]
}

export function useTabState(initial: TabId = 'google') {
  return useStoredTab(TAB_IDS, 'ghd.tab', initial)
}

/** Separate storage key, so the two tab bars remember themselves independently. */
export function useGoogleTabState(initial: GoogleTabId = 'sleep') {
  return useStoredTab(GOOGLE_TAB_IDS, 'ghd.tab.google', initial)
}
