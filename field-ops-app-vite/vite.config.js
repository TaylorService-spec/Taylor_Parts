import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: "/Taylor_Parts/field-ops/",
  plugins: [react()],
  server: {
    allowedHosts: ['.loca.lt', '.trycloudflare.com'],
  },
  build: {
    chunkSizeWarningLimit: 800,
  },
})
