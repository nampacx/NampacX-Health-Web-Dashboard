import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { WithingsProvider } from './auth/WithingsAuthContext'
import { TimeRangeProvider } from './state/timeRange'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <AuthProvider>
      <WithingsProvider>
        <TimeRangeProvider>
          <App />
        </TimeRangeProvider>
      </WithingsProvider>
    </AuthProvider>
  </StrictMode>,
)
