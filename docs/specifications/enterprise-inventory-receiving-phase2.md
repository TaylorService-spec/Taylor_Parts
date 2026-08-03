# Enterprise Inventory — Phase 2 Receiving: Detailed Specification (delta)

**Status:** DRAFT for Codex review + separate Owner ratification. **Docs-only — no runtime code, Rules,
indexes, Functions, callable exports, capability grants, client cutover, migration, deployment, or
production records are introduced by this gate.**

**Authority:** this is the delta detailed specification for the **already-approved** Receiving Order
authority — [enterprise-inventory-architecture.md](enterprise-inventory-architecture.md) §3.2
(Operational Workflow Objects) and §4.4 (Receiving), scheduled by
[implementation-plans/enterprise-inventory-architecture.md](../implementation-plans/enterprise-inventory-architecture.md)
Phase 2. It does **not** introduce a new or competing Receiving object; it pins the deferred schema,
first source, capability, AuditAction, transaction ordering, Rules/index posture, and cutover.

Approved anchors (unchanged here): §3.2 Receiving Order lifecycle **EXPECTED → CHECKED_IN →
PUTAWAY_COMPLETE**, ledger effect **RECEIVED per line, at putaway location**; §4.4 one receiving flow
(PO / reorder request / blind-receipt-as-adjustment); §4.1 additive ledger + `locationId` +
trusted-writer aggregates; §4.9/§4.10 serial/lot captured at receiving.

Reuses the merged inert `functions/src/inventoryLedger/` repository (`stageOperationalMovement`,
`RECEIVED` → `sourceObject {type:"RECEIVING_ORDER", id}`). No second ledger, warehouse service,
serialized-asset authority, or purchase-order authority is created.

---

## 1. `receiving_orders` schema (exact)

New **Admin-SDK-only** collection `receiving_orders/{receivingId}`, **fully backend-private** — Rules
deny **all** client reads **and** all client writes (Option A, §9). This is **deliberately stricter**
than `inventory_transactions` / `trucks`, which deny client writes but **do permit** governed client
reads (admin/dispatcher, and for the ledger active PARTS_MANAGER/WAREHOUSE_MANAGER); `receiving_orders`
grants **no** client read in this slice. Document identity **is** domain identity; never derived from a
mutable label.

| Field | Type | Rules |
|---|---|---|
| `receivingId` | string (doc id) | immutable; governed, path-safe id (see §8 idempotency for derivation) |
| `source` | object | `{ type: "REORDER_PURCHASE_ORDER", reorderRequestId, purchaseOrderId }` — first source only (§2) |
| `receivingLocation` | `{ type, locationId }` | putaway location; validated active `InventoryLocation` reference (EI-P1a `validateLocationRef`) |
| `status` | enum | `EXPECTED` → `CHECKED_IN` → `PUTAWAY_COMPLETE`; plus terminal `CANCELLED` (pre-receipt only) |
| `version` | integer | `INITIAL_VERSION = 1`; advances +1 per governed transition (CAS, §3) |
| `lines` | array | line identities (below); **NONE-tracked only** in this slice |
| `idempotencyKey` | string | caller-supplied per-receipt dedup key (never minted server-side) |
| `actor` | `{ kind, id }` | trusted-writer actor (kind ∈ USER/SYSTEM); id derived from `request.auth.uid` at the callable boundary |
| `createdAt/createdBy/updatedAt/updatedBy` | server-authored | trusted-writer clock; **never** caller-supplied |

**Line** (`lines[]`): `{ lineId, partId, trackingMode: "NONE", expectedQuantity, receivedQuantity,
status: "RECEIVED" }`. `lineId` is a stable within-order identity. **First slice: exactly one line**,
whose `receivedQuantity == expectedQuantity == PO.orderedQuantity` (§5), created directly as `RECEIVED`
⇒ one `RECEIVED` ledger event (§7). No `serialNo`/`lotId`/expiration fields in this slice (deferred, §5).

Aggregates (`on_hand`/`reserved`, §4.1) are **out of this slice** — the RECEIVED ledger event is the
truth; materialized aggregates arrive with the §4.1 warehouse-aggregate gate. This slice never writes
`stock_locations` or any aggregate total.

