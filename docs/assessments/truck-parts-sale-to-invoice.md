# Assessment — Truck Parts Sale-to-Invoice and Inventory Consumption (Issue #182)

**Status:** Assessment only. **Merging this document authorizes no Specification and no implementation.** Every "desired" behavior below is a proposal for a future, separately-authorized Specification, not a committed design.

**Base:** `origin/main` @ `078ce195672befaec403b976ffe23c4991613218`. **Scope:** documentation only — no code, Rules, indexes, Functions, or global-document change.

---

## 1. Current system truth (verified against source at this head)

Each statement below was checked directly against the repository; file/line pointers are given so a reviewer can re-verify.

### 1.1 How parts reach "truck stock" today
**There is no real, persisted truck/van stock.** The only "truck" concept is the legacy in-memory demo (`field-ops-app-vite/src/demo/InventoryContext.jsx`, `inventoryData.js`, `modules/inventory/Inventory.jsx`) — an unpersisted warehouse↔truck transfer simulation, not routed to from the current Inventory nav slot. `docs/BusinessEntityModel.md` (line ~55, ~165–172) classifies **Vehicle / Service Truck** as a **Future** entity ("Mobile inventory storage location … No prior implementation exists to migrate — the demo/in-memory 'truck' concept in `Inventory.jsx` is unrelated and out of scope"). The physical-inventory layer that *does* exist — `warehouses`, `stock_locations`, `transfer_orders` (firestore.rules ~776–792) — is **Admin-SDK-only** (`allow create, update, delete: if false`), read-only to admin/dispatcher, and has **no truck/vehicle location model and no client write path**.

### 1.2 Is truck inventory separately identifiable and authoritative?
**No.** No collection distinguishes truck stock from warehouse stock. The authoritative source of *stock movement* is the `inventory_transactions` ledger (RESERVED/RELEASED/CONSUMED), and `src/data/partsCatalog.ts` supplies only a **static, non-authoritative** `warehouseQty` baseline ("METADATA ONLY — NO STOCK AUTHORITY"). There is no per-technician / per-vehicle on-hand quantity anywhere.

### 1.3 How is consumption recorded today?
Consumption is a **`CONSUMED` entry in `inventory_transactions`**, written **only by Cloud Functions** (`transitionWorkOrder`; the ledger is `allow create, update, delete: if false`, firestore.rules ~228). Separately, per-Work-Order part usage (`qtyUsed`/`executionLog`) is written **only** by the `updateWorkOrderExecutionData` Cloud Function (`functions/src/updateWorkOrderExecutionData.ts` — "the ONLY write path … firestore.rules denies all direct client writes"). **Neither Function is deployed in production** (see §1.9). Note the two are distinct: `qtyUsed` on a Work Order is execution capture and does **not** itself post a `CONSUMED` ledger entry.

### 1.4 Can a Work Order currently reference consumed parts?
**Schematically yes, operationally no.** `fieldops_wos` supports `qtyUsed`/`executionLog` via `updateWorkOrderExecutionData`, but all client writes to `fieldops_wos`/`counters` are denied (firestore.rules ~210–219), so only that (undeployed) Function can populate it. In production today a Work Order cannot record consumed parts.

### 1.5 Does any real invoice document or invoice-generation workflow exist?
**No.** There is **no `invoices` collection, no invoice document, and no invoice-generation code.** `docs/BusinessEntityModel.md` lists **Invoice** as **Future / deferred** ("Financial transaction tied to completed service"; `invoices` — "New, deferred"). The only invoice-adjacent surface is `src/domain/financialSummaryView.js`, a **provider-neutral projection** whose only production-reachable state is `unconfigured` — it renders "Sales data source not connected" and never a figure. Labels such as "Invoiced Net Sales" are projection captions for an **external provider that is not connected**, not records of real invoices.

### 1.6 Which displays are operational records vs projections/audit notes?
- **Operational records:** `inventory_transactions` ledger (backend truth for stock movement); `reorder_requests` and `reorder_purchase_orders`/`..._voids` (the built Reorder→Purchase lifecycle); `inventory_actions` (append-only human stock-adjustment audit); `accounts`/`locations`/`contacts`.
- **Projections / not-yet-connected:** the **Financial Summary** and **Financial Forecast Horizons** sections on Customer Detail are provider-neutral, `unconfigured`-only surfaces (no `$` value, no live source). Commercial Profile fields on `accounts` (`defaultCurrency`, `purchaseOrderRequired`, `invoiceDeliveryMethod`, `paymentTerms`, `taxStatus`) are **informational metadata**, not a billing engine.
- **Audit notes:** `inventory_actions`; Reorder Request `reviewDecision`/cancellation/void records.

