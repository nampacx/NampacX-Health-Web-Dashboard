import PieChart, { type PieSlice } from '../charts/PieChart'
import {
  MACROS,
  humanizeMealType,
  hasMacros,
  macroShares,
  type NutritionDay,
} from '../api/google/nutrition'
import { clockLabel } from '../api/google/time'

// timeZone: 'UTC' is not a bug — `day.date` is built as UTC midnight of the
// civil day, so its UTC face *is* the local calendar date.
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

const gramFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const kcalFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const percentFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

/**
 * One day: the macro split as a pie, then the same numbers as a table.
 *
 * The pie is by **energy**, not by weight — a macro split means the calorie
 * split, and fat at 9 kcal/g against 4 would draw a high-fat day as a low-fat one
 * if the slices were grams. The table carries both columns so neither reading is
 * lost, which is also what keeps the figure readable without colour.
 */
export default function NutritionDayCard({ day }: { day: NutritionDay }) {
  const shares = macroShares(day.kcal)

  const slices: PieSlice[] = MACROS.map((macro) => ({
    id: macro.id,
    label: macro.label,
    value: day.kcal[macro.id],
    color: `var(--macro-${macro.id})`,
  }))

  // The logged figure is the source of truth; 4/4/9 over the macros ignores
  // alcohol and fibre and rounds, so the two legitimately disagree. Worth
  // pointing at only when the gap is big enough to notice.
  const gap =
    day.loggedKcal !== null && day.loggedKcal > 0
      ? Math.abs(day.loggedKcal - day.derivedKcal) / day.loggedKcal
      : 0
  const showGapNote = gap >= 0.05

  return (
    <li className="card nutrition-card">
      <div className="nutrition-head">
        <div>
          <h3>{dayFormat.format(day.date)}</h3>
          <span className="muted">
            {day.entries.length} {day.entries.length === 1 ? 'item' : 'items'} logged
          </span>
        </div>
        <div className="nutrition-day-total">
          <strong>{kcalFormat.format(day.loggedKcal ?? day.derivedKcal)}</strong>
          <span className="muted"> kcal{day.loggedKcal === null && ' (derived)'}</span>
        </div>
      </div>

      {!hasMacros(day) ? (
        <p className="muted nutrition-empty">
          The foods logged on this day carry an energy figure but no carbohydrate, fat or protein
          breakdown, so there is no split to draw.
        </p>
      ) : (
        <div className="nutrition-body">
          <div className="nutrition-figure">
            <PieChart
              slices={slices}
              ariaLabel={`Share of energy on ${dayFormat.format(day.date)}: ${MACROS.map(
                (macro) =>
                  `${macro.label} ${percentFormat.format(shares[macro.id] * 100)} percent`,
              ).join(', ')}. The table below lists the same values.`}
            />
            <p className="muted nutrition-figure-note">Share of energy</p>
          </div>

          <table className="nutrition-table">
            <caption className="visually-hidden">
              Macronutrients for {dayFormat.format(day.date)}, in grams and kilocalories
            </caption>
            <thead>
              <tr>
                <th scope="col">Macro</th>
                <th scope="col" className="num">
                  Grams
                </th>
                <th scope="col" className="num">
                  kcal
                </th>
                <th scope="col" className="num">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {MACROS.map((macro) => (
                <tr key={macro.id}>
                  <th scope="row">
                    {/* The swatch carries the identity; the label is plain ink,
                        so the row never depends on colour alone. */}
                    <span
                      className="macro-swatch"
                      style={{ background: `var(--macro-${macro.id})` }}
                      aria-hidden="true"
                    />
                    {macro.label}
                  </th>
                  <td className="num">{gramFormat.format(day.grams[macro.id])} g</td>
                  <td className="num">{kcalFormat.format(day.kcal[macro.id])}</td>
                  <td className="num">{percentFormat.format(shares[macro.id] * 100)} %</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="num">
                  {gramFormat.format(day.grams.carbs + day.grams.fat + day.grams.protein)} g
                </td>
                <td className="num">{kcalFormat.format(day.derivedKcal)}</td>
                <td className="num">100 %</td>
              </tr>
              {day.loggedKcal !== null && (
                <tr>
                  <th scope="row">Logged energy</th>
                  <td className="num muted">—</td>
                  <td className="num">{kcalFormat.format(day.loggedKcal)}</td>
                  <td className="num muted">—</td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}

      {showGapNote && (
        <p className="muted nutrition-note">
          The kcal column is derived from the grams at 4/4/9, so it does not have to match the{' '}
          {kcalFormat.format(day.loggedKcal ?? 0)} kcal actually logged — alcohol and fibre carry
          energy that is not one of these three, and each food rounds on its own.
        </p>
      )}

      <details className="raw">
        <summary>
          Logged items<span className="muted"> · {day.entries.length}</span>
        </summary>
        <ul className="nutrition-entries">
          {day.entries.map((entry) => (
            <li key={entry.key}>
              <span className="nutrition-entry-name">{entry.name}</span>
              <span className="muted">
                {[
                  entry.at ? clockLabel(entry.at, entry.utcOffsetSeconds) : null,
                  entry.mealType ? humanizeMealType(entry.mealType) : null,
                  entry.loggedKcal !== null ? `${kcalFormat.format(entry.loggedKcal)} kcal` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </li>
  )
}
