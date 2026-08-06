import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { resolveEnvironment } from '../scripts/resolveEnvironment.mjs'

// O-3 — environment identity comes from the ONE registry (config/environments.json),
// never from hard-coded literals in source. Select with VITE_ENVIRONMENT_ID; the
// registry's defaultEnvironmentId applies when unset, which preserves the existing
// production build byte-for-byte.
//
// FAILS CLOSED: an unknown or unprovisioned environment throws here and the build
// stops. It must never fall back to production — a typo silently pointing a sandbox
// build at the customer's live data is exactly what this prevents.
const CONFIG_DIR = dirname(fileURLToPath(import.meta.url))
function resolveActiveEnvironment() {
  const registry = JSON.parse(
    readFileSync(resolvePath(CONFIG_DIR, '../config/environments.json'), 'utf8'),
  )
  return resolveEnvironment(registry, process.env.VITE_ENVIRONMENT_ID || null)
}

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

// C3/D1 -- deployed-version identity. `__APP_COMMIT__` above makes the build id
// available INSIDE the bundle, but answering "what version is production actually
// running?" from outside required loading the app and inspecting internals. This
// plugin emits a tiny, stable, unauthenticated `version.json` next to index.html so
// the deployed revision is readable with one HTTP GET -- the foundation D2
// (expected-vs-deployed comparison) builds on.
//
// Deliberately contains ONLY build provenance: commit, build timestamp, and asset
// base. No secrets, no config, no project identifiers, nothing that is not already
// derivable from the shipped bundle. Build-time only -- no runtime, routing,
// Firestore, Rules, or authorization effect.
//
// The asset base is read from Vite's RESOLVED config, not recomputed here: the
// Firebase build overrides it with a CLI flag (`vite build --base=/`), which is
// applied after this module evaluates. Recomputing it recorded the GitHub Pages
// base in the Firebase manifest — making the two surfaces indistinguishable from
// their manifests, which is precisely what D2 needs to tell apart. Caught by
// test/verifyVersionManifest.mjs.
function emitVersionManifest(commit, environment) {
  let resolvedBase = null
  return {
    name: 'emit-version-manifest',
    apply: 'build',
    configResolved(config) {
      resolvedBase = config.base
    },
    generateBundle() {
      const base = resolvedBase
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify(
          {
            commit,
            base,
            buildTime: new Date().toISOString(),
            environmentId: environment.id,
            environmentRole: environment.role,
            schema: 2,
          },
          null,
          2,
        )}\n`,
      })
    },
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

const APP_COMMIT = resolveAppCommit();
const APP_ENV = resolveActiveEnvironment();

export default defineConfig({
  base: process.env.VITE_BASE || DEFAULT_BASE,
  define: {
    __APP_COMMIT__: JSON.stringify(APP_COMMIT),
    // Public Firebase Web client configuration — a project identifier, not a
    // credential. Access is enforced by Firestore Rules + Auth.
    __APP_FIREBASE_CONFIG__: JSON.stringify(APP_ENV.firebase),
    __APP_ENVIRONMENT__: JSON.stringify({
      id: APP_ENV.id, role: APP_ENV.role, deployment: APP_ENV.deployment,
    }),
    __APP_READINESS__: JSON.stringify(APP_ENV.readiness),
  },
  plugins: [react(), emitVersionManifest(APP_COMMIT, APP_ENV)],
  build: {
    chunkSizeWarningLimit: 800,
  },
})
