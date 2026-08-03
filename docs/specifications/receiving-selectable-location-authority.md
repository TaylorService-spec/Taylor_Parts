---
artifact_type: specification
gate: Receiving Location Authority Reconciliation
status: Draft
date: 2026-08-03
owner: Claude Code
session: CUSTOMER
depends_on:
  - docs/specifications/inventory-receiving-frontend-cutover.md
  - docs/specifications/enterprise-inventory-receiving-phase2.md
related_adrs: [ADR-003, ADR-005]
implements: []
supersedes: []
superseded_by: []
related_pr: null
related_issue: null
target_release: null
---

# Receiving Selectable-Location Authority — Reconciliation & Specification

**Status: DRAFT — docs-only. Merging authorizes NO implementation.** This document
resolves the open dependency left by the merged Receiving frontend cutover spec
(`inventory-receiving-frontend-cutover.md` §0.5/§18): *from which governed source may
the future Receiving UI offer selectable putaway locations?* It creates no runtime
code, Rule, index, Function, callable, capability, deployment, migration, or
production-data change.

**Session boundary.** Authored by the **CUSTOMER** session. Customer may own the
future frontend location-options adapter/hook/UI and their tests
(`src/services/*location*Options*`, `src/hooks/*Location*Options*`). The **INVENTORY**
session owns `functions/**` destination validation, location persistence writers,
`firestore.rules`/indexes, capability changes, and backend deployment — this document
proposes those as **references/dependencies**, never edits them, and does not touch
PR #533. No `functions/**`, Rules, index, runtime-frontend, `App.jsx`, `package.json`,
capability/AuditAction, callable/deploy/Hosting, production, or Truck change is made.

Verified against `origin/main` @ `c8d981c` (== authoritative head at issue). Path
convention: `firestore.rules`, `functions/…`, `docs/…` repo-root-relative; `src/…`
relative to `field-ops-app-vite/`.

---

## 1. Reconciliation — persisted location authorities (READ-ONLY, VERIFIED)

| Collection | Client read (Rules) | Client write (Rules) | Client-readable shape | Active/eligibility state? |
|---|---|---|---|---|
| `warehouses` | `isAdminOrDispatcher() \|\| isAssignedToWarehouse(id)` (`firestore.rules:1167`) | **`create,update,delete: if false`** — Admin-SDK-only | `RawWarehouse = { id, name, location }` (`services/operationsQueries.ts:35`) | **NONE** — no `active`/`status`/`lifecycle`/`deleted` field exists or is read |
| `stock_locations` (BIN) | admin/dispatcher or assigned-warehouse | `if false` | bin-level qty within a warehouse | none exposed |
| `mobile_locations` (MOBILE) | `isAdminOrDispatcher()` (`:1203`) | `if false` — Admin-SDK-only; docId **is** the `locationId` | Truck Registry / ADR-010 Location record | **Truck surface — EXCLUDED**, not touched |
| `trucks` | `isAdminOrDispatcher()` | `if false` | business record | Truck surface — excluded |
| `inventory_locations` | — | — | **does not exist** | — |

**Location reference contract (EI-P1a):** `domain/inventoryLocation.js` validates a
`{ type, locationId }` **reference shape only** over the bounded
`INVENTORY_LOCATION_TYPES` (`WAREHOUSE/BIN/MOBILE/VENDOR/CUSTOMER/VIRTUAL`). It does
**not** query existence or active status. There is **no** `VENDOR`/`CUSTOMER`/
`VIRTUAL` persisted location collection at all; `WAREHOUSE`→`warehouses`,
`BIN`→`stock_locations`, `MOBILE`→`mobile_locations` are the only persisted backings,
all Admin-SDK-only, none carrying a client-readable active flag.

**Existing warehouse selector:** `hooks/useWarehouseOptions.js` +
`fetchWarehouseOptions()` (`services/truckRegistryCommandClient.js`) — a bounded
one-shot read of `warehouses` mapped to `{ value: id, label: name ?? id }`,
**does not filter eligibility**, and its own comment states *"Warehouse
existence/active state is authoritatively re-checked by the trusted service; this is
a pick-list only."* This is the established, honest pattern: offer options, let the
trusted backend own activity.

**Backend Phase-B destination seam (read-only, from the merged
`enterprise-inventory-receiving-phase2.md`):** the command takes
`receivingLocation { type, locationId }`, a **"validated active `InventoryLocation`
reference"** (§2); step 5 *"validate `receivingLocation` is an active governed
Location"* (§7 line 148); emulator asserts *"active-destination-location validation"*
(§12). **The trusted command is the active-location authority.** (PR #533 is Phase B's
`receiveInventoryStock` command; its exact callable name/payload/errors are **not
merged** and are **not pinned here** — backend-contract boundary.)

**Key finding:** **warehouse activity CANNOT be proven from any client-readable
persisted authority.** No collection exposes an active/eligibility field to the
client; the sole authority for "is this an active governed Location" is the trusted
backend command.

---

## 2. Required decision — recommendation: **Option C**

