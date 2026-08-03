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
`receivingLocation { type, locationId }` and its steps *describe* it as a "validated
active `InventoryLocation` reference" (§2) / "validate `receivingLocation` is an
active governed Location" (§7) with an "active-destination-location validation"
emulator (§12). **But Phase B provides only an _injected_ `resolveLocationActive`
transaction SEAM — an enforcement hook — not a persisted authority and not a governed
predicate that defines what "active" means.** A command is the *enforcement point*;
it cannot authoritatively answer "active" until a concrete source + predicate are
governed and merged. (PR #533 is Phase B's `receiveInventoryStock` command; its
callable name/payload/errors are **not merged** and are **not pinned here**.)

**Key finding (corrected):** **there is currently NO active-location authority —
neither client nor backend.** No collection exposes an active/eligibility field, and
the backend `resolveLocationActive` is an **unresolved injected seam, not an
authority**. Under the present schema a production resolver could only: (a) treat
warehouse *existence* as eligibility — contradicting this document's own rejection of
id/existence as proof; (b) invent an unstored active state; (c) always reject; or
(d) depend on a not-yet-specified/merged authority. **No safe eligibility answer
exists today.**

---

## 2. Required decision — present decision: **Option D (HALT / fail closed)**

> **D. HALT — no governed authority currently exists to produce eligible options.**
> Option **C** is not implementable as originally described (there is no active
> authority for its resolver to consult, §1) and is redefined as a **conditional
> future option**, unlocked only after an **Inventory-owned gate** ratifies and merges
> one concrete authoritative predicate (C1/C2/C3 below).

**Why D now (evidence-based):** a command is an *enforcement point*, not an
authority; the injected `resolveLocationActive` seam has **no persisted source or
governed predicate** to answer "active" (§1). Offering `warehouses` id/label options
and calling backend acceptance "eligibility" would, under the present schema, reduce
to *existence-is-eligibility* — which this document explicitly rejects as proof.
Until an authority is pinned, **the frontend can safely offer nothing**.

**Until an Inventory-owned authority gate merges (binding):**

- Receiving offers **no selectable destination**.
- **LF1/LF2 runtime work remains blocked.**
- The current `warehouses` list may be **displayed nowhere as a Receiving option**.
- `resolveLocationActive` remains an **unresolved injected seam, not an authority**.
- **No callable may be activated** for production Receiving.

**Option C — conditional future, unlocked by ONE Inventory-ratified predicate:**

- **C1 — Existence-is-eligible policy.** For first-slice `WAREHOUSE` receiving, the
  existence of a well-formed `warehouses/{id}` document is *explicitly defined* as
  eligible; **no "active" claim is made**; the backend resolver performs a
  transactional existence/schema check. This is a **governance change to the current
  "active location" wording** and must be reviewed against the Receiving
  specification (`enterprise-inventory-receiving-phase2.md`) before adoption.
- **C2 — Persisted eligibility field.** `warehouses` gains an explicit governed
  `status`/`active` field — pin allowed values, default/migration treatment, write
  owner, Rules, backend resolver, and client-display semantics.
- **C3 — Dedicated `inventory_locations` authority.** Introduce `inventory_locations`
  with identity, type, lifecycle/status, warehouse linkage, trusted writer, Rules,
  indexes, and migration.

All three are **Inventory-owned** (persistence writer / Rules / catalog / index /
migration). This Customer document neither builds nor pins them; it records the
requirement and the frontend contract that becomes valid **after** one is merged (§3).

- **A (reuse `warehouses` as the governed active authority) — REJECTED.** No
  eligibility/active field to pin; would require inventing a field or asserting
  id/existence ⇒ eligibility (a STOP condition).

**First-slice destination type (when C unlocks): `WAREHOUSE` only.** `BIN` adds
sub-warehouse granularity; `MOBILE` is the excluded Truck surface (putaway-to-truck
out of scope); `VENDOR`/`CUSTOMER`/`VIRTUAL` have no persisted backing and are not
physical receipt destinations.

---

## 3. Frontend contract — valid ONLY after an Inventory authority (C1/C2/C3) merges

**This section does not apply to the present state (§2 = D/HALT).** It defines the
frontend location-options contract that becomes buildable **only after** Inventory
ratifies and merges one of C1/C2/C3 **and** its exact client-read contract, **and**
the read-authorization gap (§3.10) is resolved. Until then, none of it is implemented
and Receiving offers no destination. Where it says "eligible", that means "accepted by
the *then-governed* authority's predicate" — never mere existence, unless C1 is the
ratified predicate. **The option source collection itself is conditional on which
authority I-LA ratifies (§3.1)** — `warehouses` under C1/C2, `inventory_locations`
(filtered `type == WAREHOUSE`) under C3 — so nothing below hard-codes `warehouses`.

