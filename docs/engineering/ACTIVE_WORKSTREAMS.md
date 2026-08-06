# Active Workstreams — multi-agent registry

**Status:** living registry — **the single authoritative surface for active assignment coordination.** Per [`AI_ENGINEERING_OPERATING_MODEL.md`](AI_ENGINEERING_OPERATING_MODEL.md) §8. The code-level ownership authority remains [`../architecture/SYSTEM_AUTHORITIES.md`](../architecture/SYSTEM_AUTHORITIES.md); this registry coordinates *who is actively writing where, right now*.

**Single owner of this concern (2026-08-06, Program 0 truth pass).** [`../session-state/`](../session-state/) previously carried overlapping active-lane coordination; it is now classified **HISTORICAL SNAPSHOT** and must not receive new in-flight assignments. Declare assignments here and nowhere else.

**Rules (summary — full text = the 8 numbered rules in the Operating Model §8):** declare the assignment here before writing; (1) one active writer per owned path; (2) no silent edits to a reserved shared file; (3) a shared-file collision does not stop a whole capability; (4) finish non-conflicting work and record the integration delta; (5) an Integration Agent owns high-collision files when practical; (6) a builder is not the sole approver of its own material change; (7) reviewers use repository evidence, not another agent's chat memory; (8) production promotion is serialized.

## How to use

When you begin a capability, add a row to **Active** with every declared field. Move it to **Recently completed** at capability completion (§6). Keep it short — this is a coordination surface, not a history log; `DECISIONS.md` is the durable record.

### Declared fields (template)

```
- Capability:          <business capability / feature area>
- Agent/session:       <session id or agent name> · Role: <builder|reviewer|integration|release-prep>
- Branch / worktree:   <branch> · <worktree path>
- Base commit:         <sha>
- Owned paths:         <paths this agent is the sole active writer of>
- Shared paths req'd:  <high-collision files needed; coordinate via Integration Agent>
- Dependencies:        <other workstreams/capabilities this waits on>
- Expected outcome:    <the completed capability>
- Protected boundaries:<Owner-gated items this will reach, if any>
- Lifecycle stage:     <DESIGNED|SANDBOX BUILD|SANDBOX VERIFIED|INTEGRATION|RELEASE CANDIDATE|OWNER REVIEW|PRODUCTION AUTHORIZED|OPERATIONALLY VERIFIED|RETIRED>
```

## Active

