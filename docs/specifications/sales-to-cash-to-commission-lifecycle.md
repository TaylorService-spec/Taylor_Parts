---
artifact_type: specification
workstream: sales-to-cash-to-commission-lifecycle
title: Complete Sales-to-Cash-to-Commission Lifecycle — governed end state, actor/capability matrix, and separation of duties
status: DRAFT — for review (F1). Design only. Nothing built, activated, deployed, or mutated.
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
| 1 | Opportunity author/advance | Salesperson | `opportunity.write` / `opportunity.read` | opportunities | exists (active:false) |
| 2 | WON → Create Sales Order | Salesperson / Admin | `opportunity.createSalesOrder`, `salesOrder.write` | sales_orders | exists (active:false) |
| 3 | Allocation | Dispatcher / Warehouse Mgr | `salesOrder.fulfill` (allocation record) + NET-NEW warehouse caps (§6) | sales_orders (allocation) | partial |
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
- **Warehouse/Parts stay operational eligibility roles** (`WAREHOUSE_MANAGER`, `PARTS_MANAGER`, `PARTS_ASSOCIATE`) for now. F1 designs **governed permissions** for their actions (§6); an `operationalRole` alone is **never** authorization (Spec §9 of the enterprise-access platform — `operationalRoleActive` is a Condition on a granted Permission, not a grant).

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

| Capability group | Sales | Disp | Shop/Svc | Whse Mgr | Parts Mgr | Parts Assoc | Tech | Acct | Controller | Admin | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Opportunity write/read/createSO | A | · | · | · | · | · | · | · | · | A | A |
| Sales Order write | A | A | r | · | · | · | · | · | r | A | A |
| Allocation/reservation [N] | · | A | · | A | A | · | · | · | · | A | A |
| Service demand (`salesOrder.service`) | · | A | A | · | · | · | · | · | · | A | A |
| Work Order execution (`workOrder.*`) | · | A | A | · | · | · | A(assigned) | · | · | A | A |
| Pick/stage/issue [N] | · | · | · | A | A | A | · | · | · | A | A |
| Whse↔truck transfer [N] | · | · | · | A | A | A | verify | · | · | A | A |
| Receiving/returns [N] | · | · | · | A | A | A | return(unused) | · | · | A | A |
| Inventory reconciliation [N] | · | r | · | A | A | · | · | · | r | A | A |
| Fulfillment confirmation [N] | · | A | r | · | · | · | · | · | · | A | A |
| Tech field actuals [N] (§7) | · | · | r | · | · | · | A(own) | · | · | A | A |
| Invoice issue (`finance.invoice.issue`) | · | · | · | · | · | · | · | A | r | A | A |
| Payment apply (`finance.payment.apply`) | · | · | · | · | · | · | · | A | r | A | A |
| Payment reconcile [N] | · | · | · | · | · | · | · | r | A | A | A |
| Adjustment/refund (`finance.adjustment/refund`) | · | · | · | · | · | · | · | A(record) | A(approve) | A | A |
| Commission policy manage [N] | · | · | · | · | · | · | · | · | · | · | A |
| Commission eligibility read [N] | own | · | · | · | · | · | · | r | A(review) | r | A |
| Commission approve/reject [N] | · | · | · | · | · | · | · | · | A | · | A[BG] |
| Commission payable create [N] | · | · | · | · | · | · | · | A(post-approval) | · | · | A[BG] |
| Salesperson payment record [N] | own(view) | · | · | · | · | · | · | A | · | · | A[BG] |
| Full financial+audit lineage [N] | own | r | r | · | · | · | · | r | A | A | A |

Key SoD invariants encoded above: **Controller** approves but never creates/pays (payable/payment columns are `·`); **Accounting** creates/pays but never approves (`commission.approve` is `·`); **Salesperson** is `own`-scope read only across the commission columns and never approve/pay; **Owner** commission approve/create/pay are **break-glass only**, not routine.

## 5. Net-new vs existing capability inventory

### 5.1 Existing (reuse; already registered, `active:false`)
`opportunity.write/read/createSalesOrder`, `salesOrder.write/fulfill/service`, `finance.invoice.issue`, `finance.payment.apply`, `finance.adjustment.record`, `finance.refund.record`, `finance.read`. Role grants for these land in PR #971 (owner/admin=11, dispatcher=6, technician=0) — **not** re-litigated here.

### 5.2 Net-new capabilities (to be designed/registered `active:false` in follow-on)
- **Warehouse/Parts (§6):** `inventory.allocation.reserve`, `inventory.pick.stage`, `inventory.issue`, `inventory.transfer.truck`, `inventory.receive.return`, `inventory.reconcile`, `salesOrder.fulfillment.confirm`.
- **Technician (§7):** `workOrder.actuals.record` (labor/equipment/parts), `workOrder.inventory.verify` (truck/issued), `workOrder.return.unused`, `workOrder.acceptance.capture`, `workOrder.complete` (if not already covered by `workOrder.transition` — F2 confirms).
- **Payment/Commission (§8):** `finance.payment.reconcile`, `commission.policy.read`, `commission.policy.manage`, `commission.eligibility.read`, `commission.review`, `commission.approve`, `commission.adjustment.approve`, `commission.payable.create`, `commission.payment.record`, `commission.reversal.record`, `commission.read` (own-status), `finance.lineage.read`.