### 3.1 Source & type — **conditional on which authority I-LA ratifies**

The **destination type is `WAREHOUSE` only** for the first slice **regardless of
source**. The **option source, identity, and read-authorization target differ by the
ratified authority** and are pinned by the I-LA gate that selects it:

| Ratified authority | Option source collection | Option identity (`locationId`) | Eligibility predicate | I-LR read-auth target |
|---|---|---|---|---|
| **C1** existence-is-eligible | `warehouses` | `warehouses/{id}` | well-formed `warehouses/{id}` exists (transactional existence/schema check) | `warehouses` |
| **C2** persisted field | `warehouses` | `warehouses/{id}` | governed `warehouses.status`/`active` value | `warehouses` |
| **C3** dedicated authority | **`inventory_locations`**, filtered `type == WAREHOUSE` | Inventory Location doc identity / `locationId` | C3 governed lifecycle/status | **`inventory_locations`** (NOT automatically `warehouses`) |

Under **C3** the warehouse link may supply only a **display label**; `warehouses` is
**no longer the eligibility source**, and read-authorization applies to
`inventory_locations`, not `warehouses`. The exact C3 warehouse-linkage/label behavior
and read contract are pinned by the C3 I-LA gate, not here.

### 3.2 Eligible / ineligible predicate
- **Frontend predicate (shape + presence only):** an option is *offerable* iff it is a
  document from **the I-LA-selected source** (§3.1) with a non-blank string identity.
  The frontend asserts **nothing** about activity.
- **Authoritative predicate (backend):** the option is *eligible* iff the
  **then-governed authority's predicate** (the ratified C1/C2/C3, §3.1) accepts it.
  **This predicate does not exist today** (§1/§2); the frontend has no authoritative
  eligibility truth to defer to until one is merged. Once merged, ineligible ⇒
  sanitized rejection ⇒ refresh (§3.9).

### 3.3 Bounded client read shape
- One-shot bounded read of **the I-LA-selected source** (§3.1) — `getDocs(warehouses)`
  under C1/C2, or `getDocs(inventory_locations)` filtered `type == WAREHOUSE` under C3
  — mapped to `{ value, label }`. No realtime subscription, no per-doc fan-out, no
  aggregate. The `fetchWarehouseOptions` shape is the *pattern* to reuse; the exact
  collection and query are fixed by the ratified authority.
- Read is `enabled`-gated: fetched only when the Receiving actor is capability-holding
  **and** the modal is open (never in the fail-closed idle posture).

### 3.4 Display-label fallback
- `label = name` when a non-blank string is available; else `label = <identity>`.
  Never a blank/placeholder that hides which destination is selected. Under **C3**,
  the label may be sourced from the linked warehouse per the C3 gate's pinned linkage
  behavior (§3.1).

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
- **I-LR targets the collection I-LA selects (§3.1), not `warehouses` unconditionally.**
  - **Under C1/C2** (source = `warehouses`): read is
    `isAdminOrDispatcher() || isAssignedToWarehouse(id)`. A `PARTS_ASSOCIATE`
    receive-actor satisfies **neither** arm and **cannot currently read the warehouse
    pick-list**.
  - **Under C3** (source = `inventory_locations`): there is **no** current client read
    path (the collection does not exist); its read authorization is defined by the C3
    gate. **`warehouses` authorization does NOT solve C3 option visibility.**
- **I-LR is an Inventory-owned decision** for the selected source, one of:
  (i) restrict location-selection to admin/dispatcher receivers; (ii) grant a narrow
  read arm on the selected collection tied to the receive capability; or (iii) serve
  options through a backend read the actor is permitted. This document changes no
  `firestore.rules`.
- **Index:** a bounded full-collection equality read needs no composite index under
  C1/C2; a C3 `type == WAREHOUSE` filter's index is pinned by the C3 gate.

### 3.11 Frontend adapter / hook contract (Customer-owned, future)
- `src/services/receivingLocationOptions.js` — thin bounded read
  (`fetchReceivingLocationOptions()`) over **the I-LA-selected source** (§3.1),
  `WAREHOUSE`-only, returns `{ value, label, type: "WAREHOUSE" }[]`,
  sorted/deduped/label-fallback per §3.4–3.7. Firebase lives here, not in the
  presentational select. **The exact collection/query is fixed by the ratified
  authority — the adapter does not hard-code `warehouses`.**