## 2. Source references and identity (first supported source only)

**First source = the live reorder purchasing chain** (Owner-directed; matches §4.4 "against a reorder
request … closing the current `receiveReorderRequest` status-only gap"):

- `reorder_purchase_orders/{reorderRequestId}` (status `ORDERED`) — the ordered PO, keyed 1:1 by
  `reorderRequestId`.
- linked `reorder_requests/{reorderRequestId}` (status `ORDERED`, matching `partId`).

`source.reorderRequestId` **is** the source identity (both reorder docs are keyed by it);
`source.purchaseOrderId == reorderRequestId` is recorded explicitly for clarity. The RECEIVED ledger
event's `sourceObject` is `{ type:"RECEIVING_ORDER", id: receivingId }` (the Receiving Order is the
ledger source; the reorder PO is the **upstream** source of the Receiving Order).

**Excluded first sources (Owner-directed):** dormant Epic-5 `purchase_orders` (roadmap-scheduled for
deprecation under Procurement unification, plan Phase 2 row 3); blind/direct receipt (§4.4 classifies it
as an **Adjustment-authorized** flow whose approval lifecycle is not implemented yet).

## 3. Lifecycle and version/CAS rules

**First NONE-only command — one governed transition, final `version = 1`.** The initial
`receiveInventoryStock` command is defined as **exactly one** governed transition that **creates** the
Receiving Order directly in the terminal `PUTAWAY_COMPLETE` state with **final `version = 1`** and emits
**one** `receiveInventoryStock` Audit Event. It is *not* three transitions and does not pass through
`EXPECTED`/`CHECKED_IN` (there is no intermediate persisted state and no `version` 2/3).

**Later multi-step receiving (deferred).** The full `EXPECTED → CHECKED_IN → PUTAWAY_COMPLETE` machine
(+ `CANCELLED` only from `EXPECTED`/`CHECKED_IN`, pre-receipt) is specified for a later gate: each
transition is a trusted-writer command reading the current `version` and writing `version + 1` (mismatch
→ `VERSION_CONFLICT`) with **one Audit Event per transition**, and `RECEIVED` ledger events emitted at
the `PUTAWAY_COMPLETE` transition. In both models no status regresses and terminal states are immutable.

## 4. `reorder_purchase_orders` / `reorder_requests` compatibility mapping

| Existing (client, status-only) | Receiving (trusted, ledger-backed) |
|---|---|
| `reorder_purchase_orders/{reorderRequestId}` (status `ORDERED`) | **READ-ONLY authoritative ordered source.** The PO document is treated as **immutable after creation** (its `PURCHASE_ORDER_STATUS` enum has only `ORDERED`; there is no `RECEIVED` PO status). The command **never** writes, transitions, or rewrites it — it is byte-for-byte unchanged after receipt. |
| `reorder_requests.status ORDERED` | source precondition; on successful receipt → terminal `RECEIVED` (the same terminal the client sets today) **+** `receivedAt/receivedBy`. This is the **only** reorder-chain document the command transitions. |
| `receiveReorderRequest()` (client, no ledger) | **unchanged during repo prep**; superseded by the trusted command **only at cutover (§11 / Phase F)** |
| historical reorder/PO/void records + `inventory_actions` | **read-only, never rewritten** |

Physical completion is recorded **only** in the additive `receiving_orders` document and the `RECEIVED`
ledger event(s) — never as a PO mutation. No existing client writer is silently redirected. The reorder
terminal meaning (`reorder_requests` → `RECEIVED`) is preserved; the delta is that the trusted path
*also* appends a `RECEIVED` ledger event atomically. (Because the PO is never mutated, this slice adds
**no** `reorder_purchase_orders` write, Rules change, or index.)

## 5. NONE-only line contract

The current `reorder_purchase_orders` authority is **single-part** and carries `orderedQuantity`, so the
first slice is a **full, exact, single-line** receipt bound to the ordered quantity — no partial, over-,
or under-receipt:

