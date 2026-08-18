import {
  formatCivilDate,
  formatStrideLength,
  isProfileEmpty,
  type StrideLength,
} from '../api/google/profile'
import { useGoogleData } from '../state/googleData'

/**
 * The Profile sub-tab: `users/me/profile`, unlocked by
 * `googlehealth.profile.readonly`.
 *
 * The one sub-tab the controls above the tab bar do not govern — there is no
 * time range or data-type selection to apply to a single object with no
 * observation time. Said on the page rather than left to be inferred from a view
 * that ignores the widgets sitting above it.
 */

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="sleep-stat">
      <span className="sleep-stat-label">{label}</span>
      <span className="sleep-stat-value">{value}</span>
      {hint && <span className="muted sleep-stat-hint">{hint}</span>}
    </div>
  )
}

/**
 * Both stride numbers, when both exist. They are different claims — one is what
 * the user typed, the other is what the watch measured off GPS — so collapsing
 * them to whichever is present would hide the disagreement, which is the only
 * interesting thing about having two.
 */
function Strides({ label, stride }: { label: string; stride: StrideLength }) {
  if (stride.configuredMm === null && stride.autoMm === null) return null
  return (
    <>
      {stride.configuredMm !== null && (
        <Stat
          label={`${label} stride`}
          value={formatStrideLength(stride.configuredMm)}
          hint="set in the app"
        />
      )}
      {stride.autoMm !== null && (
        <Stat
          label={`${label} stride`}
          value={formatStrideLength(stride.autoMm)}
          hint="measured by the device"
        />
      )}
    </>
  )
}

export default function ProfileSection() {
  const { profile, profileError, profileLoading } = useGoogleData()

  return (
    <>
      <div className="list-header">
        <h2>Profile</h2>
        <span className="muted">users/me/profile · not affected by the time range</span>
      </div>

      {profileError && <p className="banner banner-error">{profileError}</p>}

      {profileLoading && !profile ? (
        <p className="muted">Loading your profile…</p>
      ) : !profile ? (
        !profileError && (
          <section className="card empty">
            <h2>No profile loaded</h2>
            <p className="muted">
              Sign in to Google Health and this reads <code>users/me/profile</code>.
            </p>
          </section>
        )
      ) : isProfileEmpty(profile) ? (
        <section className="card empty">
          <h2>Profile is empty</h2>
          <p className="muted">
            The endpoint answered, but every field came back unset. Age and join date are filled in
            by Google; the stride lengths only appear once they have been entered in the Google
            Health app or worked out from a GPS run.
          </p>
        </section>
      ) : (
        <section className="card">
          <div className="sleep-stats profile-stats">
            {profile.ageYears !== null && (
              <Stat label="Age" value={`${profile.ageYears} years`} hint="derived by Google" />
            )}
            {profile.memberSince && (
              <Stat label="Member since" value={formatCivilDate(profile.memberSince)} />
            )}
            <Strides label="Walking" stride={profile.walking} />
            <Strides label="Running" stride={profile.running} />
          </div>

          <details className="raw">
            <summary>Raw JSON</summary>
            <pre>{JSON.stringify(profile.raw, null, 2)}</pre>
          </details>
        </section>
      )}

      {/* The obvious next question, and the answer is a flat no rather than a
          setting to find. */}
      <p className="muted sleep-footnote">
        Your name, birth date, sex, height and weight are not in this resource — the API exposes an{' '}
        <em>age</em> Google derives from the birth date, never the date itself. Height and weight are
        separate data types under Metrics, and the profile carries no name at all; the account name
        on this page comes from Google sign-in, not from Google Health.
      </p>
    </>
  )
}
