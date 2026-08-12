# Ventana Ice-Machine — Lifecycle & Responsibility Model

**Status:** Specification (design) — implements the next stage called for by the cross-franchise discovery baseline (`cross-franchise-equipment-receiving-installation.md` §25).<br>
**Business authority:** [Ventana Ice-Machine Commercial & Inventory Lifecycle](../business-processes/ventana-ice-machine-commercial-inventory-lifecycle.md) (Owner-confirmed facts) and its sibling [Cross-Franchise Equipment Receiving & Installation](../business-processes/cross-franchise-equipment-receiving-installation.md) (INV-1…INV-10).<br>
**Architecture posture:** Reuse existing Taylor capabilities. Introduces **no** parallel lifecycle, ledger, or custody authority. Adds exactly one **pure, fail-closed projection** (the two-condition inventory-control read) mirrored on both sides, plus a UX read composition. Governed-inert: no Rules, no schema, no deploy, no production data action.

---

## 1. What is actually new

Everything in this lifecycle is already owned by an existing Taylor authority **except one thing**: the rule that Taylor **inventory control** over a serialized ice machine ends only when **BOTH** (1) installation is complete **AND** (2) the associated sale closes. No surface today expresses that two-condition rule, and several would happily collapse it (Equipment renders `ACTIVE`, billing renders eligible, a single delivered/installed/invoiced event reads as "done").

This spec therefore adds one projection — `inventoryControl = f(installationComplete, saleClosed)` — and keeps every other concept where it already lives.

## 2. Reused authorities (no fork)

| Lifecycle stage | Existing Taylor authority | Reused as |
|---|---|---|
| Customer demand → committed order | Opportunity → Sales Order (`salesOrder/salesOrderLifecycle.ts`, states `CONFIRMED→IN_FULFILLMENT→FULFILLED→CLOSED`/`CANCELLED`) | The commercial commitment; **`CLOSED` is "sale closed"** (condition 2) |
| Taylor purchases from Ventana | Purchasing / reorder Purchase Order (`domain/reorderPurchaseOrders.js`) | Records placing the buy from Ventana (Supplier) |
| Receipt into Taylor control | Receiving (`inventoryReceiving/`, **deployed**) + Serialized Asset creation (ADR-010 Ph2) | **Inventory control BEGINS** here; serial captured at receipt |
| Serialized identity / custody / location | Serialized Asset (`domain/serializedAssetIdentity.js`, states `RECEIVED→AVAILABLE→RESERVED→STAGED→LOADED→IN_TRANSIT→DELIVERED→INSTALLED`) | Custody/location/lifecycle state per unit |
| Allocation / reservation (commitment) | `fulfillment/allocateSalesOrder.ts` (allocation recorded **only on `sales_orders`**) | Commitment, **not** an inventory exit |
| Staging / fulfillment / delivery | Serialized Asset states `STAGED/LOADED/IN_TRANSIT/DELIVERED`; Transfer Orders (ADR-010) | Physical movement; **delivery is not sale close** |
| Installation complete | Installation link (`domain/serializedAssetInstallation.js`) → Equipment `INSTALLED` (ADR-010 §3) | **Installation complete** (condition 1) |
| Billing | `fulfillment/billingEligibility.ts` + Finance (`finance/*`, inert) | Eligibility only; **invoicing is neither condition** |
| Coordinated multi-machine visit | `fulfillment/coordinatedVisit.ts` / `coordinatedFieldMission.ts` | The C713×5 accountability-of-many / experience-of-one readout |
| Post-install service / warranty | Equipment (ADR-006) + Work Orders | Service responsibility (independent axis) |

## 3. Independent axes (INV-1/INV-4; never collapse)

Nine facts about one machine, each carried by its own authority. A surface that derives one from another has collapsed the model:

`inventoryControl` · `ownership/title` · `custody (holder)` · `availability` · `commercialSeller` · `fulfillmentResponsibility` · `serviceResponsibility` · `warrantyResponsibility` · `billingResponsibility`.

The two load-bearing separations for this work:
- **INV-2 / INV-4:** inventory presence and operational controls (HOLD, allocation, Work Order) never establish availability or ownership. A machine committed to a sale is *present and unavailable*.
- **Baseline §6:** "inventory control ended" ≠ "customer owns it". Ownership (title) transitions on its own axis and is **never inferred** from the inventory-control state.

## 4. The two-condition inventory-control projection (the new module)

Pure, deterministic, framework-independent, fail-closed — mirroring `billingEligibility.ts`. Consumes **derived boolean signals** (each side derives them from its own authority), never raw documents, so it is identical on both sides.