- **Exactly one** receiving line per Receiving Order (reject line-count ≠ 1 atomically).
- `line.partId == reorder_purchase_orders.partId == reorder_requests.partId` (reject mismatch).
- `line.expectedQuantity == reorder_purchase_orders.orderedQuantity` (reject mismatch).
- `line.receivedQuantity == reorder_purchase_orders.orderedQuantity` (reject **partial**, **over-**, and
  **under-**receipt) — all atomic; nothing commits on any mismatch.
- `trackingMode` resolved from the **Part authority**; **NONE** required. `receivedQuantity` is finite
  `> 0` (guaranteed by the equality above, since a valid PO `orderedQuantity` is `> 0`). One `RECEIVED`
  ledger event for the single line.
- **SERIAL:** command **fails closed** (`TRACKING_MODE_UNSUPPORTED`) — deferred until `serialized_assets`
  persisted identity/uniqueness is pinned (EI-P2a deferral). No partial serial receipt.
- **LOT:** command **fails closed** — deferred until the governed lot-identity contract exists (§4.10).
- A request with any SERIAL/LOT part fails the whole transaction (no partial receipt).

**Partial / multi-line receipt is out of scope** and requires a **later governed remaining-quantity
model** (a `receivedToDate` / open-quantity contract on the source and a Receiving Order that can remain
open across multiple receipts) — not attempted here. Until that model exists, a receipt is all-or-nothing
against the full `orderedQuantity`.

## 6. Capability and AuditAction

- **Capability:** pin `inventory.stock.receive` — catalog entry `{ id:"inventory.stock.receive",
  resource:"inventory.stock", action:"receive" }` (mirrors the existing `reorder.request.*` shape).
  **Registered inert / UNGRANTED** in repository preparation (Phase C). No role receives it in the spec
  or repo-prep gates. Operational-role grants (incl. any `WAREHOUSE_MANAGER` grant) are a **separate
  Issue-100 / capability decision**; admin/dispatcher compatibility is addressed explicitly at the
  activation gate (Phase E).
- **AuditAction:** add a **distinct trusted** action `receiveInventoryStock` to the AuditAction
  allow-list (Phase C). It is **not** the client audit-only `RECEIVE_STOCK` `inventory_actions` entry;
  logged-only history is never conflated with applied physical receipt. Audit summaries carry **no** raw
  errors and **no** sensitive supplier/commercial fields.

## 7. Transaction ordering (one Firestore transaction; nothing commits independently)

1. **Authorization** — resolve the actor holds `inventory.stock.receive` (Enterprise Access resolver);
   commit-time authoritative read of the actor's grant.
2. **Idempotency** — deterministic Receiving idempotency doc (§8): existing coherent record → replay;
   changed payload → conflict.
3. **Source PO (read-only)** — read `reorder_purchase_orders/{reorderRequestId}`; require exists +
   `ORDERED`. The PO is the authoritative ordered source and is **never written** (§4).
4. **Linked request** — read `reorder_requests/{reorderRequestId}`; require exists + `ORDERED` + `partId` match.
5. **Destination** — validate `receivingLocation` is an active governed Location.
6. **Part authority** — active Part + `trackingMode`; **NONE only** (fail closed on SERIAL/LOT, §5).
7. **Line + quantity validation (§5)** — **exactly one** line; `line.partId == PO.partId ==
   request.partId`; `line.expectedQuantity == PO.orderedQuantity`; `line.receivedQuantity ==
   PO.orderedQuantity` (reject partial/over/under and line-count ≠ 1, atomically).
8. **Receiving Order** — stage **create** at `PUTAWAY_COMPLETE` with final `version = 1` (one governed
   transition, §3).
9. **Ledger** — one `RECEIVED` event for the accepted NONE line via `stageOperationalMovement`
   (`sourceObject {RECEIVING_ORDER, receivingId}`, `location = receivingLocation`, quantity =
   `receivedQuantity`; `recordedAt` server-authored).
10. **Reorder closeout** — `reorder_requests` `ORDERED→RECEIVED` (+ `receivedAt/receivedBy`) **only** when
    the physical receipt succeeds. **No `reorder_purchase_orders` write** — the PO stays byte-identical (§4).
