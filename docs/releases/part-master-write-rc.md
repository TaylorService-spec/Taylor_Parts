# Part Master — In-App Catalog Write Capability — RC (repo-side)

**Purpose:** close ADR-009 gap **G2** (no in-site Part-creation workflow) with a governed in-app Part
Master administration experience over the existing trusted `partMasterCommands` service. **Repo-only
and inert.** Every production step is a separately-authorized protected action; none performed.

> Companion authority: `functions/src/partMaster/partMasterCommands.ts` (the ONE Part authority),
> `docs/architecture/ADR-009-business-operations-through-application.md` (G2).

## What's built (repo-only)

**Phase 1 — callable adapters (PR #617, merged).** `functions/src/partMaster/partMasterCallables.ts`
exposes `createPart`/`updatePart`/`changePartStatus` as `onCall` wrappers, exported from
`functions/src/index.ts` under their frozen public names. Actor identity from `request.auth.uid` only;
capability enforced inside the command (`inventory.catalog.manage` create/update,
`inventory.catalog.activate` status); sanitized error mapping; no new authority. **Not deployed.**

**Phase 2 — in-app write workspace (this RC).** The former read-only registry
(`field-ops-app-vite/src/modules/inventory/PartMasterList.jsx`) is evolved **in place** into a
create / edit / status workspace — no second Parts read model (still `fetchPartMasterList` +
`partMasterView`). Writes go ONLY through `usePartMasterWrite` → `partMasterCommandClient` → the
callables. Supporting pieces: `config/partMasterWriteReadiness.js` (fail-closed),
`services/partMasterCommandClient.js` (thin httpsCallable seam), `domain/partMasterWrite.js` (pure:
client mirrors of the backend vocabularies/transitions + honest outcome mapping),
`hooks/usePartMasterWrite.js` (readiness-gated).

## Invariants (verified by independent review)

ONE Part authority · ONE catalog-management capability model · ONE trusted command path · NO client
Firestore writes · NO parallel validator · NO parallel status vocabulary (the selects are client
MIRRORS, byte-identical to `functions/src/partMaster/types.ts`; the command re-validates and is
authoritative). Actor identity never client-sent. Honest outcomes: the UI never fabricates a success —
a resolved callable maps to `applied`/`replayed`, errors map to sanitized per-code UI outcomes, and the
write-disabled path is a distinct honest state.

## Fail-closed posture

`PART_MASTER_WRITE_READY = false` in every environment (`config/environments.json`). While false, the
workspace shows a write-disabled notice and `usePartMasterWrite` makes **zero** callable attempts.
Activation is NOT a repo edit — it requires the protected promotion below. Tests/preview inject an
explicit readiness + a mocked client via `usePartMasterWrite(deps)`; server auth is re-enforced regardless.

## Verification (repo-side)

- `partMasterCallables` 11 emulator + 2 export (Phase 1); `partMasterWrite` domain 7 offline (Phase 2).
- `tsc` (functions) + `vite build` (app) clean.
- Independent design-code reviews: Phase 1 + Phase 2 — **zero correctness/authorization findings**; all
  mechanical fixes applied.

## Exact production delta (all protected; none done)

1. **Deploy the three Part callables:**
   `firebase deploy --only functions:createPart,functions:updatePart,functions:changePartStatus` (scope to exactly these three).
2. **Define + grant the catalog-admin authority** — no standing role carries `inventory.catalog.manage`/`.activate`.
   This is the SAME `inventoryCatalogAdministrator` role design accepted for Supplier Master (see
   `docs/releases/supplier-master-promotion-package.md` §A). Define it (repo) + grant it (protected).
3. **Flip write-readiness:** set `PART_MASTER_WRITE_READY: true` for the target environment in
   `config/environments.json`.
4. **Frontend promotion** of the bundle serving the workspace (Hosting/Pages — protected; the only
   existing frontend deploy is the ungated Pages workflow, which must be replaced by a governed release).

**Recommended pre-promotion:** a dedicated **UI-quality / impeccable pass** on the workspace before the
frontend promotion — this RC evolved the existing raw-inline-styled screen and prioritized governed
correctness + honest states; visual polish (spacing, form layout, validation affordances) is a good
follow-up while still repo-only.

## Rollback (per step)

Callables deploy → redeploy prior estate (additive). Grant → revoke assignment. `PART_MASTER_WRITE_READY`
→ set back to false (fail-closed). Frontend → revert to prior release. No data migration is involved.

## Sandbox handoff (shared EAO environment; no Part-specific env)

The environment should exercise: read Part registry (`fetchPartMasterList`); create synthetic Part;
update synthetic Part; activate/deactivate (status transitions); the `inventoryCatalogAdministrator`
**test** persona (a test role carrying the two capabilities — never the production grant); denial cases
(unauth / no-capability / `.manage`-only cannot change status); idempotency/replay; validation failures;
and D1/D2 deployed-SHA verification. All exercisable via the deployed callables + `usePartMasterWrite`
readiness/mock-client injection; no Part-specific environment is required.

## Protected actions requiring Owner authorization

Functions deploy · capability/role grant · `PART_MASTER_WRITE_READY` activation · frontend promotion ·
production Part creation/update. None performed here.
