# Post-Certification Backlog Reconciliation — 2026-09-02

**Status:** RECONCILIATION. Two product changes (a reporting label; the deletion of a never-written
ledger movement type), no authority change, no Rules/capability/grant change, no deployment, no
Certification mutation.

Measured against `origin/main` = `ba4d5f8e` (`docs(customer-1): reopen CI cost-containment gate on
measured docs-only build`). The formal Certification closeout `a81e5b47` **is** an ancestor of that
SHA; three commits have landed since, all documentation.

Main advanced to `5824df2a` during this pass (#1762 purchase-order price capture, #1763 legacy
stock-location retirement); every disposition below was re-verified against that tip, and none
changed.

**This document does not amend the Certification result.** The closeout
([`certification-program-closeout-2026-09-02.md`](certification-program-closeout-2026-09-02.md))
recorded nine findings as TRANSFERRED, and it was correct when written. What follows is the
disposition of those nine against source as it stands today. The frozen Certification evidence
(environment `eos-platform-certification`, world `COMPLETE`, dataset `1.8.0`, 1093/1093, fingerprint
`1782e853`, Private-AI 19/19, inventory verifier 38/38) was not read, replayed, regenerated or
touched.

---

## 0. Summary

| finding | disposition |
|---|---|
| CERT-RECV-09 | RETIRED — frozen Certification tooling, reuse condition recorded |
| CERT-RECV-10 | CLOSED — NOT A DEFECT on current source; both fields refused, with reasons |
| CERT-FIN-01 | CLOSED — resolved by current source (FIN-BLOCK-003A, Decision #164) |
| CERT-FIN-02 | OPEN — Owner/accounting policy authority required; already has a governed home |
| CERT-FIN-03 | FIXED — reporting label now names the collection it binds to |
| CERT-PURCH-SIG-01 | RETIRED — frozen Certification tooling, reuse condition recorded |
| CERT-PURCH-DOCDRIFT-01 | RETIRED — frozen Certification tooling, reuse condition recorded |
| CERT-GRANT-DRYRUN-01 | RETIRED — frozen Certification tooling, reuse condition recorded |
| CERT-LEDGER-COUNTED-08 | FIXED — the dead `COUNTED` movement vocabulary is deleted |

---

## 1. CERT-RECV-10 — the receipt's ledger movement carries no `operatingCompanyId` or classification

**Disposition: CLOSED — NOT A DEFECT.** No code change. Neither field has the source authority that
would justify putting it on a ledger event, and the lineage the finding worried about is already
intact.

### `operatingCompanyId`

It is **not** intrinsic to a movement, and it is **not** unconditionally available at the transaction
boundary. `receiveInventoryStockCommand.ts:434` guards the acquisition-cost fact on
`resolved.canonical.operatingCompanyId !== null` precisely because a receipt can legitimately proceed
without a governed company (DECISIONS #164 ruling 12: *"a priced purchase with no governed company
produces no fact"*). A field that is required on the event but unknown at half the call sites is not
a fact; it is a hole with a name.

It **is** canonically derivable, twice over, from records that already own the answer:

- the movement's `sourceObject` is `{ type: "RECEIVING_ORDER", id: receivingId }`, and the receipt
  resolves to the purchase transaction that carries the governed company;
- the movement's `location` resolves to a warehouse, and
  `ownership/warehouseRootCompanyAssignment.ts` makes `warehouses.operatingCompanyId` a governed,
  **non-reassignable** assignment (R-19: same company is idempotent, different company is REFUSED).
  A derivation whose source cannot be reassigned is stable over history, which is what makes it safe
  to derive rather than copy.

There is also no lineage gap to repair. `buildAcquisitionCostFact` already stores `receivingId`,
`receivingLineId`, `partId`, `receivedQuantity`, `receivingLocationType` and `receivingLocationId`
(`finance/acquisitionCost.ts:100-126`) — the same identity coordinates the ledger event carries.
Physical evidence and cost evidence are joinable today, and both are written by the same
all-or-nothing commit.

Finally, making it a required stored key would break read compatibility. The stored record has a
strict key allowlist and a fail-closed deserializer (`operationalMovementRepository.ts:102-146`), and
the fingerprint is computed over the value — so a new required field would make every historical row
deserialize as malformed rather than merely older.

### `classification`

There is no such ledger fact, and no governed producer or consumer contract for one. The only
`classification` in this subsystem is `LedgerDocClassification` = `"operational" | "legacy" |
"malformed"` (`operationalMovementTypes.ts`), which is **derived at read time** by
`classifyLedgerDoc` from the disjoint type sets plus `schemaVersion`. Storing a derived read-side
verdict on the record it classifies would let a stored string disagree with the record it describes —
the malformed case would be able to call itself operational. The unrelated `EffectClassification` in
`inventoryEffectDetection.ts` is a Work-Order sync diagnosis, not a ledger field.

`AUTHORITY_REQUIRED` would overstate it: nothing in the repository names a stored movement
`classification`, so there is no decision pending. If a future requirement wants one, it needs its
own vocabulary and its own ruling first.

---

## 2. CERT-FIN-03 — the reporting catalog's "Purchase Order" object

**Disposition: FIXED.** The catalog object `purchaseOrder` binds to `reorder_purchase_orders` and was
labelled `"Purchase Order"`. `purchase_orders` is a **different** authority — measured empty, with the
source-of-record contract explicitly recorded as unresolved in
`field-ops-app-vite/src/metadata/recordPageManifest.js` — so a reporting result carrying that label
claimed a source it never read.

The label is now `"Reorder Purchase Order"` in both mirrors:

- `field-ops-app-vite/src/domain/reporting/reportCatalog.js:65` (the authoring copy)
- `functions/src/reporting/reportCatalog.ts:94` (the server port)

**What did NOT change.** The binding is still `reorder_purchase_orders`. `objectId` is still
`purchaseOrder`, so `report.purchaseOrder.read` and every `report.purchaseOrder.field.*.read`
capability id is byte-identical — no grant, catalog or Rules surface moved. No collection was merged,
no record migrated, no fallback introduced, no purchasing transactional logic touched. Object labels
must be unique within the catalog (`reportCatalogValidation.js:47`) and `"Reorder Purchase Order"` is
distinct from `"Reorder Request"`.

---

## 3. CERT-LEDGER-COUNTED-08 — the `COUNTED` movement type

**Disposition: FIXED — deleted.** The type, its `SNAPSHOT` direction and its `COUNT_SHEET` source
object are gone from both mirrors.

> **This disposition was corrected during the pass.** It was first recorded as
> `OPEN — EVIDENCE (DATA_CENSUS_REQUIRED)` on the belief that a stored `COUNTED` row would start
> throwing `MalformedStoredRecordError` in live readers once the type was removed. That was wrong.
> Every reader guards with `classifyLedgerDoc(...) !== "operational" → continue` **and** catches a
> deserialize throw with `continue`, so a stored row cannot fail a read — it can only be skipped.
> The census was never needed. The corrected reasoning is below.

**Producer census — dead, proven.** `stageOperationalMovement` has exactly three call sites
(`inventoryReceiving/receiveInventoryStockCommand.ts:365`,
`inventoryTransfer/transferOrderCommand.ts:340,430`, `cycleCount/cycleCountCommand.ts:404,420`) and
none emits `COUNTED`. Cycle Count reconciliation stages `ADJUSTED` (`cycleCountTypes.ts:20`). The
source-object type `COUNT_SHEET` exists to serve `COUNTED` and nothing else.

**Do not confuse the two `COUNTED`s.** The Cycle Count workflow *status* `COUNTED`
(`CYCLE_COUNT_STATUSES`) is live, correct and out of scope here. Only the operational *movement type*
is dead.

**Arithmetic is already safe.** Every aggregation excludes it —
`cycleCount/cycleCountExpectedQuantity.ts:52`, `inventoryLedger/mobileLocationPresenceProbe.ts:122`,
`inventoryAnalyticsCallables.ts:26`, `fulfillment/fulfillmentAvailability.ts` — and
`certificationUnobservedSemantics.test.mjs:61-64` asserts a `COUNTED` row of any quantity contributes
nothing to on-hand.

**No reader contract required it — this is what made the census unnecessary.** Every consumer treats
an unrecognised operational type exactly as it treated `COUNTED`: as nothing.

- The three deserializing readers (`cycleCountExpectedQuantity.ts`, `mobileLocationPresenceProbe.ts`,
  `transferOrderCommand.ts`) each guard with `classifyLedgerDoc(data) !== "operational" → continue`
  **before** deserializing, and wrap the deserialize itself in `try { … } catch { continue }`. A
  stored `COUNTED` row cannot fail a read; it is skipped.
- Their arithmetic is an **allowlist** of `if/else if` branches over the six surviving types, not a
  filter with exceptions. A row that matched no branch before now never reaches the branches at all.
  The contribution is zero either way.
- `fulfillmentAvailability.ts:95` is likewise an allowlist (`PHYSICAL` set) reading the raw stored
  string; it never imported the enum and is untouched.
- Nothing counts or reports `"malformed"` rows in this subsystem, so the reclassification is not
  visible on any surface. (`malformedOmitted` belongs to `equipmentCompatibility`, unrelated.)
- The UI already agreed: `metadata/definitions/inventoryTransaction.js` omitted `COUNTED` from the
  stored `type` enum, and its header already documented that the type had no live writer.

So the §6 precondition "no stored historical rows requiring compatibility" is satisfied on **source**
evidence rather than data evidence: compatibility is not required, because no reader's behaviour
depends on the type being declared. A row-count in a live environment would have changed nothing.

**What was deleted**

- `COUNTED` from `OPERATIONAL_MOVEMENT_TYPES`, `MOVEMENT_DIRECTION` and `MOVEMENT_SOURCE_TYPE`
- the `SNAPSHOT` movement direction and its `quantity >= 0` validator branch — it existed only for
  `COUNTED`
- `COUNT_SHEET` from `SOURCE_OBJECT_TYPES` — likewise
- `SNAPSHOT` from the `direction` enum in `metadata/definitions/inventoryTransaction.js`

in both mirrors (`functions/src/inventoryLedger/operationalMovementTypes.ts` +
`operationalMovementValidation.ts`, and `field-ops-app-vite/src/domain/inventoryLedgerEvent.js`),
with a comment at each declaration saying why it must not come back. A new test —
*"COUNTED is retired — the type, its direction and its source are all gone"* — is the guard.

**Not changed:** the Cycle Count workflow status `COUNTED` (`CYCLE_COUNT_STATUSES`), its
capabilities, its state transitions, and every number every aggregation produces.

---

## 4. CERT-FIN-01 — no procurement-side financial authority

**Disposition: CLOSED — RESOLVED BY CURRENT SOURCE.** No code added.

`functions/src/finance/acquisitionCost.ts` (FIN-BLOCK-003A, DECISIONS #164, merged as `25da85cb`
before the closeout) supplies a governed acquisition-cost fact for purchased physical goods, and
`functions/test/acquisitionCost.test.mjs` (43 tests, plus the 22-test `acquisitionCostActivation.test.mjs` added by #1762) asserts each property the finding asked for:
integer minor units with an explicit currency and floats refused; unknown is `null`, never zero;
created inside the receipt's own transaction with a deterministic `(receivingId, lineId)` identity so
duplication is impossible by shape; a partial receipt priced for the quantity received; and
`operatingCompanyId` required, never inferred from warehouse, vendor, SKU, user or customer.

**This closes cost SUPPLY and nothing else.** Valuation, COGS, gross margin, landed cost, labour cost
and cost-correction authority all remain open — asserted, not merely stated, by the same suite
(`"valuation remains OPEN"`, `"COGS remains OPEN"`, `"an acquisition fact is NOT a GovernedCostFact —
margin still returns UNKNOWN"`).

---

## 5. CERT-FIN-02 — no inventory valuation measure exists

**Disposition: OPEN — OWNER / ACCOUNTING POLICY AUTHORITY REQUIRED.** No implementation, and none
attempted.

No approved valuation or cost-flow policy exists in source. The absence is deliberate and guarded:
`acquisitionCost.ts:53` keeps `WEIGHTED_AVERAGE`, `FIFO`, `LIFO`, `STANDARD_COST`,
`REPLACEMENT_COST` and `LABOR_BURDEN` **absent as values** so that pre-registering one cannot suggest
a method was chosen, and a test fails if any appears. DECISIONS #164 rulings 16–18 hold valuation,
COGS and margin open explicitly.

**It already has a governed home, so no new decision package was created.** The questions live in
[`../financials/FIN-BLOCK-003_COST_AUTHORITY_DECISION_PACKAGE.md`](../financials/FIN-BLOCK-003_COST_AUTHORITY_DECISION_PACKAGE.md)
§4 (basis vocabulary and admissibility; capture point and the Epic-5 question; labour cost policy;
ND-27 valuation authority; freight-in D-6) and in the re-measurement
[`fin-block-003-cost-supply-reconciliation.md`](fin-block-003-cost-supply-reconciliation.md).

Two questions the finding implies are **not** in that §4 list, recorded here rather than added to an
Owner-facing package by this pass:

1. **Cost-correction authority.** DECISIONS #164 ruling 11 states corrections must be additive and
   that the authority is OPEN. Nothing names who may issue one, or on what evidence.
2. **Retroactive cost change.** Whether a later-discovered price error may produce a superseding fact
   at all, and what a downstream reader is required to do with the pair.

Currency treatment beyond a single currency, and historical opening inventory value, are subsumed by
ND-27 and by the "no cost backfill under any outcome" constraint already recorded in the package.

---

## 6. Frozen Certification tooling — CERT-RECV-09, CERT-PURCH-SIG-01, CERT-PURCH-DOCDRIFT-01, CERT-GRANT-DRYRUN-01

All four live under `functions/scripts/certificationWorld/`. The Certification program is CLOSED and
no further ceremony is authorized, so **none of these has current product exposure and none was
edited.** Editing frozen tooling to make a finding disappear would churn historical evidence for no
behavioural gain. Each is retired with a reuse precondition instead: the condition binds any future
re-homing of the functionality, not the frozen file.

### CERT-RECV-09 — `executeG03Receipt.mjs` declares "EMULATOR ONLY" and enforces nothing

**Verified: still present.** The header comment at `executeG03Receipt.mjs:22` reads `EMULATOR ONLY.`
while `applyGoldenReceipt.mjs:56,63` imports `executionTarget.mjs` **and** this helper for a
live-capable Certification wrapper.

**Disposition: `RETIRED_WITH_FROZEN_CERTIFICATION_TOOLING`.** No code change. Adding an emulator-only
guard inside the shared helper would break exactly the reuse the wrapper was built on — it would
retroactively invalidate the tool that produced the frozen evidence.

**Reuse condition:** if this receipt machinery is ever needed for ordinary development or a future
certification, re-home it behind `executionTarget.mjs` (or its successor) as a first-class execution
gate, with documentation that names every target it can actually reach.

### CERT-PURCH-SIG-01 — `orderSignature` content signature

**Verified, and the transferred framing needs one correction: part identity IS included.**
`data/purchasingPlan.mjs:174-181` computes a signature of the form
`supplierId|partId:qty,partId:qty` over sorted lines, so there is no part-identity collision. The
closeout's own wording is the accurate one: the signature excludes **unitPrice, buyer, intent and
target status**. The file states the trade explicitly — `createPurchaseOrder` takes no idempotency
key, so content matching is the fixture-appropriate substitute, and two legitimately identical orders
are indistinguishable from a replay.

**Disposition: `RETIRED_WITH_FROZEN_CERTIFICATION_TOOLING`.** No code change.

**Reuse condition:** any future *ordinary* purchasing planner or applier must use a real
collision-resistant idempotency key — not a content signature — before first use, and that key must
cover price, buyer and intent, not only supplier and line quantities.

### CERT-PURCH-DOCDRIFT-01 — stale target prose in `applyPurchasingPlan.mjs`

**Verified: still present.** Lines 21 and 45–46 say emulator or `eos-platform-sandbox` only, and name
`--apply-live-sandbox` as the live flag. The shared gate it actually calls also admits
`eos-platform-certification` via `--apply-live-certification` (`executionTarget.mjs:44,50,68`). The
prose is narrower than the gate, which is the safer direction to drift but still untrue.

**Disposition: `RETIRED_WITH_FROZEN_CERTIFICATION_TOOLING`.** No cleanup-only edit to a frozen script.

**Reuse condition:** any re-homed tooling must document every target its gate can reach, and that
documentation must be derived from the gate rather than restated beside it.

### CERT-GRANT-DRYRUN-01 — `applyRoleGrants` dry run classifies without consulting live state

**Verified: still present.** `applyRoleGrants.mjs:229-231` marks every non-privileged grant
`WOULD_APPLY` without reading current assignments, while the apply path detects `ALREADY_APPLIED`
before calling (`:266,282`). A dry run therefore over-reports what an apply would do.

**Disposition: `RETIRED_WITH_FROZEN_CERTIFICATION_TOOLING`.** No code change. Nothing about access
authority, capability grants, Rules or roles was touched by this pass.

**Reuse condition:** any future ordinary grant-planning tool must read current assignment state
during dry run and report `ALREADY_APPLIED` there too, while remaining strictly write-free.

---

## 7. What this pass did not do

No Firestore Rules, capability registry, grant catalog, role assignment, state machine, numbering,
transactional or audit surface was modified. No collection was merged or migrated. No fixture was
used as evidence of production state. No environment was written to, and nothing was deployed. The
Certification world was not opened.

**Deployment required: NO.** The two artifacts are a display label in a pure data catalog, and the
removal of a movement type that no writer ever produced and no reader's arithmetic depended on.
Neither activates anything or changes an authorization decision, and neither alters a number any
existing surface reports.
