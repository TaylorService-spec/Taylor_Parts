---
artifact_type: specification
workstream: sales-to-cash-to-commission-lifecycle
title: Complete Sales-to-Cash-to-Commission Lifecycle — governed end state, actor/capability matrix, and separation of duties
status: DRAFT — for review (F1), REVISED after review (C1–C6) + repository reconciliation. Design only. Nothing built, activated, deployed, or mutated.
date: 2026-08-14
owner: Owner (business authority) · Claude Code (author)
base_commit: 26885df7
depends_on:
  - docs/design/per-environment-capability-activation-spec.md   # per-env activation (spine), #970 merged
  - PR #971 feat/spine-role-grants                              # Phase 6a role grants (OPEN, unchanged by this doc)
  - docs/specifications/enterprise-access-and-administration-platform.md  # governed Role/Permission model
  - docs/roadmaps/business-capability-register.md               # capability register
scope: >
  Specifies the COMPLETE governed sales lifecycle end state — Opportunity through
  reconciled customer payment, commission eligibility, Controller approval,
  commission payable, and recorded salesperson payment, with full audit lineage —
  and the actor/capability matrix and separation-of-duties model that governs it.
  This is a reviewed DESIGN artifact only. It authorizes NO implementation, NO
  capability activation, NO deployment, NO persona mutation, and NO production change.
---

# Complete Sales-to-Cash-to-Commission Lifecycle (F1 specification)

## 0. Boundaries (read first)

- **Design only.** No code, no capability activation, no deploy, no persona/data mutation, no production change is authorized by this document.
- **PR #971 (Phase 6a role grants) is untouched** by this spec and remains subject to AUTH-CORE section-boundary review. Nothing here modifies its scope.
- **Phase 7 (Opportunity → Invoice) is a PARTIAL milestone**, explicitly *not* the completion of the sales lifecycle. Completion criteria are in §12.
- Everything net-new here inherits the program's **GRANT ≠ ACTIVATION** rule: new capabilities are registered `active:false` and are exercisable only where the per-environment activation override is on (`platform-sandbox`), never in production, until separately authorized.

## 1. The governed lifecycle (authoritative end state)

The complete governed chain (Owner-directed 2026-08-14):

```
Opportunity
→ Sales Order
→ Allocation and Service
→ Work Order execution
→ Inventory consumption and reconciliation
→ Operational fulfillment
→ Invoice
→ Customer payment
→ Payment reconciliation
→ Commission eligibility
→ Controller approval
→ Commission payable
→ Salesperson payment
→ Complete audit lineage
```

Invoice Issued is a **mid-lifecycle** state, not the end. The lifecycle is finished only when the criteria in §12 hold.

### 1.1 Stage → actor → capability → record (summary)

| # | Stage | Primary actor(s) | Governing capability | System of record | Status |
|---|---|---|---|---|---|
| 1 | Opportunity author/advance | Salesperson (own-scope) | `opportunity.write` / `opportunity.read` (attribution-bound, §2.1/C3) | opportunities | exists (active:false) |
| 2 | WON → Create Sales Order | Salesperson (from owned Opp) / Admin | `opportunity.createSalesOrder` (Salesperson, own-scope); `salesOrder.write` (Dispatcher/Admin, NOT Salesperson) | sales_orders | exists (active:false) |
| 3 | Allocation | **Dispatcher** (commercial record); Warehouse/Parts (physical) | `salesOrder.fulfill` = Dispatcher-owned allocation record; `inventory.allocation.reserve` [N] = Warehouse/Parts (§6). Warehouse/Parts do NOT hold `salesOrder.fulfill`. | sales_orders (allocation) + inventory | partial |
| 4 | Service demand | Dispatcher | `salesOrder.service` | work_orders (demand lineage) | exists (active:false) |
| 5 | Work Order execution | Technician / Shop-Service Mgr | `workOrder.transition`, NET-NEW tech caps (§7) | work_orders | partial |
| 6 | Inventory consumption + reconciliation | Parts Mgr/Assoc, Warehouse Mgr, Technician | NET-NEW pick/issue/return/reconcile caps (§6) | inventory ledger | NET-NEW |
| 7 | Operational fulfillment confirmation | Dispatcher | NET-NEW `salesOrder.fulfillment.confirm` (§6) | sales_orders (fulfilled) | NET-NEW |
| 8 | Invoice | Accounting | `finance.invoice.issue` | invoices | exists (active:false) |
| 9 | Customer payment recorded | Accounting | `finance.payment.apply` | payments | exists (active:false) |
| 10 | Payment reconciliation | Controller | NET-NEW `finance.payment.reconcile` (§8) | payment_reconciliations | NET-NEW |
| 11 | Commission eligibility (from policy) | system (policy engine) | NET-NEW `commission.eligibility.read` (§8) | commission_eligibility | NET-NEW |
| 12 | Controller review + approval | Controller | NET-NEW `commission.review`, `commission.approve` (§8) | commission_approvals | NET-NEW |
| 13 | Commission payable created | Accounting | NET-NEW `commission.payable.create` (§8) | commission_payables | NET-NEW |
| 14 | Salesperson payment recorded | Accounting | NET-NEW `commission.payment.record` (§8) | commission_payments | NET-NEW |
| — | Audit lineage (cross-cutting) | Owner / Controller | NET-NEW `finance.lineage.read` (§9) | audit events + lineage projection | partial |

## 2. Actor roster (governed)

F1 governs eleven actors:

