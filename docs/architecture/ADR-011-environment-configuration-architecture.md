# ADR-011 — Environment Configuration Architecture

**Status:** Accepted (Owner-authorized O-3, 2026-08-06). Implemented repo-only.
**Context:** `docs/assessments/sandbox-integration-environment-readiness.md` findings S-1, S-3, S-4.
**Supersedes nothing.** Complements ADR-005 (authorization), and is the mechanism `DeploymentModeStrategy.md` §5 deliberately left unspecified.

---

## Context

The application was hard-wired to one Firebase project. `field-ops-app-vite/src/firebase/firebase.js` carried `projectId: "taylor-parts"`, the production `authDomain`, `storageBucket`, `appId`, and a literal `us-central1`, with **no build-time environment injection**. Capability readiness (`RECEIVING_TRANSPORT_READY`, `TRUCK_MANAGEMENT_WRITE_READY`, `TRUSTED_COMPLETION_ENABLED`) were compiled-in booleans.

Consequences: the application **could not target any environment except the customer's production project**, which made a sandbox, a preview, and a release candidate all impossible. Three separate programs — Sandbox/Integration, R-2 option B, and the Configuration ADR — each needed the same thing, and were at risk of solving it three different ways.

## Decision

**One authoritative environment-configuration mechanism: `config/environments.json`.**

That file already existed as the C3/D2 drift registry. It is **extended**, not duplicated, so a single artifact answers *which environments exist*, *what each is for*, *its Firebase identity*, and *its capability readiness*.

### 1. Environment identity

Each environment declares `id`, `role`, `deployment`, `status`, `firebase`, and `readiness`.

**`role` (sandbox | integration | production) is independent of `deployment` (platform | customer).** Production-ness is determined by **role alone** — never by project name or deployment. A second customer is `role: production, deployment: <customer>` with no code change, and a test asserts no production environment belongs to `platform`. This is what prevents "production" silently meaning "Taylor Parts".

### 2. Build-time vs environment vs runtime

| Value | Placement | Why |
|---|---|---|
| Firebase identity (`projectId`, `authDomain`, `storageBucket`, `appId`, `messagingSenderId`, `functionsRegion`) | **Build-time, environment-resolved** | The SDK needs it at `initializeApp`. Injected from the registry via Vite `define`; selected by `VITE_ENVIRONMENT_ID`. |
| Capability readiness | **Deployment/environment configuration, environment-resolved at build** | See §3. |
| Governed runtime configuration | **Not introduced** | No runtime config fetch exists, and adding one would be a new failure mode on the critical path. Deferred until something genuinely needs it. |

### 3. Artifact parity — what an RC actually is

**A Release Candidate is an exact source revision, not an exact binary.** The same revision is built per environment with that environment's configuration; the business logic is identical by construction because it comes from one commit.

Readiness is therefore **environment configuration**, not build configuration. This lets a sandbox exercise a capability production has not activated **without changing any business logic**, which is precisely what an RC review requires.

D1's `version.json` records **both** `commit` and `environmentId`/`environmentRole` (schema 2), so a deployed surface states which revision *and* which environment it was built for, and D2 can verify both.

### 4. Fails closed

- Unknown environment id → **build error.** No fallback to a default. A typo must never silently point a sandbox build at live customer data.
- Declared but unprovisioned (no `firebase` identity) → **build error.**
- Missing or non-boolean readiness flag → **build error.** An absent flag must never default to enabled.
- An un-parameterised build resolves the registry default, reproducing the current production target exactly.

### 5. Production guards — allow-list, never wildcard

Existing hard guards (`BOOTSTRAP_ADMIN_PROJECT`, `warehouseBackupCodec`'s `projectId must be taylor-parts`, ~8 operator scripts) are **deliberate fail-closed safety controls**.

**They are not loosened by this ADR.** `isKnownProjectId()` provides the allow-list mechanism for when a second project genuinely exists; until then, relaxing a guard would be risk with no benefit. An invariant test asserts both guards remain in place, so a future change cannot weaken them silently. Membership in the allow-list is **not** permission — a caller that requires production still checks `role`.

### 6. Secrets

The registry holds **public Firebase Web client configuration only**. A Firebase Web `apiKey` is a public project identifier; access is enforced by Firestore Rules and Auth, not by hiding it. A test scans for `private_key`, `client_secret`, `refresh_token`, `service_account`, and bearer tokens. Real credentials never enter this file or client config.

## Consequences

**Positive.** One mechanism serves Sandbox, R-2 option B, and future customer deployments. The application can target a known non-production environment from source. Platform environments cannot inherit Taylor Parts identity (test-enforced). The remaining sandbox blocker is reduced to O-1/O-2 — creating the project and accepting its cost.

**Negative / accepted.** Per-environment builds mean the deployed *bytes* differ by environment even when the revision is identical; RC identity is therefore the SHA, which is why D1/D2 mattered first. No governed runtime configuration exists, so changing readiness still requires a rebuild and redeploy — acceptable while readiness changes are rare and Owner-gated.

**Unchanged.** No production infrastructure renamed. No project ids, collections, environment variables, or package identifiers altered. No deployment performed. The default build target is byte-identical in behaviour to before.

## Invariants (enforced by `scripts/environmentArchitecture.test.mjs`)

1. No hard-coded project identity in the client Firebase module.
2. Readiness flags resolved from the registry, never compiled-in literals.
3. Unknown environment fails closed.
4. Unprovisioned environment fails closed.
5. Missing readiness fails closed.
6. Unknown project ids rejected — the allow-list is not a wildcard.
7. Existing production guards remain hard.
8. Production keyed on role, never on project/deployment name.
9. No production environment belongs to the `platform` deployment.
10. Platform environments do not inherit Taylor Parts identity.
11. No credentials in the registry.
12. The default environment reproduces the current production identity.
