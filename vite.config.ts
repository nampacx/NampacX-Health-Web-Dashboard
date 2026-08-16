import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Google Health API does not advertise CORS headers for browser origins, so
// during development every `/health-api/**` request is proxied through Vite to
// https://health.googleapis.com. The bearer token still comes from the browser;
// the proxy only forwards it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/health-api': {
        target: 'https://health.googleapis.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/health-api/, ''),
      },
    },
  },
})