**Inputs** (each `boolean | null`; `null`/absent ⇒ unknown):
- `controlBegan` — a receipt into Taylor control exists (Serialized Asset reached `RECEIVED` under a Taylor receipt).
- `installationComplete` — Serialized Asset `state === "INSTALLED"` with a reciprocal Equipment link.
- `saleClosed` — Sales Order `state === "CLOSED"`.

**Output** `state`:
- `UNKNOWN` — any required signal is `null`/absent/contradictory (fail closed; never assume `false`).
- `NOT_STARTED` — `controlBegan === false` (no receipt into Taylor control; e.g. Ventana drop-ship that never entered Taylor custody).
- `EXITED` — `controlBegan && installationComplete && saleClosed`.
- `CONTROLLED` — control began and at least one condition is unmet; `unmetConditions ⊆ {INSTALLATION_INCOMPLETE, SALE_OPEN}`.

**Non-conditions (proven, not inputs):** `allocated`, `delivered`, `invoiced` are accepted only as **display context** and can never flip `CONTROLLED → EXITED`. Passing all three `true` while a condition is unmet still yields `CONTROLLED`.

**Ownership guard:** a companion selector returns title as `UNKNOWN` unless an **explicit** title fact is injected. It refuses to read title from `inventoryControl`, and vice-versa.

**Legible partials:** `installed, sale open` and `sale closed, not installed` are first-class `CONTROLLED` sub-states with distinct copy — never "complete".

## 5. Coordinated multi-machine (C713 × 5)

`saleClosed` is **per order**; `installationComplete` is **per unit**. For a 5-unit line (product-level qty 5, one line — the Sales Order cardinality invariant), each serial gets its own `inventoryControl`. Order-level control **EXITS only when every unit that entered Taylor control is `EXITED`** **and** the order is `CLOSED`. "4 installed / 1 blocked, sale open" reports **0 units exited** and an order still fully under control — the baseline §9 two-condition problem, expressed honestly.

**`NOT_STARTED` units are outside the denominator.** A drop-ship unit on the same order (never received into Taylor custody) is `NOT_STARTED` and is **excluded** from the exit denominator — it is never counted as controlled and can never strand the order. So an order of 3 Taylor-controlled units (all exited) + 2 drop-ship units rolls up to `EXITED` over the units Taylor actually controlled, while the 2 drop-ship units are surfaced separately (`notStartedUnits`); an order of only drop-ship units rolls up to `NOT_STARTED`, never a phantom "controlled" order.

## 6. Routed questions (§8 of the baseline) — resolved vs Owner-gated

| Routed question | Disposition |
|---|---|
| Serial capture point & receiving procedure | **Resolved** — existing Receiving (`inventoryReceiving/`) + ADR-010 Ph2 serial creation. Serial captured at receipt. No new workflow. |
| Allocation/reservation mechanism & visibility | **Resolved** — `allocateSalesOrder` records allocation on `sales_orders` (`allocatedQty` + `selectedSerialIds`); visible as a commitment; allocation ≠ exit (proven in tests). |
| Sale-close **mechanism** (the 2nd condition) | **Resolved (mechanism), with a load-bearing caveat** — Sales Order `CLOSED`. The projection consumes the `CLOSED` signal. **The strength of the entire two-condition guarantee equals the strength of the `CLOSED` criteria**, and today `salesOrderLifecycle.ts` reaches `CLOSED` via a plain `ADVANCE` from `FULFILLED` with **no payment/acceptance gate** — so an operator can advance a fulfilled order to `CLOSED` without a commercial close, which would satisfy condition 2 prematurely. Defining that gate is **D-5** and is the single most important Owner decision here. |
| Invoicing/payment timing vs the two conditions | **Resolved (relationship)** — invoicing is neither condition; `billingEligibility` already separates it; enforced here (invoiced ≠ exit). Exact billing *policy* stays Finance-domain (deferred), unaffected. |
| Drop-ship: does control ever begin? | **Resolved by construction, Owner-confirm** — with no Taylor receipt, `controlBegan === false ⇒ NOT_STARTED`. Correct fail-safe; Owner confirms the business intent (see gate D-4). |
| Ownership/title transfer point (Ventana→Taylor→customer) | **Owner (D-1/D-2)** — genuine policy; kept on its own axis, never inferred. |
| Do cross-franchise INV-1…INV-10 apply to Ventana (a separate operating company)? | **Owner (D-3)** — the universal inventory-safety invariants (custody≠ownership, presence≠availability) are enforced regardless; whether the *seller≠fulfiller cross-company framing* applies to Ventana→Taylor is the genuine unknown. |
| Sale-close **criteria** (what business event closes the sale) | **Owner (D-5)** — Sales-domain policy; does not block this projection. |
| Freight & warranty responsibility for Ventana-sourced | **Owner (D-6)** — separate axes; not required to build the exit rule. |
| Cancellation / return / damaged-machine disposition | **Owner (D-7)** — `CANCELLED` SO + ADR-010 uninstall/return exist; disposition policy is variable (cross-franchise baseline §21). |

