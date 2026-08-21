---
artifact_type: release
gate: Sandbox scanner — persona grants applied, twelve scenarios validated
status: 39/40 checks passing. One redeploy outstanding (getPartBalance).
date: 2026-08-21
target: eos-platform-sandbox — sandbox only, never taylor-parts
---

# Sandbox scanner — persona grants and validation

## 1. Grants applied

Through the governed `grantRole` path (`functions/scripts/operatorAccessCommand.js`), each with a
named recipient, a stated need and an operator-supplied idempotency key. Eight grants, all
`status: applied`, re-runs returning `alreadyApplied`.

| Persona | Roles added | Roles already held |
| --- | --- | --- |
| `sbx-partsassoc` | `inventoryLookupReader`, `inventoryPutAwayOperator` | `inventoryCycleCountCounter` |
| `sbx-partsmgr` | `inventoryLookupReader`, `inventoryPutAwayOperator` | `inventoryCatalogAdministrator`, `inventoryCycleCountReconciler` |
| `sbx-whmgr` | `inventoryLookupReader`, `inventoryPutAwayOperator`, `inventoryReturnsIntakeClerk` | `inventoryTransferOperator` |
| `sbx-tech` | `inventoryLookupReader` | `technician` (compatibility) |

### The reconciliation that changed the plan

The approved manifest had assigned the **cycle-count reconciler** role to `sbx-whmgr`. Reading the
live matrix first showed that was wrong: the sandbox already had a correct separation —
**`sbx-partsassoc` is the counter, `sbx-partsmgr` is the reconciler.** Granting per the manifest
would have moved an approval authority onto a different person for no reason. The existing split was
kept.

## 2. Capabilities intentionally withheld

| Withheld | From | Why |
| --- | --- | --- |
| `inventory.stock.receive` | **every persona** | Owner ruling for this pass. Receiving must produce the expected refusal. |
| `inventoryCycleCountCounter` | `sbx-whmgr` | Owner ruling, and DECISIONS #111 verified current and unsuperseded: a counter cannot approve their own material variance. `sbx-whmgr` holds no cycle-count capability at all. |
| `inventoryBinAdministrator` | all four | No **built scanner workflow** requires `bin.manage`. Bins for validation were created by `admin` through the governed `createBin` command. |

## 3. Before / after — same code, changed authority

Both read back through `resolveEffectiveAccess`, the same path the deployed callables use.

| Persona | BEFORE | AFTER |
| --- | --- | --- |
| `sbx-partsassoc` | LOOKUP, CYCLE_COUNT | LOOKUP, CYCLE_COUNT, **PUT_AWAY, PICK** |
| `sbx-partsmgr` | LOOKUP | LOOKUP, **PUT_AWAY, PICK** |
| `sbx-whmgr` | LOOKUP, TRANSFER | LOOKUP, TRANSFER, **PUT_AWAY, PICK** |
| `sbx-tech` | LOOKUP | LOOKUP (plus the four lookup reads) |

**No deployment happened between these two readings.** The only thing that changed was governed
authority, which is the invariant this pass exists to demonstrate.

Receiving refuses for all four with **`permission_denied`**, not a readiness error — and
`RECEIVING_TRANSPORT_READY` is **`true`** in this sandbox, so the refusal cannot be a readiness
artefact.

## 4. The twelve scenarios — 39/40 checks

Run as real personas, signed in with real passwords, against the real deployed callables over HTTPS.
`scripts/runSandboxScannerScenarios.mjs`.

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 1 | Part-code lookup | resolves, no write | **PASS** |
| 2 | Barcode / alias | resolves; unknown truthful | **PASS** |
| 3 | Serialized lookup | identity, no fabricated quantity | **1 FAIL** — see §5 |
| 4 | Balance / location | governed authority, no van stock in warehouse balance | **PASS** |
| 5 | Multi-line receiving | **REFUSED** (capability) | **PASS** ×4 personas |
| 6 | Put-away | recorded; custody unchanged; wrong bin fails closed | **PASS** |
| 7 | Pick / stage | staged; **reserves nothing** | **PASS** |
| 8 | Warehouse transfer | existing authority; fails closed | **PASS** |
| 9 | Truck handoff | a transfer, no invented lifecycle | **PASS** |
| 10 | Cycle count | counter/reconciler split holds | **PASS** |
| 11 | Return intake | awaiting disposition; restores nothing | **PASS** |
| 12 | Technician reachability | lookup only, nothing inherited | **PASS** |

### Negative validation, all confirmed

Missing capability (receiving ×4, transfer, cycle count ×2, returns, technician ×3) · wrong warehouse
(bin) · unknown identifier (alias `NOT_FOUND`, no fallback part) · malformed input (empty scan) ·
unknown bin · same-location transfer · unregistered truck · unrecognised return condition · replay
idempotency.

**Gate refusals and validation refusals are asserted separately.** The harness requires each case to
declare which it expects: a `permission_denied` where a validation rule was under test means the
persona never had the authority, so the rule was never exercised. An earlier version of the harness
accepted any refusal and reported six such cases as passing.

## 5. Defect found and fixed

**`getPartBalance` let the CALLER decide whether a part had a quantity.**

`PRT-2001` has two serialized units at `wh-main`. Asked with `serialTracked:false`, the deployed
server answered `{ state: "KNOWN", value: 0 }` — a confident zero for a shelf that is not empty, and
exactly the failure the balance service's own header says it exists to prevent. The mirror image was
equally reachable: a quantity-tracked part asked with `serialTracked:true` hid seven real units
behind `NOT_COUNTED_BY_QUANTITY`.

Fixed in **PR #1384**, merge `c32fdf60`: the server resolves the Part and derives the mode from Part
Master's `controlType`; an unresolvable part fails closed. The mapping — which existed as **two
byte-identical private copies** in receiving and transfer, and was about to become three — is now one
shared module both import.

**This is the one outstanding action.** The fix is merged and built but **not yet deployed**, so the
sandbox still returns the old answer. Scenario 3 fails deliberately until it is:

```bash
firebase deploy --only functions:getPartBalance --project eos-platform-sandbox
```

## 6. Rollout state, kept separate

| Dimension | State |
| --- | --- |
| Repository complete | Yes |
| Deployed | Yes — 102 functions, 18/18 scanner callables ACTIVE / nodejs22. `getPartBalance` pending re-deploy. |
| Capability active | Yes, sandbox only — 33 eligible ids, production triple-blocked |
| Granted | Four personas, per §1 |
| Readiness enabled | `RECEIVING_TRANSPORT_READY` true; the other two false |
| Persona user-operable | Lookup, put-away, pick, cycle count, transfer, returns — **not receiving** |
| Scenario validated | 39/40 |

**Receiving is deployed and active and is NOT persona user-operable.** That distinction is the point
of this pass.

## 7. Remaining blockers

1. **`getPartBalance` redeploy** — the only thing standing between 39/40 and 40/40.
2. **A technician cannot accept a truck handoff.** Needs `inventory.transfer.receive`; the only role
   carrying it also confers create/dispatch/cancel — too much for a van. A receive-only role is
   required, and inventing one was out of scope here.
3. **Returns has no scan-workspace UI.** `sbx-whmgr` holds the capability and the callable works, but
   there is no tile — backend-operable only.
4. **No `sbx-whassoc` persona exists**, so Warehouse Associate is unexercised.

None of these blocks handheld UX design work.
