import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { GoogleAuthProvider } from './auth/google/GoogleAuthContext'
import { WithingsAuthProvider } from './auth/withings/WithingsAuthContext'
import { TimeRangeProvider } from './state/timeRange'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <GoogleAuthProvider>
      <WithingsAuthProvider>
        <TimeRangeProvider>
          <App />
        </TimeRangeProvider>
      </WithingsAuthProvider>
    </GoogleAuthProvider>
  </StrictMode>,
)