- `src/hooks/useReceivingLocationOptions.js` — mirrors `useWarehouseOptions`
  (`enabled` gate, `{ options, loading, error }`), injectable loader for tests, no
  active-state claim.
- These are **future Customer PRs (LF-phases §7), authored only after the chosen
  authority AND its exact client-read contract merge**; **not created by this
  document.**

---

## 4. Behavior when no eligible location exists

- **This is the present state.** With no ratified eligibility authority (§2 = D),
  there are **zero eligible options today** and Receiving is **unavailable now** —
  fail closed, consistent with the merged cutover spec (§5).
- The same fail-closed behavior also applies post-authority if a read returns zero
  offerable records or the actor cannot read them (§3.10). The `warehouses` list is
  **never** treated as proof of active locations, and the UI never defaults to an
  unproven option.

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

## 6. Decision recorded & gates required

**Present decision: D — HALT / fail closed.** Receiving offers no selectable
destination and LF1/LF2 runtime stays blocked until an **Inventory-owned gate**
ratifies and merges **one** authoritative eligibility predicate:

- **C1** — existence-is-eligible policy (a governance change to the current "active
  location" wording; must be reviewed against `enterprise-inventory-receiving-phase2.md`); or
- **C2** — a persisted governed `warehouses.status`/`active` field; or
- **C3** — a dedicated `inventory_locations` authority.

**Two independent Inventory gates must BOTH clear before any client wiring:**

1. **I-LA — eligibility authority/predicate** (C1/C2/C3), §2.
2. **I-LR — read-authorization for the option list.** Even once eligibility is solved,
   a full `getDocs(warehouses)` is **unavailable** to the `PARTS_ASSOCIATE` receiver
   persona (§3.10). Inventory must separately choose: a restricted admin/dispatcher
   first slice · a narrowly governed client read · or trusted backend-served options.
   **Solving eligibility does NOT automatically solve option visibility** — the two
   are independent.

**Also unresolved:** the **merged Phase-B/E command contract** (callable
name/payload/errors/response) — Inventory, cutover spec §18.

---

## 7. Phased implementation & gates (docs-first; runtime BLOCKED)

| Phase | Scope | Owner | Depends on | Gate |
|---|---|---|---|---|
| **LF0 (this)** | authority reconciliation; records the current **D / HALT** | Customer | — | Spec (docs) |
| **I-LA** | eligibility **authority/predicate** decision + implementation (C1 policy / C2 field / C3 `inventory_locations`); **pins the option source collection + exact client-read contract** (§3.1) | **Inventory** | — | Inventory gate (Rules/Functions/persistence/migration) |
| **I-LR** | **read-authorization** decision **for the collection I-LA selected** (§3.10) — `warehouses` under C1/C2, `inventory_locations` under C3 | **Inventory** | I-LA | Inventory gate (Rules) |
| **LF1** | inert `services/receivingLocationOptions.js` + `hooks/useReceivingLocationOptions.js` + tests, **unwired — only after I-LA (incl. its client-read contract) + I-LR merge** | Customer | **I-LA, I-LR** | repo-only DRAFT → Codex → Owner merge |
| **LF2** | isolated UI wiring under `readiness=false` (feeds the cutover spec's location field, §3) | Customer | LF1, cutover F2 | repo-only DRAFT |
| **F3+** | cutover **only after the callable AND the authority are verified** (rides cutover F3/F4) | Customer + Owner | Phase-B/E merged + verified, I-LA verified, deployment-lock | activation gate → Owner auth |

**LF1 is blocked until BOTH I-LA and I-LR merge.** Until then this reconciliation
stands as a HALT record, no adapter code exists, and Receiving offers no destination.

---

## 8. Approval

**Gate:** Receiving Location Authority Reconciliation. **Status: DRAFT.** Opened as a
**DRAFT PR** for Codex review; authorizes no implementation and no production-data
action. **Present decision: D — HALT / fail closed.** No governed active-location
authority exists (client or backend); the injected `resolveLocationActive` seam is
**not** one. Option **C** is a **conditional future**, unlocked only after an
Inventory-owned gate ratifies and merges one predicate (**C1/C2/C3**, §2) **and** the
read-authorization gate (**I-LR**, §3.10) clears. Until then Receiving offers no
selectable destination, LF1/LF2 stay blocked, the `warehouses` list is displayed
nowhere as a Receiving option, and no callable is activated. No `functions/**`,
PR #533, Rules, index, runtime-frontend, capability, callable, deployment, Hosting,
production, or Truck change. **STOP for Codex review.**
