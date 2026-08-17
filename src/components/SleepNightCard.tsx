import { formatDuration, type SleepNight } from '../api/google/sleep'
import { hasAnyMetric, type NightMetrics } from '../api/google/sleepMetrics'
import Hypnogram from '../charts/Hypnogram'
import StageBar from '../charts/StageBar'

const nightFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })
const oneDecimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

interface Props {
  night: SleepNight
  metrics: NightMetrics | null
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="sleep-stat">
      <span className="sleep-stat-label">{label}</span>
      <span className="sleep-stat-value">{value}</span>
      {hint && <span className="muted sleep-stat-hint">{hint}</span>}
    </div>
  )
}

export default function SleepNightCard({ night, metrics }: Props) {
  const heading = night.start ? nightFormat.format(night.start) : 'Sleep session'
  const window =
    night.start && night.end
      ? `${timeFormat.format(night.start)} – ${timeFormat.format(night.end)}`
      : null

  return (
    <li className="card sleep-night">
      <div className="sleep-night-head">
        <div>
          <h3>{heading}</h3>
          {window && <span className="muted">{window}</span>}
        </div>
        <div className="sleep-night-headline">
          <strong>{formatDuration(night.timeAsleepMs)}</strong>
          <span className="muted"> asleep</span>
        </div>
      </div>

      <StageBar night={night} />
      <Hypnogram night={night} />

      <div className="sleep-stats">
        <Stat label="Time in bed" value={formatDuration(night.timeInBedMs)} />
        <Stat
          label="Efficiency"
          value={night.efficiency === null ? '—' : `${whole.format(night.efficiency)}%`}
          hint="asleep ÷ in bed"
        />
        <Stat
          label="Full awakenings"
          value={String(night.fullAwakenings)}
          hint="derived: awake > 5 min"
        />
        {night.outOfBedMs > 0 && (
          <Stat label="Out of bed" value={formatDuration(night.outOfBedMs)} />
        )}
      </div>

      {/* The overnight cardio numbers. These are their own data types, so a
          night can have stages and no metrics, or the reverse. */}
      {hasAnyMetric(metrics) && metrics && (
        <div className="sleep-stats sleep-stats-cardio">
          {metrics.deepSleepHrvMs !== null && (
            <Stat
              label="HRV asleep"
              value={`${oneDecimal.format(metrics.deepSleepHrvMs)} ms`}
              hint="RMSSD, deep sleep"
            />
          )}
          {metrics.averageHrvMs !== null && (
            <Stat
              label="HRV daily avg"
              value={`${oneDecimal.format(metrics.averageHrvMs)} ms`}
            />
          )}
          {metrics.nonRemHeartRateBpm !== null && (
            <Stat
              label="Heart rate asleep"
              value={`${whole.format(metrics.nonRemHeartRateBpm)} bpm`}
              hint="non-REM"
            />
          )}
          {metrics.restingHeartRateBpm !== null && (
            <Stat
              label="Resting HR"
              value={`${whole.format(metrics.restingHeartRateBpm)} bpm`}
              hint="whole day"
            />
          )}
          {metrics.breathsPerMinute !== null && (
            <Stat
              label="Respiratory rate"
              value={`${oneDecimal.format(metrics.breathsPerMinute)} /min`}
            />
          )}
          {metrics.entropy !== null && (
            <Stat label="HRV entropy" value={oneDecimal.format(metrics.entropy)} />
          )}
        </div>
      )}

      <details className="raw">
        <summary>Raw JSON</summary>
        <pre>{JSON.stringify(night.raw, null, 2)}</pre>
      </details>
    </li>
  )
}
