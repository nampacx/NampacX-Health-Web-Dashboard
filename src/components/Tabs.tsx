import { useRef, type KeyboardEvent } from 'react'

export interface TabItem<T extends string> {
  id: T
  label: string
  /** Short count shown beside the label, e.g. "12" or "2 !". */
  badge?: string
}

interface Props<T extends string> {
  items: readonly TabItem<T>[]
  active: T
  onChange: (next: T) => void
  /** aria-label for the tablist — says what the tabs switch between. */
  label: string
  /**
   * Namespaces the element ids. Load-bearing once tab bars nest: the Google
   * panel contains its own tablist, and two `id="tab-sleep"` elements would
   * break `aria-controls` for both of them.
   */
  idPrefix: string
  /** `sub` renders the smaller in-panel bar. */
  variant?: 'primary' | 'sub'
}

export function tabButtonId(prefix: string, tab: string): string {
  return `${prefix}-tab-${tab}`
}

export function tabPanelId(prefix: string, tab: string): string {
  return `${prefix}-panel-${tab}`
}

export default function Tabs<T extends string>({
  items,
  active,
  onChange,
  label,
  idPrefix,
  variant = 'primary',
}: Props<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement>())

  // Arrow keys move between tabs, which the tab role implies and keyboard
  // users expect; without it the tablist is a dead end for them.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (offset === 0) return
    event.preventDefault()
    const index = items.findIndex((item) => item.id === active)
    const next = items[(index + offset + items.length) % items.length].id
    onChange(next)
    refs.current.get(next)?.focus()
  }

  return (
    <div
      className={variant === 'sub' ? 'tabs tabs-sub' : 'tabs'}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        const selected = item.id === active
        return (
          <button
            key={item.id}
            ref={(node) => {
              if (node) refs.current.set(item.id, node)
              else refs.current.delete(item.id)
            }}
            type="button"
            role="tab"
            id={tabButtonId(idPrefix, item.id)}
            className={selected ? 'tab tab-active' : 'tab'}
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, item.id)}
            // Only the active tab is in the tab order; arrow keys reach the rest.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {item.badge && <span className="tab-badge">{item.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}