> **C. Temporary WAREHOUSE-only adapter with backend-authoritative validation.**

**Why C (evidence-based):**

- A safe source exists to *offer* options — the bounded `warehouses` id/label read
  (`fetchWarehouseOptions`) — but it does **not** establish activity (§1).
- The backend command **is** the active-location authority (Phase-2 §2/§7/§12).
- Therefore the frontend offers `WAREHOUSE` options as an **existence/activity-agnostic
  bounded pick-list** and makes **no active-state claim**. Eligibility is defined
  **solely as "the trusted command accepts the `{ type:"WAREHOUSE", locationId }`
  reference as an active governed Location."** A stale/ineligible option is handled by
  the command's **sanitized rejection → refresh** (idempotent, never a ledgerless
  write), exactly as the merged cutover spec already requires.
- **This is not a false active-state claim:** the UI never labels an option "active",
  never asserts existence at submit time, and defers activity entirely to the
  backend — the same discipline `useWarehouseOptions.js` already ships.

**Why not the others:**

- **A (reuse `warehouses` as the governed active authority) — REJECTED.** `warehouses`
  has **no** eligibility/active field to pin; selecting A would require inventing a
  field or asserting that an id/label implies eligibility — a named STOP condition.
- **B (dedicated `inventory_locations` projection/authority) — DEFERRED, future.** A
  governed, client-readable active-location authority is the *correct long-term*
  source, but it is an **Inventory-owned persistence build** (writer + Rules + index)
  and is not required for a fail-closed first slice. Named here as the future
  upgrade path (§7); recommended if/when the frontend must show eligibility *before*
  submit, or support multiple putaway types.
- **D (HALT) — not required.** A defensible, fail-closed specification is producible
  (C). D is the conservative alternative the Owner may still elect **as a one-line
  policy** (§6): if the frontend must never *offer* an option it cannot prove active,
  Receiving stays unavailable until B ships.

**First-slice destination type: `WAREHOUSE` only.** `BIN` adds sub-warehouse
granularity; `MOBILE` is the excluded Truck surface and putaway-to-truck is out of
scope; `VENDOR`/`CUSTOMER`/`VIRTUAL` have no persisted backing and are not physical
receipt destinations. The NONE-only first slice receives to a single `WAREHOUSE`.

---

## 3. Specification (contingent on Owner electing C)

### 3.1 Source & type
- **Source collection:** `warehouses` (bounded read).
- **Destination type:** `WAREHOUSE` only (`{ type: "WAREHOUSE", locationId: <warehouseId> }`).

### 3.2 Eligible / ineligible predicate
- **Frontend predicate (shape + presence only):** an option is *offerable* iff it is a
  `warehouses` document with a non-blank string `id`. The frontend asserts **nothing**
  about activity.
- **Authoritative predicate (backend):** the option is *eligible* iff the trusted
  command validates it as an **active governed Location**. Ineligible ⇒ sanitized
  rejection ⇒ refresh (§3.9). The frontend treats backend acceptance as the only
  eligibility truth.

### 3.3 Bounded client read shape
- Reuse the `fetchWarehouseOptions` pattern: one-shot `getDocs(warehouses)` →
  `{ value: id, label }`. No realtime subscription, no per-doc fan-out, no aggregate.
- Read is `enabled`-gated: fetched only when the Receiving actor is capability-holding
  **and** the modal is open (never in the fail-closed idle posture).

### 3.4 Display-label fallback
- `label = name` when `name` is a non-blank string; else `label = id`. Never a blank
  or placeholder that hides which warehouse is selected.