## 7. Owner decision gate — RULED 2026-08-11 (D-5 remains the only load-bearing open item)

The Owner ruled on all seven. Six are resolved and encoded; **D-5 is the single genuine unresolved business rule** and is enforced fail-closed in code until Taylor defines it.

- **D-1 — Ventana→Taylor title: RULED YES.** Taylor takes title on purchase/receipt from Ventana under the normal purchase process (Taylor-owned purchased equipment, *unlike* the cross-franchise custody case). Exact legal timing may live as Finance metadata. Encoded: `resolveVentanaChainTitle({purchasedFromVentana:true}) → TAYLOR`.
- **D-2 — Taylor→customer title: RULED at successful delivery/acceptance** — **not** installation-complete, **not** sale-close. Ownership, installation, commercial close, and inventory control stay independent. Encoded: `resolveVentanaChainTitle({deliveredAndAccepted:true}) → CUSTOMER`.
- **D-3 — Ventana is the upstream SUPPLIER, not cross-franchise. RULED.** Reuse only the universally-valid invariants (custody≠ownership, presence≠availability, billing≠ownership); do **not** inherit Taylor↔Taylor responsibilities/authorities. (No cross-franchise authority is imported by this work.)
- **D-4 — Drop-ship: RULED `NOT_STARTED`.** A Ventana-direct-to-customer machine Taylor never takes custody of has no inventory-control phase; the commercial purchase/sale is tracked separately. Encoded + tested.
- **D-5 — Sale-close criteria: UNRESOLVED (load-bearing).** `FULFILLED→CLOSED` with no payment/acceptance/business gate is too weak to control inventory responsibility. Taylor must decide whether the sale is closed at invoice finalization, customer acceptance, payment/AR posting, installation-paperwork completion, some combination, or another existing accounting event. **Enforced fail-closed:** `inventoryControlView.js` exports `SALE_CLOSE_CRITERIA_RATIFIED = false`; a bare `CLOSED` yields an **UNKNOWN** sale-close signal (never a premature exit) — only an explicit authoritative-close fact (`saleCloseAuthoritative`) or flipping the flag once D-5 is ratified lets a machine EXIT.
- **D-6 — Freight & warranty: RULED separate fields/processes, not lifecycle gates.** Warranty follows the applicable manufacturer/Taylor warranty process; freight damage goes through receiving exception/claim handling. Any Ventana-specific commercial agreement is captured later, not invented. (Generic separation already holds; these axes are not exit conditions.)
- **D-7 — Cancellation/damage: RULED HOLD / disposition-required, never auto-return-to-available.** A committed machine whose sale cancels or whose condition is compromised needs an explicit disposition (return to stock, return to Ventana, reallocate, scrap/claim) with reason + audit. Encoded: `resolveCancelOrDamageDisposition(...) → {disposition: DISPOSITION_REQUIRED, autoReturnToAvailable: false, reasonRequired: true}`.

## 8. UX behavior (baseline §7)

1. No single event renders as completion. Delivered/installed/invoiced each show their own axis; only `EXITED` (both conditions) reads as inventory-control complete.
2. Two conditions → two indicators. Partial states (`installed, sale open`; `sale closed, not installed`) stay legible.
3. "In inventory" ≠ "available". A committed unit shows present + unavailable.
4. One vocabulary across Sales/Purchasing/Receiving/Warehouse/Work Order/Equipment for the same machine.
5. Custody chain shows a visible holder at each hop.

**Implementation status of the UX layer.** These behaviors are implemented and unit-tested as a pure read-composition view-model, `field-ops-app-vite/src/domain/inventoryControlView.js` (`buildMachineInventoryControlView` / `buildCoordinatedOrderView`), covered by `test/inventoryControlView.test.mjs` — an end-to-end walk of the real serialized-asset lifecycle states against an advancing Sales Order, plus the C713×5 order. Like its sibling projections (`billingEligibility.ts`), it is the composition layer and holds no authority; **wiring it into a specific React surface (e.g. the Equipment register or the coordinated-visit readout) is the next increment** and is intentionally not done here to avoid presuming an information-architecture change ahead of the UX-journey evidence (baseline §9 / C713×5 Round 3).

## 9. Boundaries

Pure/inert. No Firestore schema, Rules, Functions deploy, migration, or production-data action. Ownership/title, sale-close criteria, freight/warranty, and disposition policy are **not** invented here — they are routed to the Owner gate (§7).