**Owner · Admin · Salesperson · Dispatcher · Shop/Service Manager · Warehouse Manager · Parts Manager · Parts Associate · Technician · Accounting · Controller.**

### 2.1 Governed role model (Owner-directed)

- **Create three NEW distinct governed roles** — each with its own workflow authority, assignment, and audit identity:
  - **Salesperson** — attribution subject; owns/receives governed credit from the Opportunity.
  - **Controller** — financial approval + reconciliation authority (the *checker*).
  - **Shop/Service Manager** — service-execution oversight and completion-exception resolution.
- **Accounting = the existing `accountingManager` governed role**, used as the **execution side** of the financial separation-of-duties model (the *maker*). F1 extends its capability set for the commission chain; it is not renamed.
- **Explicit prohibitions (Owner):**
  - Do **not** extend `salesManager` into Salesperson (Salesperson is a distinct role).
  - Do **not** combine `accountingManager` or `financeManager` into Controller (Controller is distinct and net-new).
  - Do **not** create a separate Payroll/AP role at this time.
- **Warehouse/Parts remain operational eligibility roles for this lifecycle** (`WAREHOUSE_MANAGER`, `PARTS_MANAGER`, `PARTS_ASSOCIATE`) — an Owner-settled decision for F1, not an open question (§14). F1 designs **governed permissions** for their actions (§6); an `operationalRole` alone is **never** authorization (Spec §9 of the enterprise-access platform — `operationalRoleActive` is a Condition on a granted Permission, not a grant).

### 2.2 Salesperson authority (own-scope, attribution-bound) — C3

Salesperson authority is **own-scope**, never the unrestricted commercial grant a Dispatcher/Admin holds. F1 specifies:

- **Opportunity read/write only for governed owned/assigned Opportunities** — resolved via an `own`-scope / `isOwnAssignment`-style Condition, not a global grant.
- **`opportunity.createSalesOrder` only from an eligible owned Opportunity** (own-scope + WON precondition). A Salesperson cannot create a Sales Order from an Opportunity they do not own.
- **No unrestricted `salesOrder.write`.** The Salesperson's path into a Sales Order is `opportunity.createSalesOrder` from their owned Opportunity; raw `salesOrder.write` (edit/advance any Sales Order) stays with Dispatcher/Admin.
- **Expressing this safely:** the resolver already supports `Scope: ownAssignment` and the `isOwnAssignment` Condition. If the current catalog cannot express own-scope on these exact ids without ambiguity, F3 records a **narrower net-new salesperson-scoped capability** (e.g. `opportunity.write.own`, `opportunity.createSalesOrder.own`) rather than granting the global spine id to the Salesperson role.
- **Locked attribution remains immutable** after its lock point (§8.2); a Salesperson can never edit attribution, policy, or calculation inputs.

Note: PR #971 grants the *global* `opportunity.*` ids to admin/dispatcher/owner only — it does **not** grant them to a Salesperson role (which does not yet exist). The own-scope Salesperson grant is F3 net-new work, so no misrepresentation of #971 arises.

## 3. Controller / Accounting separation of duties (maker–checker)

The load-bearing SoD model. **No actor both approves and pays the same commission.**

### 3.1 CONTROLLER (checker)
- Reconcile customer payments.
- Review commission eligibility and calculations.
- Approve or reject commissions.
- Approve commission adjustments, reversals, and clawbacks.
- View complete financial and audit lineage.
- **Cannot** create or execute the salesperson payment resulting from their own approval.
- **Cannot** approve and pay the same commission.

### 3.2 ACCOUNTING (maker / execution)
- Issue invoices.
- Apply customer payments.
- Create commission payables **only after Controller approval**.
- Execute/record salesperson payments.
- Record Controller-approved reversals and corrections.
- **Cannot** approve the commission it creates or pays.
- **Cannot** change locked salesperson attribution or commission policy.

### 3.3 SALESPERSON (subject)
- Own / receive governed attribution from the Opportunity.
- View their own attribution, eligibility, approval, payable, and payment status.
- **Cannot** modify attribution after its governed lock point (§8.2).
- **Cannot** change commission policy or calculation inputs.
- **Cannot** approve or pay their own commission.

### 3.4 OWNER (oversight)
- Holds lifecycle oversight.
- Any override is **break-glass**: reason-required, immutable, fully audited.
- Normal processing **must** preserve the Controller/Accounting split — Owner override never becomes the routine path.

## 4. Full actor × capability matrix (design, for review)

Legend: **A**=Allow · **·**=deny · **r**=read-only · **own**=own-scope only · **[N]**=NET-NEW capability · **[BG]**=break-glass only.

Column reality check (C1/C2/C3 review corrections): the three `opportunity.*` and `salesOrder.*` rows reflect the **current PR #971 grant** (owner/admin = 11, dispatcher = 6 operational, technician = 0) — the matrix does not contradict or misrepresent it.

This matrix shows **authorization intent** (who may do what). For **build status**, §5 (repository reconciliation) is authoritative — and it corrects several `[N]` markers below: the physical-inventory rows are **mostly already built** (`inventory.action.*`, `detectInventoryEffects`, `inventory.transaction.read`, `inventory.stock.receive`) or **owned by `enterprise-inventory-architecture.md`** (granular pick/stage, warehouse↔truck transfer, returns, reconciliation callable), **not** F1 net-new. Genuinely-new `[N]` for F1 are only the finance-approval, reconciliation-record, and commission rows. Where a row names a capability that does not yet exist as a distinct id (e.g. a granular reserve id), treat the **existing** mechanism in §5 as authoritative and do not create a parallel id.