### 1.7 Which writes are client-direct-with-Rules vs trusted-Function?
- **Client-direct (Rules-governed):** `accounts`, `locations`, `contacts` (`create,update` admin/dispatcher); `inventory_actions` (`create` admin/dispatcher, append-only); `reorder_requests` (governed create/transition rules). PR #211's Contact CSV import uses a client `writeBatch` under these same rules.
- **Trusted-Function only:** `fieldops_wos` + `counters` (`createWorkOrder`/`transitionWorkOrder`/`updateWorkOrderExecutionData`); `inventory_transactions` ledger; and the Admin-SDK-only physical/procurement layer (`warehouses`, `stock_locations`, `transfer_orders`, `suppliers`, `supplier_catalog`, `purchase_orders`) — all `create,update,delete: if false` for clients.

### 1.8 Current role / ownership / technician authorization boundaries
`isAdminOrDispatcher()` gates virtually all office data. **Technicians** may read only their **own** Work Orders (`fieldops_wos`: `isTechnician() && isOwnTechnician(assignedTechId)`), and have **no read access to `accounts`/`contacts`/ledger**. Per **Issue #100**, `ROLES.TECHNICIAN` has **no Inventory nav access at all**, independent of `operationalRoles`. A technician-initiated truck-sale flow therefore has no current authorization surface for customer, price, or stock data.