11. **Audit** — one immutable `receiveInventoryStock` Audit Event.

No workflow transition commits without its ledger event and audit; no ledger event commits without its
workflow transition (single `runTransaction`).

## 8. Idempotency

Deterministic, path-safe (reuses the truck-registry / ledger fingerprint precedent): a per-receipt
`idempotencyKey` derives the Receiving Order identity and an idempotency record; each `RECEIVED` line
event carries its own ledger idempotency (`imv_` docs) so replays never duplicate ledger entries.

- **Exact retry** → `replayed`: same Receiving Order, same ledger events, same audit; zero new writes.
- **Same key + changed request** → `IDEMPOTENCY_CONFLICT`.
- **Transaction failure at any staged boundary** → no partial Receiving Order, ledger event, closeout,
  or audit (all staged in the one transaction).
- **Malformed stored records** fail closed (`MALFORMED_STORED_RECORD`); historical entries never rewritten.

## 9. Rules posture

- `receiving_orders`: **new Admin-SDK-only, fully backend-private** collection — **Option A**:
  ```
  allow read, create, update, delete: if false;   // deny ALL client reads AND writes
  ```
  This is **deliberately stricter** than `inventory_transactions` / `trucks` (which deny client writes
  but permit governed client reads); the earlier "same posture" comparison was inaccurate and is
  removed. All reads/writes go through the trusted Admin-SDK command only. **Any future Receiving-history
  UI requires a separately reviewed read grant (Option B personas) or a trusted read surface** — it is
  NOT implied by this gate. Rules added in **Phase D** only.
  - **Phase-D Rules tests (required):** client reads DENIED for admin, dispatcher, each operational role
    (PARTS_MANAGER/WAREHOUSE_MANAGER/PARTS_ASSOCIATE), technician, and unauthenticated; and all client
    writes (create/update/delete) DENIED for every persona.
- `reorder_requests`: Rules **unchanged during repo prep**. At cutover the trusted command writes the
  `reorder_requests` closeout via Admin SDK (Rules do not gate Admin writes); the client status path is
  retired (Phase F). No client rule is loosened.
- `reorder_purchase_orders`: **read-only** to the command — never written by it (§4), so **no Rules or
  index change** for the PO in any phase of this slice.
- No Rules are changed or deployed in this specification gate.

## 10. Index requirements

- `receiving_orders` lookups by `source.reorderRequestId` (single-field equality → automatic index),
  and by `status` (single-field). Pure equality → **no composite index required** initially.
- `RECEIVED` ledger reads use the existing single-field ledger indexes.
- Any composite index discovered during Phase B/D implementation is disclosed and added in **Phase D**;
  none is asserted now. If a composite index becomes mandatory, that is a Phase-D decision, not a
  silent addition.

## 11. Rollback / cutover

- **Repo prep (Phases A–C):** inert — no production writes, no client change, no Rules/deploy. Trivially
  reversible (revert the docs/code PRs).
- **Cutover ordering (separately gated):** (1) trusted command deployed + verified (Phase E); (2) client
  switched from `receiveReorderRequest()` status-only to the trusted command (Phase F) **only after**
  verification. **No interval** where the UI implies physical receipt without a `RECEIVED` ledger event.
- **Historical records** (reorder/PO/void/`inventory_actions`) remain readable and are **never
  rewritten**. `inventory_actions` RECEIVE_STOCK remains an **audit-only log** (never applied stock).
- **Rollback (fail-closed — never re-enable ledgerless receipt).** After production activation the
  legacy status-only `receiveReorderRequest()` writer is **never restored**; re-enabling it would recreate
  the exact receipt-without-ledger interval this gate eliminates. A rollback instead **disables/hides the
  receiving action** (or restores a prior frontend build in a **fail-closed** state where receipt
  submission is **unavailable**) — the user cannot mark `RECEIVED` at all rather than marking it without a
  ledger event. The **verified trusted callable stays deployed** during any frontend rollback (the
  ledger-backed path is preserved). Recovery is a **forward fix**, or a **separately reviewed** rollback
  that still routes every `RECEIVED` through the trusted command; a rollback that reintroduces the
  status-only writer is prohibited. The trusted command is idempotent (safe re-run) and Receiving Orders +
  `RECEIVED` events are additive (a frontend rollback cannot corrupt them). `updateStockLocation`
  retirement (§4.3) is **not** part of this slice.