| Capability group | Sales | Disp | Shop/Svc | Whse Mgr | Parts Mgr | Parts Assoc | Tech | Acct | Controller | Admin | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Opportunity read/write/createSO (`opportunity.*`) | own | A | · | · | · | · | · | · | · | A | A |
| Sales Order write (`salesOrder.write`) | · | A | r | · | · | · | · | · | r | A | A |
| SO allocation record (`salesOrder.fulfill`) | · | A | · | · | · | · | · | · | · | A | A |
| Inventory reserve/consume (EXISTING `inventory.action.*` / `detectInventoryEffects`; §5) | · | · | · | A | A | · | · | · | · | · | A |
| Service demand (`salesOrder.service`) | · | A | A | · | · | · | · | · | · | A | A |
| Work Order execution (`workOrder.*`) | · | A | A | · | · | · | A(assigned) | · | · | A | A |
| Pick/stage/issue [N] | · | · | · | A | A | A | · | · | · | · | A |
| Whse↔truck transfer [N] | · | · | · | A | A | A | verify | · | · | · | A |
| Receiving/returns [N] | · | · | · | A | A | A | return(unused) | · | · | · | A |
| Inventory reconciliation [N] | · | r | · | A | A | · | · | · | r | · | A |
| Fulfillment confirm [N] (`salesOrder.fulfillment.confirm`) | · | A | r | · | · | · | · | · | · | · | A |
| Tech field actuals [N] (§7) | · | · | r | · | · | · | A(own) | · | · | · | A |
| Invoice issue (`finance.invoice.issue`) | · | · | · | · | · | · | · | A | r | A | A |
| Payment apply (`finance.payment.apply`) | · | · | · | · | · | · | · | A | r | A | A |
| Payment reconcile [N] (`finance.payment.reconcile`) | · | · | · | · | · | · | · | r | A | · | A[BG] |
| Finance adj/refund RECORD (`finance.adjustment.record`/`finance.refund.record`) | · | · | · | · | · | · | · | A | · | A | A |
| Finance adj/refund APPROVE [N] (`finance.adjustment.approve`/`finance.refund.approve`) | · | · | · | · | · | · | · | · | A | · | A[BG] |
| Commission policy manage [N] (`commission.policy.manage`) | · | · | · | · | · | · | · | · | · | · | A |
| Commission eligibility read [N] (`commission.eligibility.read`) | own | · | · | · | · | · | · | r | A(review) | · | A |
| Commission approve/reject [N] (`commission.approve`) | · | · | · | · | · | · | · | · | A | · | A[BG] |
| Commission adj/reversal/clawback APPROVE [N] (`commission.adjustment.approve`/`commission.reversal.approve`) | · | · | · | · | · | · | · | · | A | · | A[BG] |
| Commission payable create [N] (`commission.payable.create`) | · | · | · | · | · | · | · | A(post-approval) | · | · | A[BG] |
| Commission reversal/clawback RECORD [N] (`commission.reversal.record`) | · | · | · | · | · | · | · | A(post-approval) | · | · | A[BG] |
| Salesperson payment record [N] (`commission.payment.record`) | own(view) | · | · | · | · | · | · | A | · | · | A[BG] |
| Full financial+audit lineage [N] (`finance.lineage.read`) | own | r | r | · | · | · | · | r | A | r | A |

Key SoD invariants encoded above:
- **Salesperson** is `own`-scope on the `opportunity.*` rows (attribution-bound, C3), holds **no** raw `salesOrder.write`, and is `own`-read-only across every commission column — never approve/pay.
- **Dispatcher** owns `salesOrder.fulfill` (the commercial allocation record) and `salesOrder.fulfillment.confirm`; **Warehouse/Parts hold `inventory.allocation.reserve` and the physical caps, NOT `salesOrder.fulfill`** (C2).
- **Controller** approves (`*.approve`, reconcile) but never creates/pays a commission (payable/reversal-record/payment columns are `·`).
- **Accounting** issues/applies/records and creates/pays **only post-approval**, but never approves (`*.approve` columns are `·`).
- **Admin/Owner** are `·`/`[BG]` on net-new caps — the matrix never claims an ungranted authority. Owner's commission/finance approval and pay actions are **break-glass only** (`[BG]`).

## 5. Repository reconciliation (existing authority vs genuinely-new)