### 1.9 Production deployment limitations (incl. Issue #15)
**No Cloud Functions are deployed** (`firebase functions:list` → empty; blocked on the Firebase **Blaze** upgrade, **Issue #15**, open). Consequently the entire Work Order write engine and every `CONSUMED`/ledger mutation are **non-functional in production today**. Any sale-to-invoice flow that consumes inventory, mutates a Work Order, or performs multi-document atomic orchestration depends on Issue #15 being resolved first. `firestore.rules`/`firestore.indexes.json` deploys are separate, manual, and must be verified after merge (repo standing lesson: merged ≠ deployed).

### 1.10 Dependencies / non-dependencies (#100, #140, #175, Customer commercial data)
- **#15 — hard blocker** for any trusted/atomic/ledger write path.
- **#100 — dependency if technician-initiated:** technicians cannot currently reach Inventory or read customer/stock data; a truck-sale UI for technicians needs this resolved (or an admin/dispatcher-only first cut that sidesteps it).
- **#140 — Customer Operability / Data Ownership / Analytical Export** (Assessment merged via PR #180): governs export/accounting-integration boundaries; **relevant to invoice export**, not to core consumption.
- **#175 — Account Commercial Profile & Financial Forecast Horizons:** supplies the commercial fields (`defaultCurrency`, `taxStatus`, `paymentTerms`) a sale would **snapshot**, and owns the (currently unconfigured) financial projection surfaces. **Related, not a hard code dependency** — a sale record can snapshot today's Account fields without #175 completing.
- **Customer commercial data:** lives on `accounts` (client-direct, admin/dispatcher). A sale would read/snapshot it; it is **not** an authoritative price/tax engine today (no line pricing, no tax computation).

---

## 2. Desired business sequence (proposal only — not authorized to build)

> truck stock → technician selects Customer/Work Order → records parts + quantities → validates availability → consumes/reserves inventory → records price/tax context → creates an invoice-ready sale record → projects or creates invoice output → supports correction, return, cancellation, and audit.

This sequence assumes **new capabilities that do not exist today** (an authoritative truck/vehicle stock model, a sale/line-item record, price/tax on parts, and an invoice projection). Each is called out below.

### Explicit questions to resolve (each is an open design question, not a decision made here)

- **Authoritative source of quantity.** Today: the `inventory_transactions` ledger (backend), with no per-truck partition. A truck sale needs a *decrementable, per-vehicle* authoritative quantity — either a new truck-scoped ledger partition or a new stock model. **Open:** ledger-per-location vs a new `vehicle_stock` aggregate reconciled to the ledger.
- **Reservation vs immediate consumption.** Today the ledger models both RESERVED and CONSUMED, but no client path drives them. **Open:** does a truck sale reserve at line-entry and consume at sale-confirm, or consume immediately? Reservation adds a release/expiry concern.
- **Atomicity across stock, Work-Order usage, sale, and invoice projection.** These are ≥3–4 documents in different collections; partial application is unacceptable (a sale that decrements stock but leaves no sale record, or vice-versa). **Requires a single atomic transaction** — infeasible as independent client writes.
- **Idempotency / duplicate-submit prevention.** A retried "confirm sale" must not double-consume. Needs a client-supplied idempotency key or a deterministic sale document id (mirrors the `reorder_purchase_orders` "doc-id == request-id, second write is an update the rule denies" technique).
- **Concurrency / insufficient stock.** Two technicians consuming the same SKU must not oversell. Needs read-verify-write inside the transaction (as `updateWorkOrderExecutionData` already does), against an authoritative quantity that does not exist per-truck yet.
- **Price snapshot vs live catalog price.** `partsCatalog.ts` has static `cost`/`price` but is explicitly non-authoritative metadata. A sale line must **snapshot** the price at sale time (immutable), not recompute from a mutable catalog. **Open:** where the governed, authoritative price list lives (none exists today).
- **Discounts, tax, currency, Customer commercial defaults.** No discount or tax **computation** exists. `taxStatus`/`defaultCurrency`/`paymentTerms` are informational Account fields. **Open:** tax engine ownership, currency handling, and how much to snapshot from the Account vs enter per-sale.
- **Labor vs parts boundary.** This assessment covers **parts** consumption/sale. Labor lines, rates, and time capture are **out of scope** and a separate future concern; the sale record model should not foreclose adding them.
- **Returns, voids, reversals, credit.** The platform has a strong precedent: the Reorder **Cancel/Void** model (append-only `reorder_purchase_order_voids`, never-delete). A sale reversal should re-credit stock and produce an append-only reversal/credit record, never mutate or delete the original sale.
- **Offline / mobile behavior.** Trucks work offline. Firestore offline persistence + a callable transaction is a tension (callables need connectivity). **Open:** queue-and-sync vs online-only confirm; strongly affects the architecture choice.
- **Human-readable identifiers.** Sale/invoice numbers must be human-readable and gap-controlled (the platform already uses a `counters` collection + Function for `woNumber`). No raw document ids in UI (a standing rule this repo enforces).
- **Audit trail / immutable history.** Every consume/sale/reversal must be reconstructable; follow the ledger + append-only-audit precedent (`inventory_transactions`, `inventory_actions`, void records).
- **Production deployment / runtime.** Any atomic/trusted path requires **Issue #15** (Blaze + Functions deploy). This is the gating runtime requirement.
- **Security roles / self-scoped technician access.** A technician must act only on their own assignment and see only permitted customer/price data — today they see none. Requires new, tightly-scoped read/write rules (and Issue #100 for nav).
- **Data retention / export / accounting integration boundaries.** Invoice output likely needs export to an external accounting system (per #140/#175's provider-neutral posture). **Open:** own-the-invoice vs project-to-external-provider; retention policy.

---

## 3. Architecture options

### Option A — Client-direct, Rules-governed transaction
A client `runTransaction`/`writeBatch` (like PR #211's Contact import) writes the sale + stock decrement + WO usage under Firestore Rules.
- **Benefits:** no Blaze/Functions dependency; works on the Spark plan **today**; reuses the established client-direct pattern; simplest to ship a first cut.
- **Risks:** Rules cannot safely enforce a multi-collection *stock-sufficiency* invariant across arbitrary documents; oversell/idempotency/price-authority are hard to guarantee in Rules; business logic leaks into the client; the ledger is currently `write: false` and would have to be **opened to clients** (a Tier-2 posture reversal against ADR-003's "ledger is backend-only").
- **Rules/security impact:** **high** — requires opening `inventory_transactions` (or a new sale/stock collection) to client writes with complex `getAfter()`/`existsAfter()` invariants; reverses a core architecture rule.
- **Functions/Blaze dependency:** **none** (its main appeal).
- **Failure/restoration:** transaction aborts cleanly, but a wrong Rule = silent oversell; hard to restore trust in ledger integrity.
- **Testability:** Rules-emulator tests (repo has the pattern) — but the invariant surface is large and brittle.
- **Operational burden:** low infra, **high** correctness-risk burden.

### Option B — Trusted callable Function performing atomic orchestration
A callable Cloud Function (like `createWorkOrder`/`updateWorkOrderExecutionData`) does auth + read-verify-write across stock, WO usage, sale record, and human-readable numbering in **one server transaction**.
- **Benefits:** matches the platform's **existing** sanctioned Work-Order/ledger write pipeline; enforces sufficiency/idempotency/price-snapshot server-side; keeps the ledger backend-only (ADR-003 intact); single audit point.
- **Risks:** **requires Issue #15 (Blaze)** — not runnable in production today; adds a new deployed surface to operate.
- **Rules/security impact:** **low/clean** — clients stay denied on stock/WO/sale; Rules only gate reads; authorization centralised in the callable (`getCallerContext`).
- **Functions/Blaze dependency:** **hard** (this is the blocker).
- **Failure/restoration:** atomic transaction → all-or-nothing; retriable with idempotency key; standard Functions observability.
- **Testability:** Functions emulator (already used) + rules tests for reads; strongest end-to-end story.
- **Operational burden:** Functions deploy/runtime to operate, but aligns with the intended long-term architecture.

### Option C — Staged sale/consumption record with asynchronous invoice projection
A trusted write records the **sale + consumption atomically** (as Option B), then invoice output is produced **asynchronously** (a projection/export step, possibly to an external accounting provider), decoupled from the consume transaction.
- **Benefits:** separates the *operational* truth (stock consumed, sale recorded) from *financial* output (invoice), matching the platform's provider-neutral financial posture (#140/#175); invoice provider can change without touching consumption; export failures don't block field work.
- **Risks:** eventual-consistency between sale and invoice must be visible and reconcilable; more moving parts; still needs the trusted consume path (so still #15 for the atomic core).
- **Rules/security impact:** same clean read-gate posture as B; adds a projection/export boundary to govern.
- **Functions/Blaze dependency:** **hard** for the atomic sale core; the projection step may be sync or async/external.
- **Failure/restoration:** consume and invoice fail independently; invoice can be re-projected from the immutable sale record (good restoration story).
- **Testability:** sale-core testable in the emulator; projection testable in isolation against the sale record.
- **Operational burden:** highest (two subsystems), but best separation of concerns and export-readiness.

---

## 4. Recommendation (with explicit unresolved Owner decisions)

**Recommended direction: Option C's shape, built on Option B's trusted atomic core** — i.e. a trusted callable that atomically records **consumption + an immutable, invoice-ready sale record with a price snapshot**, and a **separate, later** invoice-projection/export step. This preserves ADR-003 (ledger backend-only), matches the existing Work-Order write pipeline, keeps invoice output provider-neutral (aligning with #140/#175), and gives an immutable record to re-project from.

**Option A (client-direct) is not recommended** as the durable design — it would reverse the ledger's backend-only invariant and cannot safely enforce stock sufficiency/idempotency. It is only worth considering as a deliberately-scoped, admin/dispatcher-only, Spark-plan *interim* if the Owner wants something before Issue #15, and even then only for a non-authoritative "record intent" step, not real consumption.

**This recommendation is explicitly gated on Issue #15** and does not commit the platform to build anything.

**Unresolved decisions that only the Owner can make:**
1. **Blaze/#15:** adopt Functions now, or defer the whole capability until Blaze is enabled?
2. **Truck-stock authority:** introduce a real per-vehicle stock model, or treat "truck sale" as a warehouse consumption with a location tag?
3. **Own vs project the invoice:** build a first-party `invoices` entity, or project to an external accounting provider only?
4. **Price authority:** where the governed, authoritative price list lives (none exists; `partsCatalog` is non-authoritative).
5. **Tax:** in-platform tax computation vs external; how `taxStatus`/currency drive it.
6. **Reservation vs immediate consumption**, and **offline** confirm semantics (online-only vs queue-and-sync).
7. **Technician initiation** (requires #100) vs admin/dispatcher-only first cut.
8. **Retention/export boundaries** (per #140).

---

## 5. Proposed small, reversible implementation sequence (separate gates — none authorized here)

Each gate is a separately-authorized Specification/PR; each is reversible on its own. Nothing below is approved by merging this Assessment.

1. **Data model & invariants** *(docs-only)* — define the sale/line-item + consumption/reversal schema, human-readable numbering, price-snapshot rule, and the atomicity/idempotency invariants. No code.
2. **Trusted write path** *(gated on #15)* — a callable that atomically consumes stock + writes the immutable sale record, with idempotency-key and read-verify-write sufficiency checks. Emulator-tested.
3. **Rules** *(Tier-2)* — read gates for the new collections; keep client writes denied on stock/sale; explicit technician self-scoping. Escalated + deploy-verified.
4. **Technician UI** *(gated on #100 if technician-initiated)* — select customer/WO, add parts+qty, availability + safe error states; no raw ids; 375px.
5. **Invoice projection / export** *(gated on #140 boundaries)* — project the immutable sale record to invoice output / external accounting provider; provider-neutral, re-projectable.
6. **Reversal / return workflow** — append-only credit/reversal that re-credits stock, never mutates/deletes the original sale (Cancel/Void precedent).
7. **Emulator + authenticated production verification** — emulator suite for every path, then a controlled authenticated production verification once Functions are deployed (separate Owner authorization; no production data mutated speculatively).

---

## 6. Boundaries

Merging this Assessment **authorizes no Specification and no implementation**. It records current truth and a proposed shape only. It makes no Rules/index/Functions/schema change, deploys nothing, and mutates no production data. Issue #182 remains OPEN for the future decisions above.
