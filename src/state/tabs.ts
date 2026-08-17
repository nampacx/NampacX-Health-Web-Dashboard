import { useCallback, useState } from 'react'

export const TAB_IDS = ['google', 'sleep', 'withings', 'technical'] as const
export type TabId = (typeof TAB_IDS)[number]

export const TAB_LABELS: Record<TabId, string> = {
  google: 'Google Health',
  sleep: 'Sleep',
  withings: 'Withings',
  technical: 'Technical details',
}

/** Tabs that need the Google session. Sleep is Google data under its own tab. */
export const GOOGLE_TABS: readonly TabId[] = ['google', 'sleep']

const STORAGE_KEY = 'ghd.tab'

function isTabId(value: string | null): value is TabId {
  return value !== null && (TAB_IDS as readonly string[]).includes(value)
}

/**
 * Remembers the open tab for the tab's lifetime, so a refresh — which happens
 * a lot while debugging, which is what the technical tab is for — does not
 * bounce you back to the first tab. sessionStorage rather than localStorage to
 * match how the Google token is scoped: the session dies with the tab.
 */
export function useTabState(initial: TabId = 'google'): [TabId, (next: TabId) => void] {
  const [tab, setTabState] = useState<TabId>(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY)
      return isTabId(stored) ? stored : initial
    } catch {
      // Private-mode Safari and friends throw on storage access.
      return initial
    }
  })

  const setTab = useCallback((next: TabId) => {
    setTabState(next)
    try {
      sessionStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Losing the preference is not worth breaking navigation over.
    }
  }, [])

  return [tab, setTab]
}