This section **replaces** the earlier generic "net-new" and technician lists. Every lifecycle requirement below is reconciled against the current repository (main `26885df7`), the authoritative design docs, and the actual commands/tests. **The physical, spine, and finance layers are already built** — the dominant gap is **activation + persona-assignment** (closed by PR #971's role grant + Phase 6b persona assignment), not code. Genuinely-new build collapses to the commission domain, three roles, an approval gate, a Controller-gated reconciliation *record*, an attribution *lock*, and a lineage projection. **Do not invent parallel capabilities/collections/commands where an authority already exists.** Deeper physical-inventory items (truck-as-Location, warehouse↔truck transfer, returns/RMA, location-aware pick/stage, warehouse-reconciliation callable) are **already owned by `docs/specifications/enterprise-inventory-architecture.md`** and are **out of F1 scope** — F1 references, never re-designs, them.

Columns: (1) requirement · (2) existing authoritative design · (3) existing impl + tests · (4) deployed status · (5) actual remaining gap · (6) gap type · (7) authoritative repo capability/command · (8) genuinely-new still required.

| Lifecycle requirement | Existing design | Existing impl + tests | Deployed | Actual gap | Gap type | Authoritative repo capability / command | Genuinely-new |
|---|---|---|---|---|---|---|---|
| Opportunity author/advance | Opportunity Cycle 3 | `opportunityCallables.ts` `createOpportunity`/`transitionOpportunity`; `opportunityCommands.test.mjs` | sandbox (active:false); prod no | activate + grant | activation → persona | `opportunity.write`/`.read` | none |
| WON → Create Sales Order | p1 spine §P1.3 | `createSalesOrderFromOpportunity.ts`; `createSalesOrderFromOpportunityCallable.test.mjs` | sandbox | activate + grant | activation → persona | `opportunity.createSalesOrder`, `salesOrder.write` | none |
| SO allocation | p1 spine §P1.7 | `allocateSalesOrder.ts`; `allocateSalesOrderAllocation.test.mjs` | sandbox (override on); **no role grants it on main** | grant (→ **#971**) | persona-assignment | `salesOrder.fulfill` / `allocateSalesOrder` | none |
| Service demand from SO | p1 spine §P1.2 | `createServiceForSalesOrder.ts`; `createServiceForSalesOrderLineRefs.test.mjs` | sandbox | activate + grant | activation → persona | `salesOrder.service` / `createServiceForSalesOrder` | none |
| WO execution data / actuals | enterprise-inventory §3.1 (Epic 6) | `updateWorkOrderExecutionData.ts` (role-gated); idempotency + `workOrderExecutionMath` tests | sandbox; prod partial | **parts qty only — no labor/equipment actuals** | code (labor/equip only) | `updateWorkOrderExecutionData` (role-gated) | labor + equipment actuals capture (Service Ops / Technician Labor #13 — adjacent, not commission-F1) |
| WO completion | technician-self-write #39 / ADR-002 | `completeAssignedJob.ts` + `transitionWorkOrder.ts`; `completeAssignedJob.test.js`, `transitionEngine.test.mjs` | deployed | none | none | `completeAssignedJob`; `transitionWorkOrder` (`workOrder.transition`) | none |
| Technician field context | Owner Option 1 (in-file) | `getWorkOrderFieldContext.ts` (own-assignment gated); `workOrderFieldContext.test.mjs` | deployed | none | none | `getWorkOrderFieldContext` | none |
| Inventory consumption (reserve/consume) | enterprise-inventory §3.1 | `inventoryService.ts` reserve/release/consume + `inventory_transactions` ledger; `detectInventoryEffects`; `inventoryService.test.mjs` | deployed | location-blind (no `locationId`) | code — **Enterprise Inventory Arch scope, not F1** | `inventory.action.create/read`, `inventory.transaction.read`, `detectInventoryEffects` | location-aware pick/stage (Ent. Inventory, not F1) |
| SO fulfillment write-back | p1 spine §P1.1 | `applyFulfillmentAcceptance` inside `transitionWorkOrder` Complete; pure + emulator tests | deployed | none | none | `transitionWorkOrder` Complete path (no separate cap) | none |
| Billing eligibility | completion→finance assessment (BUILT) | `billingEligibility.ts` `computeBillingEligibility` (pure); `billingEligibility.test.mjs` | deployed | none | none | consumed by `finance.invoice.issue` | none |
| Invoice issuance | p1 spine §P1.8 | `invoiceCallables.ts` `issueInvoice`; invoice callable/commands/numbering/eligibility tests | sandbox | activate + grant | activation → persona | `finance.invoice.issue` / `issueInvoice` | none |
| Customer payment apply | assessment (stale "not built") | `paymentCallables.ts` `applyPayment`; payment callable/commands tests | sandbox | activate + grant | activation → persona | `finance.payment.apply` / `applyPayment` | none |
| Payment **AR reconciliation (derivation)** | p1 finance | `paymentCommands.ts` `deriveOutstandingMinor`/`deriveInvoiceStateFromFacts` inside `applyPayment` | deployed within `applyPayment` | AR derivation **exists** | none | `finance.payment.apply` (`buildApplyPayment`) | — |
| Payment **reconciliation RECORD (Controller-gated)** | this spec §1 stage 10 | — | — | distinct actor-gated confirm/record atop the derivation | code (small) | none yet | **`commission`-adjacent: a Controller reconciliation record** (`payment_reconciliations`) |
| Finance adjustments / refunds | SYSTEM_AUTHORITIES rows | `adjustmentCallables.ts`/`refundCallables.ts` `recordInvoiceAdjustment`/`recordRefund`; tests | sandbox | activate + grant; **no approval gate** | activation → persona (+ approval gate new) | `finance.adjustment.record`/`finance.refund.record` | Controller `finance.adjustment.approve`/`finance.refund.approve` (C4) |
| Receiving | enterprise-inventory §4.4 | `receiveInventoryStock` + `inventory.stock.receive` **granted admin/dispatcher/owner**; many tests; `receivingGrantGate.test.mjs` | sandbox; prod not | prod deploy only (grant already exists — some in-repo "ungranted" comments are **stale**) | activation/prod-deploy | `inventory.stock.receive` / `receiveInventoryStock` | none |
| Warehouse reconciliation | enterprise-inventory §4.3 | `warehouseReconciliationService.ts` (pure `detectStockDiscrepancies`/`generateReconciliationReport`) — **no callable, no capability, no tests** | not exported | callable + capability + tests | code + tests — **Enterprise Inventory Arch scope, not F1** | `warehouseReconciliationService` (logic only) | wrapper/capability (Ent. Inventory, not F1) — **reuse this file, do not rename/re-invent** |
| Warehouse↔truck transfer | enterprise-inventory §4.6 | `warehouseService.ts` `createTransferOrder`/`completeTransferOrder` (warehouse↔warehouse only, no callable); truck stock **demo-only** (`InventoryContext.jsx`, in-memory) | not deployed | truck-as-Location, transfer callable, truck-stock persistence | code + data — **Enterprise Inventory Arch scope, not F1** | `createTransferOrder` (internal); `truckRegistry*` (records only) | truck-as-MOBILE-Location + transfer callable (Ent. Inventory, not F1) |
| Truck / mobile foundations | enterprise-inventory §3.1/§4.6 | `truckRegistry/*` (record CRUD, role-gated); truck tests; **no ledger `locationId`** | sandbox; prod not | Location model + `locationId` on ledger | code + data — **Enterprise Inventory Arch scope** | `truckRegistry` commands | unified Location + `locationId` (Ent. Inventory, not F1) |
| Returns / RMA | enterprise-inventory §4.12 / register #4 | **absent** | — | entire workflow | code — **Enterprise Inventory / register #4, not F1** | none | Return/RMA object + capability (not F1) |
| Salesperson attribution (preserve) | coverage assessment; register #7/#15 | `ownerEmployeeId` on `opportunities`/`sales_orders` (**exists**); coverage (`createCoverageAssignment`/`resolveCommercialCoverage`) built-inert but **≠ credit/commission** (guardrail in `coverageCommands.ts` + tests) | sandbox (coverage active:false) | **locked commission-attribution snapshot** (reuse `ownerEmployeeId`; do NOT overload coverage) | code (small) | `ownerEmployeeId`; `coverage.*` (adjacent, not credit) | **attribution LOCK snapshot for commission** |
| Commission (policy/eligibility/approval/payable/payment) | register #7 (greenfield) | **absent** — no code; coverage explicitly forbids commission fields | — | entire domain | code — **genuinely-new F1** | none | **commission bounded context** (see §8) |
| Controller / Salesperson / Shop-Service roles | sandbox persona matrix ("MISSING ROLE" for service mgr) | **absent** — not in compat/governed/operational role sets | — | 3 governed roles | code — **genuinely-new F1** | none (salesManager ≠ Salesperson; accountingManager = existing Accounting) | **3 governed roles** |
| Opportunity→Commission audit lineage | per-command audit exists | append-only audit events per command | sandbox | end-to-end lineage **projection** | code — **genuinely-new F1** | audit-event writer (per command) | **lineage projection read model** |

### 5.1 Genuinely-new F1 scope (the residue after reconciliation)
Concentrated exactly where the Owner directed — everything else is reuse/activation/persona:
- **Commission bounded context** — capabilities `commission.policy.read/manage`, `commission.eligibility.read`, `commission.review`, `commission.approve`, `commission.adjustment.approve`, `commission.reversal.approve`, `commission.payable.create`, `commission.payment.record`, `commission.reversal.record`, `commission.read` (own); collections `commission_policies`, `commission_eligibility`, `commission_approvals`, `commission_payables`, `commission_payments` (Admin-SDK-only). Registered `active:false` + per-env activation, reusing the #970 mechanism.
- **Three governed roles** — `salesperson`, `controller`, `shopServiceManager` (Accounting = existing `accountingManager`).
- **Financial approval gate** — `finance.adjustment.approve` / `finance.refund.approve` (Controller), gating the existing Accounting `*.record` authorities (C4).
- **Controller-gated payment reconciliation record** — `finance.payment.reconcile` + `payment_reconciliations`, a *small* actor-gated confirmation atop the existing `applyPayment` AR-derivation (NOT a new AR engine).
- **Attribution lock** — a locked commission-attribution snapshot reusing `ownerEmployeeId`, respecting the coverage guardrail (coverage ≠ credit).
- **Lineage projection** — `finance.lineage.read` + an Opportunity→Commission read model over existing audit events.

### 5.2 Reconciliation findings worth flagging
- **Stale docs found (fix separately, not in F1):** `docs/assessments/completion-to-finance-and-billing-ar-assessment.md` says finance/billing is "NOT built," but the code **is** built (`SYSTEM_AUTHORITIES.md` is ground truth). Several in-repo comments call `inventory.stock.receive` "UNGRANTED" though it **is** granted (proven by `receivingGrantGate.test.mjs`).
- **Two distinct "Controller" concepts must stay separate:** the inventory-sales wireframe's deferred *ownership-override* Controller (§3.7) vs. this spec's *financial-approval* Controller. F1's Controller is the financial-approval one; it does not absorb the ownership-override hook.
- **Coverage guardrail is load-bearing:** the shipped Commercial Coverage feature deliberately excludes credit/commission (`coverageCommands.ts` + tests). F1 attribution reuses `ownerEmployeeId` and MUST NOT add commission/credit fields to coverage records.

## 6. Warehouse & Parts authorization (reuse existing; defer deeper model)

Operational roles (`WAREHOUSE_MANAGER`, `PARTS_MANAGER`, `PARTS_ASSOCIATE`) remain **eligibility** signals — an Owner-settled decision for this lifecycle (§14). Authorization is a **granted Permission** gated by an `operationalRoleActive` Condition — never the operational role alone (Spec §9).

**These capabilities already exist and are ACTIVE + granted today** (reconciliation §5; `permissionCatalog.ts` + `compatibilityRoles.ts`) — F1 reuses them, does not re-invent them:

| Existing capability | Status | Current grantees |
|---|---|---|
| `inventory.transaction.read` | active | admin/dispatcher; technician+`MANAGER_OR_WAREHOUSE`; fieldManager |
| `inventory.action.read` | active | admin/dispatcher; technician+`WAREHOUSE_MANAGER` |
| `inventory.action.create` | active | admin/dispatcher |
| `inventory.stock.receive` | active | admin/dispatcher/owner (**already granted** — some in-repo "ungranted" comments are stale) |
| `warehouse.record.read` / `.stockLocation.read` / `.transferOrder.read` | active | admin/dispatcher/owner |
| reserve/release/consume ledger effects | built | `inventoryService.ts` + `detectInventoryEffects` (role-gated), `inventory_transactions` |

**`salesOrder.fulfill` = Dispatcher-owned commercial allocation record** (`allocateSalesOrder`); PR #971 grants it to admin/dispatcher(+owner). **Warehouse/Parts personnel are NOT granted `salesOrder.fulfill`** to do physical work — they use the inventory capabilities above (C2). Physical *reservation/pick/stage/issue* today runs through `inventoryService.ts`/`detectInventoryEffects` + `inventory.action.*`; a **granular, location-aware** pick/stage/issue/transfer model (with first-class Reservation objects, truck-as-Location, `inventory.transfer.*`/`inventory.count.*`/`inventory.location.manage`) is **owned by `docs/specifications/enterprise-inventory-architecture.md` (§4/§5), not F1.** F1 does not create those capability ids; it references the inventory spec and treats the existing consumption path as sufficient for the commission lifecycle's fulfillment evidence.

**Not in F1 (already the Enterprise Inventory Architecture roadmap):** location-aware pick/stage, warehouse↔truck transfer callable, truck-as-Location + ledger `locationId`, Returns/RMA, and a warehouse-reconciliation callable/capability over the existing `warehouseReconciliationService.ts` logic. F1 preserves and references these; it does not schedule or duplicate them.

## 7. Technician authorization model (mostly already built)

The Phase 6a result **Technician = 0 applies ONLY to the 11 commercial/finance spine capabilities** in PR #971. It is **not** the technician model — and reconciliation (§5) shows the technician execution path is **already built and tested**, not net-new:

| Technician need | Already built (authoritative command) | Gap |
|---|---|---|
| Access assigned service work + context | `getWorkOrderFieldContext` (role + own-assignment gated) + `workOrderFieldContext.test.mjs` | none |
| Complete assigned Work Order | `completeAssignedJob` (legacy job) + `transitionWorkOrder` Complete (`workOrder.transition`, granted to technician) | none |
| Record **parts** actuals (qtyUsed) | `updateWorkOrderExecutionData` (role-gated) + idempotency/math tests | none |
| Fulfillment evidence to SO | `applyFulfillmentAcceptance` inside `transitionWorkOrder` Complete | none |
| Record **labor** and **equipment** actuals | — (only parts qty exists today) | **code — the one real technician gap** |
| Verify/count parts on truck | — (truck stock is demo-only, no backend) | code — **Enterprise Inventory Arch scope, not F1** |

**So F1's technician position is:** the assigned-work / context / parts-actuals / completion / fulfillment-evidence chain is done; the only technician gap of substance is **labor + equipment actuals**, which belongs to **Service Operations / Technician Labor #13**, not the commission lifecycle — recorded here as adjacent, sequenced there, **not** as F1 net-new. No broad opportunity/sales-order/finance authority is ever granted to a technician as a substitute (the 0-spine holds; it was never the whole model).

## 8. Commission bounded context (net-new domain)

`policy → eligibility → review → approval → payable → payment`, all Admin-SDK-only, all registered `active:false` under the per-environment activation model (sandbox-activatable, production-inert).

### 8.1 Policy decisions the spec MUST resolve (Owner point 8)
Proposed governed defaults below are **PROPOSED — require Owner ratification**; they are not decided by authoring this doc.

| Decision | Proposed default (for ratification) | Alternatives to weigh |
|---|---|---|
| Eligibility trigger | **Collected cash** (commission earned on reconciled payment) | invoice-issued; recognized revenue; booking |
| Partial payment | Pro-rata to reconciled collected amount | all-or-nothing at full collection |
| Partial fulfillment | Commission only on fulfilled+invoiced+collected portion | hold until fully fulfilled |
| Split credit / multi-salesperson | Weighted splits summing to 100%, snapshotted at lock | single-owner only |
| Attribution snapshot + lock timing | Snapshot at Opportunity WON; **lock at Invoice issuance** | lock at SO creation; lock at payment |
| Territory/salesperson change after sale | Locked attribution is immutable; changes apply to future opportunities only | retro reassignment (rejected — breaks lineage) |
| Refund / cancellation / credit / bad-debt / clawback | Reduce eligible/earned; **clawback if already paid**; reason-required; Controller-approved | write-off without clawback |
| Adjustments / reversals / corrections | Reason-required, Controller-approved, append-only, never rewrite the original | in-place edit (rejected) |
| Controller approval (baseline) | **F1 BASELINE (not a proposal): every commission requires explicit Controller approval.** No auto-approval in F1. | threshold-based auto-approval is a FUTURE alternative only — see §8.3 |
| Required dual-control points | Approve (Controller) and payable-create+pay (Accounting) are distinct actors | single-actor (rejected) |
| Accounting payment execution/recording | Accounting records payment referencing the approved payable id | — |
| Immutable audit lineage | End-to-end projection (§9), append-only | — |

### 8.2 Attribution snapshot + lock (reuse `ownerEmployeeId`; respect the coverage guardrail)
Attribution reuses the **existing** `Opportunity.ownerEmployeeId` / `SalesOrder.ownerEmployeeId` fields (record ownership) as the attribution source — it does **not** introduce a parallel owner concept, and it does **not** add credit/commission fields to Commercial Coverage records (the shipped coverage feature deliberately excludes them; that guardrail is preserved). The commission-attribution snapshot (salesperson(s) + split weights) is captured from `ownerEmployeeId` (plus any ratified split model) and **locked** at the ratified lock point (proposed: Invoice issuance). After lock, attribution is immutable except by Owner break-glass (reason-required, audited). Salesperson cannot modify attribution at any point. Note the register's rule: **Opportunity owner ≠ guaranteed commission recipient** — the lock records the attribution *as governed*, and the commission policy (§8.1) decides eligibility from it.

### 8.3 Controller approval baseline vs future auto-approval (C5)
**F1 baseline, aligned with the approved SoD (§3):** *every* commission requires an explicit Controller approval before Accounting may create a payable or record a payment. This is not optional and is not qualified by any threshold in F1.

**Threshold-based auto-approval is recorded as a FUTURE alternative only.** It is **not** approved and must not be implemented, activated, or treated as approved unless a *separate* Owner decision defines, at minimum: (a) an accountable **system actor** identity that "performs" the auto-approval and appears in the audit record; (b) the governing **policy version** under which the auto-approval was granted; (c) an immutable **audit record** equivalent to a human Controller approval; and (d) the exact threshold semantics and currency. Absent that separate decision, the baseline (explicit Controller approval for every commission) is the only governed behavior.

## 9. Audit & data governance

The complete lifecycle must provide:
- Salesperson attribution preserved Opportunity → payment (locked snapshot + lineage).
- Governed payment-reconciliation evidence (`payment_reconciliations`).
- Governed commission policy + eligibility records.
- Controller approval evidence (`commission_approvals`, actor + reason + timestamp).
- Accounting payable + payment evidence.
- **Append-only** command audit events for every state transition.
- **End-to-end lineage projection:**
  `Opportunity → Sales Order → Work Order/Fulfillment → Invoice → Customer Payment → Reconciliation → Commission → Approval → Payable → Salesperson Payment`.
- Reason-required reversals and corrections.
- **No client-direct writes** to authoritative commission records (Admin-SDK-only; deny-all client Rules).

## 10. Separation-of-duties acceptance criteria (test/acceptance matrix)

F-stage builds must prove (fail-closed):

| # | Acceptance criterion |
|---|---|
| SoD-1 | Controller CANNOT create a `commission_payable` (capability denied). |
| SoD-2 | Controller CANNOT record a `commission_payment` (capability denied). |
| SoD-3 | Accounting CANNOT `commission.approve` / `commission.adjustment.approve` (denied). |
| SoD-4 | A `commission_payable` cannot be created without a matching Controller `commission_approvals` record (referential + capability gate). |
| SoD-5 | The actor who approved a commission cannot be the actor who records its payment (same-actor approve+pay rejected even if both capabilities were mis-granted). |
| SoD-6 | Salesperson resolves only `own`-scope reads across attribution/eligibility/approval/payable/payment; every write is denied. |
| SoD-7 | Salesperson CANNOT modify attribution after lock; CANNOT touch policy/eligibility inputs. |
| SoD-8 | Owner commission approve/create/pay is reachable ONLY through the break-glass path (reason-required, immutable audit); the routine path preserves the split. |
| SoD-9 | Every commission record write is Admin-SDK-only; a client-direct write is denied by Rules. |
| SoD-10 | Reversal/clawback requires a reason and a Controller approval; the original record is never rewritten (append-only). |

## 11. Operational handoff matrix (dispatcher / warehouse / parts / tech / shop / accounting / controller / salesperson)

| Handoff | From → To | Governed action |
|---|---|---|
| Sold work → executable service | Sales/Admin → Dispatcher | `salesOrder.service` creates governed Work Order demand |
| Allocate + reserve inventory | Dispatcher → Warehouse/Parts | `inventory.allocation.reserve` (+ `salesOrder.fulfill` allocation record) |
| Pick / stage / issue / transfer | Warehouse/Parts staff | `inventory.pick.stage`, `inventory.issue`, `inventory.transfer.truck` |
| Assigned work + truck verify | Dispatcher → Technician | `workOrder.inventory.verify` |
| Labor/parts actuals + acceptance | Technician | `workOrder.actuals.record`, `workOrder.acceptance.capture`, `workOrder.return.unused` |
| Completion exception resolution | Technician → Shop/Service Mgr | `workOrder.transition` (oversight) |
| Complete Work Order | Technician / Shop-Service Mgr | `workOrder.complete` |
| Confirm operational fulfillment | Shop/Dispatcher → Dispatcher | `salesOrder.fulfillment.confirm` (clears blockers) |
| Invoice | Dispatcher(fulfilled) → Accounting | `finance.invoice.issue` |
| Apply customer payment | Accounting | `finance.payment.apply` |
| Reconcile cash | Accounting → Controller | `finance.payment.reconcile` |
| Review + approve commission | (system eligibility) → Controller | `commission.review`, `commission.approve` |
| Create payable (post-approval) | Controller → Accounting | `commission.payable.create` |
| Record salesperson payment | Accounting | `commission.payment.record` |
| Commission status visibility | → Salesperson | `commission.read` (own) |

## 12. Completion criteria (when the lifecycle is "finished")

The complete sales lifecycle is **not** finished until ALL hold:
1. Customer payment is recorded **and reconciled**.
2. Salesperson attribution is preserved (locked snapshot + lineage).
3. Commission eligibility is governed (from policy).
4. Controller approval is captured.
5. Accounting creates **and executes** the approved payable.
6. Salesperson payment is recorded.
7. The complete chain is exercised **in sandbox**.
8. The entire lifecycle is **audit-traceable** Opportunity → salesperson payment.

Phase 7 (Opportunity → Invoice) satisfies none of 1–6 and is labeled **PARTIAL**.

## 13. Follow-on sequencing (design-only; each separately reviewed + gated)

Reconciliation (§5) collapses the earlier F2–F6 build plan: the spine/finance/physical layers are **already built**, so most "follow-on" is **activation + persona-assignment**, already in motion via **#970** (per-env activation), **#971** (spine role grant), and **Phase 6b** (persona assignment). Genuinely-new build is only the commission residue (§5.1):

- **Already in flight (not new build):** #970 activation (MERGED), #971 spine role grant (OPEN), Phase 6b persona role_assignment (read-only query pending), then sandbox activation of the spine.
- **F-New-1 — Governed roles** (`salesperson`, `controller`, `shopServiceManager`; extend existing `accountingManager` for the commission execution set). Least-privilege + SoD tests (§10).
- **F-New-2 — Financial approval gate**: `finance.adjustment.approve`/`finance.refund.approve` (Controller), gating the existing `*.record` authorities (C4).
- **F-New-3 — Payment reconciliation record**: `finance.payment.reconcile` + `payment_reconciliations` — a small Controller-gated record atop the existing `applyPayment` AR-derivation (not a new AR engine).
- **F-New-4 — Attribution lock**: locked commission-attribution snapshot reusing `ownerEmployeeId` (§8.2), respecting the coverage guardrail.
- **F-New-5 — Commission bounded context** (policy → eligibility → approval → payable → payment), Admin-SDK-only, `active:false` + per-env activation; SoD acceptance matrix (§10).
- **F-New-6 — Lineage projection** (`finance.lineage.read` + Opportunity→Commission read model over existing audit events).
- **F-New-7 — Sandbox activation + full-lifecycle E2E** (§12) + evidence.

**Explicitly NOT scheduled by F1 (already owned by `enterprise-inventory-architecture.md`):** location-aware pick/stage, warehouse↔truck transfer, truck-as-Location + ledger `locationId`, Returns/RMA, warehouse-reconciliation callable. Labor/equipment actuals belong to Service Ops / Technician Labor #13. F1 preserves and references these; it does not duplicate or re-sequence them.

Sequencing note: F-New-1/2/3/4 can proceed after the spine is activated; F-New-5 depends on F-New-1 (Controller/Accounting) + F-New-4 (attribution lock); F-New-3 depends on payment being activated.

## 14. Decision ledger

### Resolved by Owner (this cycle)
- End state extends to reconciled payment + full commission chain (§1, §12).
- Three new distinct governed roles: Salesperson, Controller, Shop/Service Manager (§2.1).
- Accounting = existing `accountingManager` as the execution side (§2.1, §3.2).
- No `salesManager→Salesperson`, no `accountingManager/financeManager→Controller`, no Payroll/AP role now (§2.1).
- Controller/Accounting maker–checker SoD; no approve-and-pay (§3, §10).
- Warehouse/Parts stay operational eligibility roles; governed permissions per action; no blanket `salesOrder.fulfill` (§6).
- Technician 0-spine is scoped to the 11 caps only; techs must be able to execute + evidence their work (§7).

### Unresolved — require Owner ratification (§8.1)
- Eligibility trigger (proposed: collected cash).
- Attribution lock timing (proposed: Invoice issuance).
- Approval thresholds / auto-approve floor.
- Partial-payment / partial-fulfillment proration rules.
- Split-credit model (weighted splits).
- Clawback vs write-off treatment for refunds/bad-debt.

- **Warehouse/Parts remain operational eligibility roles for this lifecycle (SETTLED, C6).** Not an open question and not reopened by F1. Whether they ever graduate to governed roles is a **non-blocking future architecture consideration** only — it does not gate or alter the approved F1 model.

### Reconciliation outcome (this revision)
- The physical/spine/finance layers are **already built**; the dominant gap is **activation + persona-assignment** (#970/#971/6b), not code (§5).
- Genuinely-new build is confined to the commission residue (§5.1): commission domain, three roles, approval gate, Controller reconciliation record, attribution lock, lineage projection.
- Deeper physical-inventory items are **owned by `enterprise-inventory-architecture.md`** and are out of F1 scope; F1 references, does not duplicate them.
- Attribution reuses `ownerEmployeeId`; the coverage credit/commission guardrail is preserved.
- Two "Controller" concepts kept distinct (financial-approval here vs. wireframe ownership-override).

### Open — cross-workstream (non-blocking)
- Attribution source reuses existing `ownerEmployeeId`; Commercial Coverage (#15) remains a *distinct, adjacent* concept (coverage ≠ credit) and is not a dependency for the attribution lock.
- Stale-doc cleanups (finance assessment "NOT built"; receiving "UNGRANTED" comments) — fix in their own docs, not F1.
