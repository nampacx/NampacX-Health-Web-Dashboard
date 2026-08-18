import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ExerciseDayTotal } from '../api/google/exercise'
import ExerciseBarChart from './ExerciseBarChart'

const days: ExerciseDayTotal[] = [
  {
    dateKey: '2026-08-16',
    day: new Date(Date.UTC(2026, 7, 16)),
    sessions: 2,
    durationMs: 60 * 60 * 1000,
    byType: [{ typeKey: 'weightlifting', label: 'Weightlifting', sessions: 2, durationMs: 60 * 60 * 1000 }],
  },
  {
    dateKey: '2026-08-17',
    day: new Date(Date.UTC(2026, 7, 17)),
    sessions: 1,
    durationMs: 17 * 60 * 1000,
    byType: [{ typeKey: 'cardio_workout', label: 'Cardio workout', sessions: 1, durationMs: 17 * 60 * 1000 }],
  },
]

describe('ExerciseBarChart', () => {
  it('renders the detail panel even before hover and defaults it to the latest day', () => {
    const markup = renderToStaticMarkup(createElement(ExerciseBarChart, { days }))
    expect(markup).toContain('class="exercise-day-detail"')
    expect(markup).toContain('17 min total')
    expect(markup).toContain('Cardio workout')
  })

  it('does not render per-bar svg title tooltips', () => {
    const markup = renderToStaticMarkup(createElement(ExerciseBarChart, { days }))
    expect(markup).not.toContain('<title>')
  })
})
