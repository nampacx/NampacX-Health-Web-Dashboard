import { useMemo } from 'react'
import { MACROS, nutritionTotals } from '../api/google/nutrition'
import { useGoogleData } from '../state/googleData'
import NutritionDayCard from './NutritionDayCard'

const gramFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const kcalFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

export default function NutritionSection() {
  const { controls, setControls, nutrition, loading, loadedAt } = useGoogleData()

  const totals = useMemo(() => nutritionTotals(nutrition), [nutrition])

  const selected = controls.selectedIds.includes('nutrition-log')
  const partialDays = nutrition.filter((day) => day.partial).length

  return (
    <>
      <div className="list-header">
        <h2>Nutrition</h2>
        <span className="muted">
          {nutrition.length} {nutrition.length === 1 ? 'day' : 'days'}
          {loadedAt && ` · updated ${loadedAt.toLocaleTimeString()}`}
        </span>
      </div>

      {!selected && (
        <p className="banner banner-warn">
          The <code>nutrition-log</code> data type is not selected, so nothing can show up here.{' '}
          <button
            type="button"
            className="btn btn-small"
            onClick={() =>
              setControls({ ...controls, selectedIds: [...controls.selectedIds, 'nutrition-log'] })
            }
          >
            Load it
          </button>
        </p>
      )}

      {nutrition.length > 0 && (
        <div className="exercise-totals">
          <div className="sleep-stat">
            <span className="sleep-stat-label">Days logged</span>
            <span className="sleep-stat-value">{totals.days}</span>
            {/* The averages are over complete days only, so say so where the
                count would otherwise look like it disagrees with the cards. */}
            {partialDays > 0 && (
              <span className="muted sleep-stat-hint">
                +{partialDays} partial, not counted
              </span>
            )}
          </div>
          {totals.averageKcalPerDay !== null && (
            <div className="sleep-stat">
              <span className="sleep-stat-label">Average per day</span>
              <span className="sleep-stat-value">
                {kcalFormat.format(totals.averageKcalPerDay)} kcal
              </span>
            </div>
          )}
          {MACROS.map((macro) => (
            <div key={macro.id} className="sleep-stat">
              <span className="sleep-stat-label">{macro.label} total</span>
              <span className="sleep-stat-value">
                {gramFormat.format(totals.grams[macro.id])} g
              </span>
            </div>
          ))}
        </div>
      )}

      {loading && nutrition.length === 0 ? (
        <p className="muted">Loading your nutrition logs…</p>
      ) : nutrition.length === 0 ? (
        <section className="card empty">
          <h2>No nutrition logs</h2>
          <p className="muted">
            Nothing came back for this time range. Widen it, or check that the connected account has
            logged food — the API only returns what has already been entered in the Google Health or
            Fitbit app, and it has no way to estimate a meal that was never logged.
          </p>
        </section>
      ) : (
        <ul className="nutrition-list">
          {nutrition.map((day) => (
            <NutritionDayCard key={day.dateKey} day={day} />
          ))}
        </ul>
      )}

      {/* The two questions this view invites, answered before they are asked. */}
      <p className="muted sleep-footnote">
        Carbohydrate and fat come from the log's own <code>totalCarbohydrate</code> and{' '}
        <code>totalFat</code> fields; protein has no total field and is read out of the{' '}
        <code>nutrients</code> array. There is no total-fat entry in that array — it breaks fat down
        into saturated, trans and unsaturated — so the fat figure is whatever the log's own total
        says, never a sum of the parts.
      </p>

      <p className="muted sleep-footnote">
        Days are grouped by the calendar date where the food was logged, using the offset recorded
        with it rather than your current time zone, so a late supper stays on the day you ate it.
      </p>
    </>
  )
}
