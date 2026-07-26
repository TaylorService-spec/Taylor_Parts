---
artifact_type: implementation-note
unit: INV-CONVERGENCE-E Stage B — PR-B1 (repository Rules implementation)
gate: Rules edit + emulator tests (repository only) — NO deployment
status: Draft implementation PR — awaiting Owner and ChatGPT review; authorizes no deployment
date: 2026-07-26
baseline: 9ff2e30b1029b9e0d567f4e4d15b26d3a76a4bab (origin/main — Stage B design merged, PR #431)
approved_spec: docs/specifications/inv-convergence-e-stage-b-operational-role-parts-rules.md
related_decisions: "DECISIONS.md #40 (ADR-008), #43, #44, #46; Issue #100; Issue #226"
authorizes: nothing beyond this repository change — no Rules/Functions/index deployment, no data writes, no source switch, no PartsList/PartDetail change, no C1/C2
---

# INV-CONVERGENCE-E Stage B — PR-B1 implementation note (repository only)

Repository implementation of the approved Stage B design: broaden the canonical
`parts` **read** predicate and add the governed emulator regression. **This PR is
repository-only. No deployment is authorized by this PR.**

## What changed

1. **`firestore.rules` (root) + `field-ops-app-vite/firestore.rules` (mirror)** —
   the `match /parts/{partId}` read predicate only:

   ```
   // before
   allow read: if isAdminOrDispatcher();

   // after
   allow read: if isAdminOrDispatcher()
     || isActiveOperationalRole("PARTS_MANAGER")
     || isActiveOperationalRole("WAREHOUSE_MANAGER");
   ```

   `allow create, update, delete: if false;` is **unchanged** (trusted-writer-only).
   The two Rules files remain **byte-identical** (enforced by the regression
   runner's `checkRulesIdentical`). No other Rules block was touched — no
   generalized permission helper was added, `isAdminOrDispatcher` was not modified,
   `accessVersion` behavior was not modified, and no custom claim is consulted.

2. **`functions/test/inventoryConvergenceStageBPartsRules.test.js`** (new) — the
   §5 12-principal matrix, each principal probed across all 11 governed operations
   (`parts` list read, `parts` single read, `parts` create/update/delete, and
   `manufacturers` / `part_aliases` / `part_supplier_items` read + write), plus 10
   behavioral proofs. 142 assertions.

3. **`functions/scripts/rulesRegressionRunner.mjs`** — registered the new suite
   (expected 142); `EXPECTED_TOTAL` 502 → 644.
   **`functions/test/rulesRegressionRunner.test.mjs`** — updated the pinned total
   (502 → 644) and the summary assertion.

## Approved role set (exact)

`parts` **read ALLOW** for: admin, dispatcher, active reciprocally-linked
**PARTS_MANAGER**, active reciprocally-linked **WAREHOUSE_MANAGER**.

**PARTS_ASSOCIATE remains DENIED** (DQ-B1). Any future PARTS_ASSOCIATE grant is a
separate, separately-governed decision — it is not part of this implementation.

## accessVersion

`accessVersion` **is not consulted** by this predicate. Authorization is evaluated
live against the reciprocally-linked Employee document on each read
(`employmentStatus == "ACTIVE"` AND permitted operational role AND live reciprocal
link). A principal with a **stale `accessVersion`** but an otherwise-valid live
active record still reads — this is **ALLOW and NOT fail-closed** (proven by
principal 11 and PROOF E in the suite). Revocation is immediate via the live
Employee document only.

## Rollback

Restore the prior `parts` read predicate:

```
allow read: if isAdminOrDispatcher();
```

in both Rules files and re-run the suite/regression. **No data migration effect** —
this is a read-only grant; no write authority, data, or adjacent collection changes.
(For a deployed environment, rollback is redeploying the prior ruleset; that is the
separate deployment gate's concern, not this PR.)

## Boundaries (this PR)

Repository-only. **No Firebase deployment. No production Rules change. No Functions
deployment. No index deployment. No Firestore data change. No user / employee / role
/ claim / accessVersion change. No Hosting deployment. No PartsList/PartDetail source
switch. No C1 or C2 implementation. No static-catalog edit. No adapter behavior
change.** No unrelated Rules cleanup or refactoring. Decisions #43–#46 unchanged.

## Next gates (each separately authorized; NOT started here)

- **PR-B2 (emulator evidence):** run the full Rules regression from a clean checkout
  and capture green results as committed evidence (counts + suite summary; no
  production data / credentials).
- **Deployment gate (separate Owner + ChatGPT authorization):** the F-RULES-1 D2
  precedent — take the shared-`firestore.rules` release lock, capture the pre-deploy
  live ruleset (SHA-256 rollback artifact), `firebase deploy --only firestore:rules
  --project taylor-parts`, byte-verify the live ruleset equals the governed blob, run
  the §5 production verification matrix against a **governed persona matrix**, package
  sanitized evidence. **Production verification must use a governed persona matrix.**
- **C1 (PartsList cutover) remains BLOCKED** until the Rules deployment and production
  verification gate is complete.
