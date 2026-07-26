import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// INV-CONVERGENCE-E Stage A completion -- deterministic application/build commit
// identifier, injected as the `__APP_COMMIT__` global. Sourced from the git short SHA
// at build time; falls back to "unknown" when git is unavailable (the shadow-parity
// pure core treats "unknown" as BLOCKED_INCOMPLETE_INPUT, never a false PASS). Build-
// time constant only -- no runtime, routing, Firestore Rules, or authorization effect.
function resolveAppCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

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
  define: {
    __APP_COMMIT__: JSON.stringify(resolveAppCommit()),
  },
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 800,
  },
})
