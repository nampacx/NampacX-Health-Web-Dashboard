import {
  SLEEP_STAGES,
  SLEEP_STAGE_LABELS,
  formatDuration,
  stageShare,
  type SleepNight,
} from '../api/google/sleep'

const percentFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

/**
 * The night's composition as one stacked bar, with every stage also written out
 * underneath. The bar is the shape; the list is the data — colour is never the
 * only way to read a value here, which is also what discharges the contrast
 * warning on the lighter stage step.
 */
export default function StageBar({ night }: { night: SleepNight }) {
  const present = SLEEP_STAGES.filter((stage) => night.totals[stage] > 0)
  if (present.length === 0) return null

  return (
    <div className="stage-bar-block">
      <div className="stage-bar" role="img" aria-label="Stage composition; the totals below list the same values.">
        {present.map((stage) => (
          <span
            key={stage}
            className="stage-bar-part"
            style={{
              ['--stage' as string]: `var(--stage-${stage})`,
              flexGrow: night.totals[stage],
            }}
          />
        ))}
      </div>

      <ul className="stage-totals">
        {present.map((stage) => (
          <li key={stage}>
            <span
              className="stage-key"
              style={{ ['--stage' as string]: `var(--stage-${stage})` }}
              aria-hidden="true"
            />
            <span className="stage-name">{SLEEP_STAGE_LABELS[stage]}</span>
            <span className="stage-value">{formatDuration(night.totals[stage])}</span>
            <span className="muted stage-share">
              {percentFormat.format(stageShare(night, stage))}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