## 12. Emulator + regression matrix

**Offline (pure):** `receiving_orders`/line schema validation; NONE line contract; SERIAL/LOT fail-closed;
lifecycle + version/CAS; source/destination reference validation; idempotency fingerprint determinism;
non-mutating.

**Firestore emulator (trusted command):**
- authorization deny (no `inventory.stock.receive`) / allow;
- source PO + linked reorder-request validation (missing / wrong-status / partId mismatch → fail closed);
- **quantity/line-count binding (§5): line-count ≠ 1, `receivedQuantity`/`expectedQuantity` ≠
  `orderedQuantity` (partial, over-, under-receipt), and partId mismatch each → fail closed with ZERO
  writes** (no Receiving Order, ledger event, closeout, or audit);
- **`reorder_purchase_orders/{reorderRequestId}` is byte-identical before and after a successful receipt**
  (the command never writes the PO);
- active-destination-location validation;
- Receiving Order created at `PUTAWAY_COMPLETE` with final `version = 1` (single governed transition);
- `RECEIVED` ledger event **shape + putaway location** for the accepted line;
- NONE receipt succeeds; SERIAL/LOT rejected (no partial);
- duplicate `lineId` / multi-line request rejected;
- **atomicity**: simulated failure after each staged boundary (Receiving stage / ledger stage / closeout
  stage / audit stage) → **nothing** commits (no partial Receiving Order, ledger, closeout, or audit);
- idempotent replay (zero duplicates) and same-key-changed-payload conflict;
- terminal reorder closeout (`reorder_requests` only) **only** on successful receipt;
- audit-only `inventory_actions` remains non-stock-changing;
- existing `inventoryService` + Work-Order engine tests remain green;
- **no callable/export/deployment path exists** for the command in Phases A–D (inert).

**Cutover regression (Phase F):** prove that **no production UI path can mark a reorder request
`RECEIVED` without invoking the trusted command** — the status-only `receiveReorderRequest()` client
writer is removed/disabled, and a rollback leaves receipt submission unavailable rather than
ledgerless (§11).

## 13. Phased PR sequence

| Phase | Scope | Gate |
|---|---|---|
| **A** | pure types + validation + `receiving_orders` repository (reuse ledger repo); inert | repo-only DRAFT → Codex → Owner merge |
| **B** | trusted internal command (**not exported**) + emulator tests (§12) | repo-only DRAFT → Codex → Owner merge |
| **C** | capability `inventory.stock.receive` (inert/**ungranted**) + `receiveInventoryStock` AuditAction registration | repo-only DRAFT → Codex → Owner merge |
| **D** | `firestore.rules` deny-client for `receiving_orders` + any indexes | Rules/index gate → Owner deploy auth |
| **E** | callable export + **targeted** deploy + admin/dispatcher-compat decision | deploy gate → Owner auth (operator-run) |
| **F** | client cutover from status-only `receiveReorderRequest` to the trusted command | activation gate → Owner auth |
| **G** | production verification + sanitized evidence | verification gate → Owner auth (operator-run) |

Phases A–C are repository-only and inert. D–G require Rules/deploy/activation and are each separately
Owner-authorized. Serial/lot receiving (§4.9/§4.10), aggregates (§4.1), `updateStockLocation` retirement
(§4.3), Adjustment/blind-receipt (§4.8), and Procurement unification (plan Phase 2 row 3) are **out of
scope** and remain their own governed gates.

---

**Boundaries honored by this gate:** docs-only; no runtime code, Rules, indexes, Functions, callable
exports, capability grants, client cutover, migration, deployment, or production records. No Truck ID 1
mutation, no second truck, no receipts/ledger/stock, no historical rewrite, no deletion-path activation.
