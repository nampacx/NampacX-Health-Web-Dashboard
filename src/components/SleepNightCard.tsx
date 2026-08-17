import { clockLabel, formatDuration, wallClock, type SleepNight } from '../api/google/sleep'
import { hasAnyMetric, type NightMetrics } from '../api/google/sleepMetrics'
import Hypnogram from '../charts/Hypnogram'
import StageBar from '../charts/StageBar'

// timeZone: 'UTC' is not a bug: the date handed in is already shifted into the
// recording zone, so its UTC face *is* the local calendar day.
const nightFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
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
  const offset = night.utcOffsetSeconds
  const heading = night.start
    ? nightFormat.format(wallClock(night.start, offset))
    : 'Sleep session'
  const window =
    night.start && night.end
      ? `${clockLabel(night.start, offset)} – ${clockLabel(night.end, offset)}`
      : null

  const awakeEpisodes = night.episodes.awake

  return (
    <li className="card sleep-night">
      <div className="sleep-night-head">
        <div>
          <h3>{heading}</h3>
          {window && <span className="muted">{window}</span>}
          {!night.isMainSleep && <span className="pill">Nap</span>}
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
          label="Awake"
          value={formatDuration(night.awakeMs)}
          hint={awakeEpisodes > 0 ? `${awakeEpisodes} episodes` : undefined}
        />
        {night.fallAsleepMs !== null && (
          <Stat label="To fall asleep" value={formatDuration(night.fallAsleepMs)} />
        )}
        {/* Brief arousals, counted separately by the device from the stage
            timeline. The nearest thing the payload has to "restlessness". */}
        {night.shortAwakenings > 0 && (
          <Stat
            label="Short awakenings"
            value={String(night.shortAwakenings)}
            hint="brief arousals"
          />
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
            <Stat label="HRV daily avg" value={`${oneDecimal.format(metrics.averageHrvMs)} ms`} />
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
