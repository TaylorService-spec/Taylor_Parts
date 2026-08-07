# Environment / Configuration Change — CI Coverage Contract

**Owning layer:** application environment configuration (ADR-011 / `config/environments.json` /
`vite.config.js` define block). This is a durable engineering contract, not a feature artifact.

## The lesson (from the O-3 CI regression, 2026-08-07)

The O-3/ADR-011 change routed `src/firebase/firebase.js` and the readiness seams
(`src/config/*Readiness.js`) through ambient **vite `define` globals**
(`__APP_FIREBASE_CONFIG__` / `__APP_READINESS__` / `__APP_ENVIRONMENT__` / `__APP_COMMIT__`). The Vite
build injects these, so the production build was healthy — but the **hermetic test environments did
not receive the same configuration contract**:

- **Node `.mjs` suites** that statically import a readiness config threw `ReferenceError:
  __APP_READINESS__ is not defined` (ESM hoists the static import above any in-test global setup).
- **vitest/jsdom component gate** threw `ReferenceError: __APP_FIREBASE_CONFIG__ is not defined`
  because `vitest.config.js` had no matching `define`.

These field-ops suites run **only on PR CI** (path-filtered), and only for PRs that touch field-ops —
so functions-only PRs skipped them and **main's push CI stayed green while main was actually red on
every field-ops PR**. The breakage was invisible until a field-ops PR triggered the gate.

## The contract

**An application environment/configuration change is INCOMPLETE unless the same injected-configuration
contract is satisfied in BOTH production/Vite build behavior AND every hermetic test environment.**

When changing anything that introduces or relies on a build-injected global / environment/readiness
value, verify (and, where a gate is missing, add coverage) across ALL of:

1. **Vite build** (`npm run build`) — production-equivalent build behavior.
2. **vitest / jsdom** (`npm run test:components`) — the `define` block in `vitest.config.js` must carry
   every `__APP_*` global the imported code reads.
3. **Node `.mjs` suites** (`npm test`) — a module that reads a build-injected global must either be
   import-safe under plain Node (guarded) or be loaded by tests via a global-set + **dynamic** import
   (never a bare static import that hoists above setup).
4. **Environment registry drift** (`config/environments.json` schema + the drift/environment tests).
5. **Readiness configuration** — every readiness flag present per environment; fail-closed on absence.
6. **Production-equivalent build** — the same source revision is the Release Candidate; no test-only
   divergence that hides a production break.

## Guardrails

- **Do NOT** rely on a subset of CI (functions-only, or push-only) to conclude the field-ops client is
  healthy — the field-ops suites are path-filtered and only run on field-ops PRs.
- **Do NOT** solve a platform-configuration coverage gap with capability-specific CI. Fix it once at
  this owning layer (the harness `define` / the registry / the config module), so every capability
  inherits the coverage.
- When a build-injected global is added, add it to `vitest.config.js` `define` in the SAME change.
