import { useAuth } from './auth/AuthContext'
import Dashboard from './components/Dashboard'
import Header from './components/Header'
import SignIn from './components/SignIn'

export default function App() {
  const { status } = useAuth()

  return (
    <div className="app">
      <Header />
      <main className="main">
        {status === 'loading' && <p className="muted">Restoring session…</p>}
        {status === 'signed-out' && <SignIn />}
        {status === 'signed-in' && <Dashboard />}
      </main>
      <footer className="footer">
        Data from the{' '}
        <a href="https://developers.google.com/health/about" target="_blank" rel="noreferrer">
          Google Health API
        </a>{' '}
        · read-only
      </footer>
    </div>
  )
}
