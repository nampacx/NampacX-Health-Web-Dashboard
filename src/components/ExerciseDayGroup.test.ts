import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import ExerciseDayGroup from './ExerciseDayGroup'

vi.mock('./ExerciseCard', () => ({
  default: () => createElement('li', null, 'Mock session'),
}))

describe('ExerciseDayGroup', () => {
  it('renders its expander collapsed by default', () => {
    const markup = renderToStaticMarkup(
      createElement(
        'ul',
        null,
        createElement(ExerciseDayGroup, {
          group: {
            dateKey: '2026-08-17',
            day: new Date('2026-08-17T00:00:00.000Z'),
            sessions: [
              {
                key: 's1',
                title: 'Morning Trail Run',
                exerciseType: 'RUNNING',
                start: new Date('2026-08-17T06:00:00.000Z'),
                end: new Date('2026-08-17T06:30:00.000Z'),
                utcOffsetSeconds: 7200,
                durationMs: 1_800_000,
                durationIsActive: true,
                stats: [],
                splits: 0,
                hasGps: false,
                dataPointId: null,
                raw: {},
              },
            ],
          },
        }),
      ),
    )

    expect(markup).toContain('<details>')
    expect(markup).not.toMatch(/<details[^>]*\bopen\b/)
  })
})
