# Sales — Opportunity Governed Write Command (Cycle 3)

Status: **BUILT (repo-only, fail-closed, nothing deployed/granted).** The governed write authority for the
Opportunity lifecycle. Extends the Cycle-2 read-first workspace; the workspace still reads a synthetic source
and is unchanged by this cycle.

## 1. What this adds and why it is inert

Cycle 2 shipped read-first. Cycle 3 adds the **write authority** for the ratified lifecycle, built the same
way as every governed catalog write in this repo: a **PURE command core** + a **thin onCall callable adapter**,
authorized by a **capability** (not a role), writing through the **Admin SDK** to an Admin-SDK-only collection.

It is deliberately inert:
- The capability `opportunity.write` is registered **`active: false`** → a hard DENY for every principal until
  a separate Owner grant. **Register ≠ grant.**
- The callables `createOpportunity` / `transitionOpportunity` are **exported but not deployed**. **Export ≠
  deploy.**
- The `opportunities` collection has an explicit **deny-all** Rules block (client read + write denied);
  merging changes nothing live, and **deploying Rules is a separate Tier-2 operator action** (not done here).

So this PR builds and proves the write path while remaining fully fail-closed in production.

## 2. Ratified lifecycle + the minimal transition graph

`IDENTIFIED → QUALIFYING → SOLUTION → QUOTING → CUSTOMER_REVIEW → DECISION → (WON | LOST)`

The transition authority is intentionally **minimal and defensible** (anything broader is a lifecycle-change
decision that needs a new Owner decision, so it is not permitted here):
- **Advance** forward by **exactly one** stage.
- **LOST** may be set from **any open** stage (a deal can be lost anytime).
- **WON** may be set **only from DECISION** (a commitment follows a decision).
- A **closed** opportunity (WON/LOST) accepts **no** further transition.

This graph exists in two mirrored places, kept in sync: the write authority
(`functions/src/opportunity/opportunityLifecycle.ts`, the server truth) and a read-side mirror in
`field-ops-app-vite/src/domain/opportunityLifecycle.js` (`nextStage`, `allowedActions`) so the UI only ever
offers actions the server will accept. The server always re-validates and is the authority.

## 3. Pre-commitment invariants (fail-closed)

- **Product-level lines only.** A solution line is `EQUIPMENT_MODEL | PART | SERVICE` referencing a product/
  model/part. A line carrying a serialized-asset reference (`serial`/`serializedAssetId`/`equipmentId`) is
  **rejected** (`SERIALIZED_LINE_FORBIDDEN`). Serialized allocation happens downstream of WON → Sales Order →
  fulfillment — never while selling.
- **Owner is a canonical Employee** (`ownerEmployeeId`), required; never free text or a UID.
- **Pre-commitment.** The command never creates inventory movement, warehouse demand, Work Orders, or
  invoices. Creation always starts at `IDENTIFIED`, open.

## 4. Files

| File | Role |
|------|------|
| `functions/src/opportunity/opportunityLifecycle.ts` | PURE lifecycle authority: stages/outcomes/channels + `checkTransition` graph |
| `functions/src/opportunity/opportunityCommands.ts` | PURE `buildCreateOpportunity` / `buildTransitionPatch` + fail-closed error codes |
| `functions/src/opportunity/opportunityCallables.ts` | onCall `createOpportunity` / `transitionOpportunity`: actor from `request.auth.uid`, capability-gated, Admin-SDK write, runTransaction |
| `functions/src/access/permissionCatalog.ts` (+ field-ops mirror) | registers `opportunity.write` `active:false` |
| `functions/src/constants/collections.ts` | `OPPORTUNITIES_COLLECTION` |
| `functions/src/index.ts` | exports the callables (export ≠ deploy) |
| `firestore.rules` (+ `field-ops-app-vite/firestore.rules`) | `opportunities` deny-all (Admin-SDK-only); hash re-pinned in `verifyTruckRegistryDeployment.js` |
| `field-ops-app-vite/src/domain/opportunityLifecycle.js` | read-side transition mirror (`nextStage`, `allowedActions`) |
| `functions/test/opportunityCommands.test.mjs` (10) · `field-ops-app-vite/test/opportunityLifecycle.test.mjs` (+2) | tests |
| `.github/workflows/sales-opportunity-command-tests.yml` | offline CI for the write core |

## 5. Rules posture

`opportunities` is Admin-SDK-only, matching the ledger/warehouse/equipment precedent: an explicit
`allow read, write: if false;` block (self-documenting fail-closed; Firestore also default-denies unmatched
paths). The trusted command uses the Admin SDK and bypasses Rules. Both rule mirrors are byte-identical;
`GOVERNED_RULES_SHA256` is re-pinned to the new source. **No Rules deploy is performed** — that is a separate
Tier-2 operator action requiring its own authorization.

## 6. Not built here (later cycles)

- **Deploy + grant** of the write path (each Owner-gated).
- **Workspace write wiring** (Cycle 3b): surface `allowedActions` in the Opportunity detail as a governed
  write-readiness seam (actions disabled/honest until the capability is granted and the callable deployed).
- A governed **read model** replacing the synthetic source.
- Estimate/quote inside the Opportunity; Won → Sales Order → fulfillment (where serialized Equipment and the
  Multi-Equipment Fulfillment cardinality question — register capability #14 — are resolved).