### 3.5 Deterministic sort
- Sort by `label` (`localeCompare`), tie-broken by `id` — stable, locale-deterministic
  (mirrors `fetchWarehouseOptions`' existing sort).

### 3.6 Malformed-record handling
- A doc with a missing/blank/non-string `id` is **dropped** from the options
  (fail-closed per record); it is never rendered as a selectable option and never
  substituted with a guess.

### 3.7 Duplicate-ID handling
- Firestore doc ids are unique, but the projection dedupes defensively by `value`,
  keeping the first occurrence; a collision is dropped, not merged.

### 3.8 accessVersion & stale-read behavior
- On an `accessVersion` change, capability is re-resolved before the options are
  usable (a receive begun under a now-stale capability is not submitted — cutover
  spec §9).
- The options list is a **point-in-time bounded read**, never cached across sessions
  or users. Staleness between read and submit is expected and is resolved by backend
  revalidation (§3.9), not by client polling.

### 3.9 Backend revalidation requirement (MANDATORY)
- The trusted command **must** re-validate `receivingLocation` is an active governed
  Location on every receipt; the client selection is advisory. A stale/inactive/
  non-existent selection yields a **sanitized** rejection that drives the cutover
  spec's Conflict/sanitized-error state + refresh — **never** a ledgerless write.

### 3.10 Rules & index consequences (Inventory-owned; disclosed, not changed here)
- **Read authorization gap (must be resolved before wiring):** `warehouses` read is
  `isAdminOrDispatcher() || isAssignedToWarehouse(id)`. A `PARTS_ASSOCIATE`
  receive-actor (technician + operational role, assignee-gated) satisfies **neither**
  arm and **cannot currently read the warehouse pick-list**. This is an
  **Inventory-owned decision**, one of:
  - (i) first slice restricts location-selection to admin/dispatcher receivers; or
  - (ii) Inventory grants a narrow warehouse-read arm tied to the receive capability;
  - (iii) options are served through a backend read the actor is permitted.
  This document **does not** change `firestore.rules`.
- **Index:** none. A bounded full-collection equality read needs no composite index.

### 3.11 Frontend adapter / hook contract (Customer-owned, future)
- `src/services/receivingLocationOptions.js` — thin bounded read
  (`fetchReceivingLocationOptions()`), `WAREHOUSE`-only, returns
  `{ value, label, type: "WAREHOUSE" }[]`, sorted/deduped/label-fallback per §3.4–3.7.
  Firebase lives here, not in the presentational select.
- `src/hooks/useReceivingLocationOptions.js` — mirrors `useWarehouseOptions`
  (`enabled` gate, `{ options, loading, error }`), injectable loader for tests, no
  active-state claim.
- These are **future Customer PRs (LF-phases §7)**; **not created by this document.**

---

## 4. Behavior when no eligible location exists

- If the bounded read returns zero offerable warehouses (or the actor cannot read
  them, §3.10), the Receiving location field offers **nothing** and Receiving is
  **unavailable** — fail closed, consistent with the merged cutover spec (§5). The
  `warehouses` list is **never** treated as proof of active locations, and the UI
  never defaults to an unproven option.

---

## 5. Test matrix (frontend only; Rules tests are Inventory-owned)

**Unit (node, injected loader):** projection maps id→value / name→label; label
fallback to id; deterministic sort + id tiebreak; malformed record dropped; duplicate
value deduped; `WAREHOUSE`-only type stamped.

**Component (RTL):** `enabled=false` ⇒ no read, no options; empty result ⇒ Receiving
unavailable (fail closed); loader error ⇒ error state, no options; **no option is
ever rendered as "active"**; accessVersion change re-resolves capability.

**Rules (Inventory-owned emulator, referenced not written here):** admin/dispatcher
read allow; `PARTS_ASSOCIATE` read outcome per the §3.10 decision; deny for
unauthorized personas.

---

## 6. Owner decision required

Elect exactly one, with repository evidence recorded above:

- **C (recommended)** — WAREHOUSE-only adapter, backend-authoritative validation,
  no active-state claim. Proceed to §7 LF-phases.
- **D (conservative)** — if the frontend must never *offer* an option whose activity
  it cannot prove, HALT the Receiving location field (Receiving stays unavailable)
  until Inventory ships Option **B**. This is a one-line policy flip of C's "offer"
  step; nothing else in the cutover spec changes (it already fails closed).

**Unresolved gates (regardless of C/D):**
1. The **`warehouses` read-authorization gap** for `PARTS_ASSOCIATE` receivers
   (Inventory — §3.10).
2. The **merged Phase-B/E command contract** (callable name/payload/errors/response)
   (Inventory — cutover spec §18).
3. Whether a governed **`inventory_locations` active authority (Option B)** is
   ultimately required (Inventory persistence) — recommended once eligibility must be
   shown pre-submit or multiple putaway types are supported.

---

## 7. Phased implementation & gates (docs-first; runtime BLOCKED)

| Phase | Scope | Owner | Depends on | Gate |
|---|---|---|---|---|
| **LF0 (this)** | Authority reconciliation + decision | Customer | — | Spec (docs) |
| **LF1** | inert `services/receivingLocationOptions.js` + `hooks/useReceivingLocationOptions.js` + tests, **unwired** | Customer | Owner elects C; §3.10 read decision | repo-only DRAFT → Codex → Owner merge |
| **LF2** | wire options into the Receiving modal behind `readiness=false` (feeds the cutover spec's location field, §3) | Customer | LF1, cutover-spec F2 | repo-only DRAFT |
| **(Inventory)** | warehouse-read Rules decision (§3.10); active-destination validation in the command | Inventory | — | Inventory gates (Rules/Functions) |
| **LF3+** | activation rides the cutover spec's F3/F4 (client wiring → readiness flip) | Customer + Owner | Phase-B/E merged + verified, deployment-lock | activation gate → Owner auth |

LF1 is authored **only after** the Owner elects C and the §3.10 read path is decided;
until then this reconciliation stands and no adapter code exists.

---

## 8. Approval

**Gate:** Receiving Location Authority Reconciliation. **Status: DRAFT.** Opened as a
**DRAFT PR** for Codex review; authorizes no implementation and no production-data
action. Recommendation **C** with **D** as the conservative alternative; the persisted
client-visible active-location authority is **absent** and is disclosed as the gap
Option B would close. No `functions/**`, PR #533, Rules, index, runtime-frontend,
capability, callable, deployment, Hosting, production, or Truck change. **STOP for
Codex review.**