### 5.3 Net-new roles
`salesperson`, `controller`, `shopServiceManager` (governed business roles). Accounting reuses `accountingManager`.

### 5.4 Net-new collections (Admin-SDK-only, deny-all client Rules)
`payment_reconciliations`, `commission_policies`, `commission_eligibility`, `commission_approvals`, `commission_payables`, `commission_payments`. Plus a **locked attribution snapshot** on `opportunities`/`sales_orders` and a **lineage projection** (read model).

## 6. Warehouse & Parts governed permission model

Operational roles (`WAREHOUSE_MANAGER`, `PARTS_MANAGER`, `PARTS_ASSOCIATE`) remain **eligibility** signals; authorization is a **granted Permission** gated by an `operationalRoleActive` Condition — never the operational role alone.

Separate governed capabilities (do **not** collapse into one):

| Capability | Holder (eligibility) | Notes |
|---|---|---|
| `inventory.allocation.reserve` | Whse Mgr, Parts Mgr | reserve stock to a Sales Order; distinct from `salesOrder.fulfill` (the SO-side allocation record) |
| `inventory.pick.stage` | Whse Mgr, Parts Mgr, Parts Assoc | pick + stage for a work order/order |
| `inventory.issue` | Whse Mgr, Parts Mgr, Parts Assoc | issue/consume against a work order |
| `inventory.transfer.truck` | Whse Mgr, Parts Mgr, Parts Assoc | warehouse ↔ truck (mobile location) |
| `inventory.receive.return` | Whse Mgr, Parts Mgr, Parts Assoc | receiving + returns |
| `inventory.reconcile` | Whse Mgr, Parts Mgr | inventory reconciliation |
| `salesOrder.fulfillment.confirm` | Dispatcher | operational fulfillment confirmation (clears blockers) |

**Explicit rule (Owner):** warehouse/parts personnel are **not** granted blanket `salesOrder.fulfill` merely to perform physical inventory operations. Physical operations use the inventory capabilities above; `salesOrder.fulfill` remains the commercial allocation record on the Sales Order (Dispatcher/Warehouse Mgr per §4).

## 7. Technician authorization model

The Phase 6a result **Technician = 0 applies ONLY to the 11 commercial/finance spine capabilities** in PR #971. It is **not** the final technician model. F1 requires that technicians CAN:

- access assigned service work;
- view appropriate customer, equipment, parts, and order context (scoped to assignment);
- verify issued / truck inventory (`workOrder.inventory.verify`);
- record labor, equipment, and parts actuals (`workOrder.actuals.record`);
- record unused-part returns where applicable (`workOrder.return.unused`);
- capture required completion and acceptance evidence (`workOrder.acceptance.capture`);
- complete their assigned Work Orders (`workOrder.complete` / gated `workOrder.transition`);
- supply the evidence required for fulfillment and billing eligibility.

Missing technician-specific capabilities are added via **separately reviewed follow-on** (F2). Under no circumstances is broad opportunity/sales-order/finance authority granted to a technician as a substitute.

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
| Controller approval thresholds | All commissions require approval; optional auto-approve under a configurable threshold | mandatory approval for all |
| Required dual-control points | Approve (Controller) and payable-create+pay (Accounting) are distinct actors | single-actor (rejected) |
| Accounting payment execution/recording | Accounting records payment referencing the approved payable id | — |
| Immutable audit lineage | End-to-end projection (§9), append-only | — |

### 8.2 Attribution snapshot + lock
Attribution (salesperson(s) + split weights) is snapshotted from the Opportunity and **locked** at the ratified lock point (proposed: Invoice issuance). After lock, attribution is immutable except by Owner break-glass (reason-required, audited). Salesperson cannot modify attribution at any point.

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

## 13. Follow-on build sequencing (design-only; each separately reviewed + gated)

- **F2** — Technician + Warehouse/Parts governed capability set (§6, §7): register `active:false`, role/eligibility grants, tests. No activation.
- **F3** — New governed roles: `salesperson`, `controller`, `shopServiceManager`; extend `accountingManager` for the commission execution set. Least-privilege + SoD tests (§10).
- **F4** — Payment reconciliation seam (`finance.payment.reconcile`, `payment_reconciliations`); attribution snapshot + lock; ties to Commercial Coverage & Territory (#15).
- **F5** — Commission bounded context (policy → eligibility → approval → payable → payment), Admin-SDK-only, `active:false` + per-env activation; SoD acceptance matrix (§10).
- **F6** — End-to-end lineage projection + audit (§9).
- **F7** — Sandbox activation + full-lifecycle E2E (§12) + evidence.

Sequencing note: F2/F3 can proceed in parallel; F5 depends on F3 (Controller/Accounting) + F4 (reconciliation + attribution lock).

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

### Open — cross-workstream
- Attribution source depends on Commercial Coverage & Territory (#15), currently RECORDED-but-unbuilt.
- Whether Warehouse/Parts graduate from operational to governed roles (F2/F3 decision).
