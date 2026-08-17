import { useMemo } from 'react'
import {
  CATEGORY_ORDER,
  DATA_TYPES,
  DEFAULT_SELECTED_IDS,
  FOCUS_IDS,
} from '../api/google/dataTypes'
import type { DataTypeDef } from '../api/google/types'
// The shape lives with the state that owns it, in state/googleData.tsx.
import type { GoogleControlsState } from '../state/googleData'

interface Props {
  state: GoogleControlsState
  onChange: (next: GoogleControlsState) => void
  onRefresh: () => void
  loading: boolean
}

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50]

const PRESETS: Array<{ label: string; ids: string[] }> = [
  { label: 'Default', ids: DEFAULT_SELECTED_IDS },
  { label: 'All activity + sleep', ids: FOCUS_IDS },
  { label: 'Everything', ids: DATA_TYPES.map((d) => d.id) },
  { label: 'None', ids: [] },
]

export default function Controls({ state, onChange, onRefresh, loading }: Props) {
  const grouped = useMemo(() => {
    const byCategory = new Map<string, DataTypeDef[]>()
    for (const dataType of DATA_TYPES) {
      const bucket = byCategory.get(dataType.category) ?? []
      bucket.push(dataType)
      byCategory.set(dataType.category, bucket)
    }
    return Array.from(byCategory.entries()).sort(
      ([a], [b]) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b),
    )
  }, [])

  function toggle(id: string) {
    const selected = new Set(state.selectedIds)
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    onChange({ ...state, selectedIds: Array.from(selected) })
  }

  return (
    <section className="card controls">
      <div className="controls-row">
        <label className="field">
          <span>Rows per data type</span>
          <select
            value={state.pageSize}
            onChange={(event) => onChange({ ...state, pageSize: Number(event.target.value) })}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <label className="field field-grow">
          <span>Filter results</span>
          <input
            type="search"
            placeholder="e.g. walking, sleep, 2026-08"
            value={state.query}
            onChange={(event) => onChange({ ...state, query: event.target.value })}
          />
        </label>

        <label className="field field-inline">
          <input
            type="checkbox"
            checked={state.showAll}
            onChange={(event) => onChange({ ...state, showAll: event.target.checked })}
          />
          <span>Show all activities</span>
        </label>

        <button type="button" className="btn" onClick={onRefresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <details className="picker">
        <summary>
          Data types <span className="pill">{state.selectedIds.length} selected</span>
        </summary>

        <div className="presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="btn btn-small"
              onClick={() => onChange({ ...state, selectedIds: preset.ids })}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {grouped.map(([category, dataTypes]) => (
          <div key={category} className="picker-group">
            <h3>{category}</h3>
            <div className="chips">
              {dataTypes.map((dataType) => {
                const active = state.selectedIds.includes(dataType.id)
                return (
                  <button
                    key={dataType.id}
                    type="button"
                    className={active ? 'chip chip-active' : 'chip'}
                    aria-pressed={active}
                    onClick={() => toggle(dataType.id)}
                  >
                    {dataType.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </details>
    </section>
  )
}
