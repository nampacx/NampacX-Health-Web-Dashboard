import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves a project site from /<repo>/, so a production build needs
// a base path. The deploy workflow passes it via VITE_BASE_PATH (from the
// configure-pages action); local builds default to the site root.
const rawBase = process.env.VITE_BASE_PATH?.trim() || '/'
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
  },
})