- Capability:          Supplier Master adoption (Tier-2 program, Owner-authorized) — governed Supplier identity + trusted write + Rules(prepared) + purchasing migration compat + Suppliers workspace. Phases S1–S5, repo-only.
- Agent/session:       c981623b (Claude Code) · Role: builder
- Branch / worktree:   feat/supplier-master-* · scratchpad/sm-wt (per-phase branches)
- Base commit:         (current main)
- Owned paths:         docs/architecture/supplier-master-architecture.md · functions/src/supplierMaster/** · field-ops-app-vite/src/modules/purchasing/Suppliers.jsx + domain/hooks/tests (later phases)
- Shared paths req'd:  firestore.rules (S2, PREPARED-not-deployed) · functions/src/index.ts (exports) · docs/DECISIONS.md · this registry
- Dependencies:        REUSES partMasterCommands machinery (capability/idempotency/versioning/audit/transaction) + inventory.catalog.manage/.activate; part_supplier_items is the part↔supplier authority (reused, not duplicated); WO snapshot convention for supplierNameSnapshot
- Expected outcome:    governed Supplier business object; Supplier is the catalog-governed owner of the supplierId space part_supplier_items references; reorder_purchase_orders migrates free-text supplierName -> supplierId + supplierNameSnapshot; Suppliers registry workspace; RC package with migration dry-run/rollback. NO production activation.
- Protected boundaries:Rules deploy / Functions deploy / prod supplier create / grants / prod migration / rewriting reorder_purchase_orders / deleting dormant collections / Hosting — ALL deferred to protected packages after sandbox+integration evidence
- Lifecycle stage:     S2 SANDBOX BUILD in progress — governed Supplier validator + types + 12 tests DONE (functions/src/supplierMaster/); NEXT S2 slice = trusted command service (createSupplier/update/activate/deactivate) reusing partMasterCommands + independent review; then Rules-prepared

> **Standing note.** Concurrent sessions have recently merged without declaring an assignment here
> (PRs #584, #585). Per Operating Model §8 and §8a, declare the capability, branch, **verified base
> commit**, and owned/shared paths **before** writing — that declaration is what makes rules 1–2
> enforceable.

## Ready for assignment

- **Receiving activation (protected)** — the governed receive workflow now EXISTS (A1, scanner-within-FieldMode, DECISIONS #68) but is fail-closed on `RECEIVING_TRANSPORT_READY = false`. Turning it on is a **protected boundary**: Phase-F readiness flip + authorized Hosting release + the `inventory.stock.receive` grant already live for {admin,dispatcher,owner}. Owner-gated; not a repo-only capability.
- **(Optional) dedicated admin/dispatcher Receiving surface** — A1 placed the governed receive on the scanner (technician input tool); a separate Receiving home on an admin/dispatcher surface (driven from Purchasing → Purchase Orders) could reuse the same `ReceiveAgainstPurchaseOrder` component. Repo-only if pursued; not required by A1.
- **Cycle Counts / Back Orders — DESIGN-FIRST DEFERRED (DECISIONS #76):** no governed foundation (no collection/schema/Rules/write-authority/ledger/reconciliation). NOT a UI task — each needs a spec/ADR defining the business workflow + trusted write authority before any workspace. Do not build CRUD to fill the placeholder.
- **AI Platform / Enterprise Assistant — FUTURE (reconciled into PlatformCapabilityModel §13 AI Platform):** optional cross-platform assistant; do NOT build now; brought forward only when dependencies + product value make it the strongest lever.
- **Purchasing placeholders — assessed 2026-08-06: NONE clear the repo-only implementation bar (all DESIGN-FIRST).** Receipts done (#76). Suppliers/Quotes/Demand Planning sit on the DORMANT Epic-5 procurement (`suppliers`/`supplier_catalog`/`purchase_orders` are read-only in Rules — `create/update/delete: if false` — with no write path; `supplierService` only reads and is undeployed; the active purchasing flow records supplier as FREE-TEXT `supplierName` on `reorder_purchase_orders`). A Suppliers read workspace would be an empty shell; adopting the Supplier master is Tier-2/material.
  - **STRONGEST DESIGN-FIRST candidate — Supplier Master adoption (Procurement).** Business problem: purchasing has no governed Supplier identity (free-text), so no dedup, governed terms, supplier reporting, or preferred-supplier basis for Quotes. Canonical objects: `suppliers` (Supplier), `supplier_catalog` (SupplierCatalogItem), `part_supplier_items` (governed part↔supplier terms, already exists — INV-1 PR 1.4, ≤1 ACTIVE preferred supplier/part). Lifecycle: Supplier status ACTIVE/INACTIVE (mirror the warehouse pattern). Read authority: suppliers/supplier_catalog = isAdminOrDispatcher() (live); part_supplier_items = trusted-service-only. **Missing = trusted WRITE authority** (no supplier create/activate/deactivate service; needs the truck-registry/Part-Master trusted-command pattern + Rules — Tier-2). Relationship: the reorder-PO flow would reference a governed `supplierId` instead of free-text (a write-path change + migration). No ledger/event implication (reference data). Persona: Procurement (admin/dispatcher). MVP gates: (1) governed Supplier trusted-write service + Rules; (2) Suppliers registry workspace (read, reuses the pattern); (3) wire reorder-PO to `supplierId`. **Decide before build:** adopt-master-now vs keep free-text; Supplier identity/dedup model; adopt-or-retire the dormant Epic-5 `suppliers`/`purchase_orders`; supplier-admin authority. → each gate is Owner-authorized; not a repo-only Tier-1 build.

## Recently completed (this program window — see DECISIONS.md for the durable record)

| Capability | Stage | Record |
|---|---|---|
| Purchase Orders read surface (Purchasing item C) | MERGED (repo-only) | DECISIONS #64 · PR #578 |
| PartsScanner as a tool within FieldMode (item A) | MERGED (repo-only) | DECISIONS #65 · PR #581 |
| Default-autonomy operating mode (Charter Amendment 2) | MERGED | DECISIONS #66 · PR #582 |
| AI Engineering Operating Model + Owner/IP governance | MERGED | this program · see DECISIONS |
| Governed FieldMode Receive-against-Purchase-Order (A1) | MERGED (repo-only; readiness false) | DECISIONS #68 |
| Inventory → Receiving first-class workspace (one workflow, two launch points) | MERGED (repo-only) | DECISIONS #69 |
| Executive Architecture Office — Program 0 Authoritative Truth Pass | MERGED (docs-only) | DECISIONS #70 · `reviews/eao-program-0-truth-pass.md` |
| Inventory → Transfers first-class workspace (read-only; reuses canonical view-model) | MERGED (repo-only) | DECISIONS #71 |
| Inventory → Warehouses first-class workspace (read-only; registry + governed status/eligibility) | MERGED (repo-only) | DECISIONS #74 |
| Purchasing → Receipts launch point into canonical PO projection (+ Cycle Counts deferral) | MERGED (repo-only) | DECISIONS #76 |
