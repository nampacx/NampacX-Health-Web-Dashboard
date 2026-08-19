import { useGoogleAuth } from '../auth/google/GoogleAuthContext'

export default function Header() {
  const { status, profile, signOut } = useGoogleAuth()

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          ♥
        </span>
        <div>
          <h1>NampacX Health Dashboard</h1>
          <p className="brand-sub">Activity, sleep, and body composition — together</p>
        </div>
      </div>

      {status === 'signed-in' && (
        <div className="account">
          {profile?.picture && (
            <img className="avatar" src={profile.picture} alt="" width={32} height={32} />
          )}
          <div className="account-text">
            <span className="account-name">{profile?.name ?? 'Signed in'}</span>
            {profile?.email && <span className="account-email">{profile.email}</span>}
          </div>
          <button type="button" className="btn btn-ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </header>
  )
}
