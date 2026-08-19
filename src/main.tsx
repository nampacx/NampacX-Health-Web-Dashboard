import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { GoogleAuthProvider } from './auth/google/GoogleAuthContext'
import { WithingsAuthProvider } from './auth/withings/WithingsAuthContext'
import { BloodworkDataProvider } from './state/bloodworkData'
import { GoogleDataProvider } from './state/googleData'
import { TimeRangeProvider } from './state/timeRange'
import { WithingsDataProvider } from './state/withingsData'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <GoogleAuthProvider>
      <WithingsAuthProvider>
        <TimeRangeProvider>
          {/* Data providers sit inside auth and time range because they read
              both, and outside App so the fetches survive tab switches.
              Bloodwork reads only Google auth (no time range concept -- the
              API returns everything), but nests here for the same reason. */}
          <GoogleDataProvider>
            <WithingsDataProvider>
              <BloodworkDataProvider>
                <App />
              </BloodworkDataProvider>
            </WithingsDataProvider>
          </GoogleDataProvider>
        </TimeRangeProvider>
      </WithingsAuthProvider>
    </GoogleAuthProvider>
  </StrictMode>,
)
