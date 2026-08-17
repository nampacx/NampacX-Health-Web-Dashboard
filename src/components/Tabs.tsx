import { useRef, type KeyboardEvent } from 'react'
import { TAB_IDS, TAB_LABELS, type TabId } from '../state/tabs'

interface Props {
  active: TabId
  onChange: (next: TabId) => void
  /** Short counts shown beside each label, e.g. "12" or "2 issues". */
  badges?: Partial<Record<TabId, string>>
}

export function tabPanelId(tab: TabId): string {
  return `panel-${tab}`
}

export default function Tabs({ active, onChange, badges }: Props) {
  const refs = useRef(new Map<TabId, HTMLButtonElement>())

  // Arrow keys move between tabs, which the tab role implies and keyboard
  // users expect; without it the tablist is a dead end for them.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (offset === 0) return
    event.preventDefault()
    const index = TAB_IDS.indexOf(active)
    const next = TAB_IDS[(index + offset + TAB_IDS.length) % TAB_IDS.length]
    onChange(next)
    refs.current.get(next)?.focus()
  }

  return (
    <div className="tabs" role="tablist" aria-label="Data source" onKeyDown={onKeyDown}>
      {TAB_IDS.map((tab) => {
        const selected = tab === active
        const badge = badges?.[tab]
        return (
          <button
            key={tab}
            ref={(node) => {
              if (node) refs.current.set(tab, node)
              else refs.current.delete(tab)
            }}
            type="button"
            role="tab"
            id={`tab-${tab}`}
            className={selected ? 'tab tab-active' : 'tab'}
            aria-selected={selected}
            aria-controls={tabPanelId(tab)}
            // Only the active tab is in the tab order; arrow keys reach the rest.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab)}
          >
            {TAB_LABELS[tab]}
            {badge && <span className="tab-badge">{badge}</span>}
          </button>
        )
      })}
    </div>
  )
}
