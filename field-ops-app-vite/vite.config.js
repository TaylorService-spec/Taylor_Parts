import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// Base path is environment-specific so the SAME source builds correctly for
// two hosts with different mount points:
//   - GitHub Pages     -> served under /Taylor_Parts/field-ops/ (the default)
//   - Firebase Hosting -> served at the domain root /
// The default preserves the existing GitHub Pages behavior with no build-
// command change. A root-relative build is produced by the CLI flag
// (`vite build --base=/`, used by `npm run build:firebase`) or by setting
// VITE_BASE. This is a build-time asset-URL concern only -- no runtime,
// routing, domain, Firestore Rules, or authorization logic is affected.
const DEFAULT_BASE = "/Taylor_Parts/field-ops/";

export default defineConfig({
  base: process.env.VITE_BASE || DEFAULT_BASE,
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 800,
  },
})
