# W1-C22 — Integrations boundary: registrations and required follow-ups

Lane: integration boundary (`integrations/`, external intake/gateway surfaces, and the EOS API
boundary they use). Branch `impl/w1-integrations-review`.

## Registrations made by this change

**None.** No entity, no permission, no capability, no collection, no migration, no callable, no
navigation entry. This lane added an identifier chokepoint and an enforcement test to an existing
external surface; nothing new became addressable.

| Shared registry | Touched? | Why not |
|---|---|---|
| `functions/package.json` | no | no new dependency; the integration has its own package |
| `entityRegistry.js` | no | no business object introduced or changed |
| `objectPermissionMap.js` / `permissionCatalog.ts` | no | no new permission; the boundary is gated on OAuth scopes that already exist |
| `capability-graph.json` | no | no capability added |
| `firestore.rules` | no | this boundary touches no Firestore at all |
| `functions/src/constants/collections.ts` | no | no collection added |
| `field-ops-app-vite/test/suites.json` | no | no client suite; the test is a Node suite in the integration package |
| `firebase-exit-baseline.json` / `firebase-exit-manifest.json` | no | see the open item below |
| `.github/workflows/**` | no (prohibited for this lane) | see the open items below |
| migration `1759795200000` | **not used** | nothing in this lane is persisted in PostgreSQL; the reserved id is unspent and may be reclaimed |

## Required follow-ups an owner of the shared files must perform

These are real gaps this lane found and is not permitted to close, because each one edits a file on
the shared do-not-edit list. They are listed so the next owner does not have to rediscover them.

### 1. `integrations/chatgpt-eos-intake` tests are not run by any CI workflow — REGISTER THEM

`npm test` in `integrations/chatgpt-eos-intake` is never invoked by `.github/workflows/**`. The only
reference to the package in CI is `.github/workflows/reciprocal-gpt-review.yml:63`, which runs
`npm ci` (install only, `mode == 'evidence'`) and never a test. The 28 tests in that package —
including this lane's new `test/boundary.test.mjs` — pass locally and are enforced by nothing.

Required: a workflow step equivalent to

```yaml
- working-directory: integrations/chatgpt-eos-intake
  run: npm ci --ignore-scripts && npm test
```

triggered on changes to `integrations/**` and to `docs/orchestration/lib/workIntake.mjs` and
`docs/orchestration/lib/reviewAuthorization.mjs` (the contract modules the package imports). Until
that exists, "the contract is pinned by a test" is true only for someone who runs it by hand.

### 2. `scripts/firebaseExitGuard.mjs` does not scan `integrations/`

The guard's scan roots are `field-ops-app-vite/src` and `functions/src`, and its extension list is
`.js/.jsx/.ts/.tsx` — so an `.mjs` file under `integrations/` could import `firebase-admin/firestore`
and the guard would stay green. This lane enforces the same property locally instead
(`test/boundary.test.mjs`, "the integration has no Firebase, no Firestore, and no
business-collection write path"), which is a real check but a package-local one.

Widening the guard's roots/extensions is the durable fix. It is deliberately NOT done here: adding a
scan root forces a `firebase-exit-baseline.json` regeneration, and that file is on the shared
do-not-edit list for this lane.

### 3. `submit_work` is not idempotent across a merged intake

`GitHubArtifactStore.submit` (`integrations/chatgpt-eos-intake/src/githubStore.mjs:21-37`) is replay-safe
only while the intake branch still exists: a 422 on branch creation compares the stored `sha256` and
returns `replayed: true`. Once the intake PR is merged and the branch deleted, a retry of the same
`requestId` creates the branch again — and because `buildIntake` stamps `createdAt`/`updatedAt` from
`now()` (`src/artifacts.mjs:8`, `:34`), the recomputed `sha256` differs, so the retry opens a SECOND
pull request that rewrites the already-merged artifact at the same location with a new hash.

This is a contract decision, not a bug fix: the options are (a) make the artifact genuinely
content-addressed by deriving the timestamps from the request rather than the clock, or (b) have
`submit` read `main` for an existing `<requestId>.work.json` before creating a branch and return the
merged pointer. Either changes the published tool's observable behaviour, so it belongs to whoever
owns the intake contract, not to a boundary-census lane.
