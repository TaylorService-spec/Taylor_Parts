# Field / Technician Application Experience — Platform Requirement & Repository Assessment

**Status:** REQUIREMENT RECORDED · ASSESSMENT COMPLETE · NO IMPLEMENTATION PROGRAM LAUNCHED
**Owner directive:** 2026-08-07 — "Field / Technician Application Experience including Notes + Picklists"
**Assessed at:** `cc0f039` (Gate 2 branch, based on main `3b66aa2`)

---

## 1. The requirement

One governed platform, two experiences over the **same** domain, workflow, permission and
audit authority:

```
ENTERPRISE OPERATIONS OS
├── Operations / Management Experience   — desktop-first responsive
└── Field / Technician Experience        — phone · tablet · laptop · scanning/capture
```

Field Operations is an **optional platform module**. Technician concepts must never become
dependencies of unrelated modules (a customer may run Sales + Finance with no Field at all).

Non-negotiables carried from the directive:

- No second business system, and no second technician-only job state machine.
- Scanning resolves **identity**; governed workflow decides what may happen next.
- Picklist values come from a governed configuration authority, never scattered literal arrays.
- The domain model declares the **input-type contract** (single/multi/boolean/ordered/text/
  numeric/date-time); the UI renders that contract rather than implying storage from a control.
- Completion requirements are governed by workflow/configuration authority. The client
  explains *why* completion is blocked; it never invents the requirement.
- Device type is **not** authority. No broad "mobile user" permission.
- AI advises; it never overrides workflow authority. Core field workflows work without it.
- Platform defaults + customer configuration + business overrides — preserve the seam, do not
  build the full configuration engine prematurely.

---

## 2. The finding that reframes everything

**The repository contains two parallel job models, and the surface named "Field Mode" is on
the ungoverned one.**

| | `fieldops_wos` — Work Order Engine | `fieldops_jobs` — legacy jobs |
|---|---|---|
| States | 11 (`CREATED`…`CLOSED`/`CANCELLED`) | 4 (`open`/`assigned`/`in_progress`/`complete`) |
| Field lifecycle | `Accept → Travel → Arrive → WorkStart → Complete → Close` | none |
| Write path | Cloud Functions only; Rules **deny** all direct client writes | direct client writes via `collectionStore` |
| Audit | server timestamps, append-only `executionLog` | none |
| Technician UI | `TechnicianDashboard` (desktop-style, Service ▸ Technician Workspace) | **`FieldMode`** + `PartsScanner` (the mobile surface) |
| Production data | empty (INV-1 Phase 0, closed) | the collection field work actually uses |
| Sandbox scenario | not seeded | `SBX-SCN-001` seeds `fieldops_jobs` |

The governed engine already implements almost exactly the lifecycle the directive asks for —
and the mobile experience does not use it. `FieldMode` tracks travel stage in React local
state (`travelStageByJob`), and `PartsScanner`'s part movements write an in-memory demo
context (`demo/InventoryContext.jsx`) that resets on reload, against a demo parts array rather
than the governed Part Master.

**Consequence for sequencing:** converging Field onto the governed Work Order Engine is a
prerequisite for the rest of this requirement, not a parallel workstream. Notes, picklists,
completion gates, offline queueing and audit all attach to the job model; building them on
`fieldops_jobs` would create precisely the duplicate authority the directive forbids.

---

## 3. Requirement classification

### Workflow & job experience

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 4 | Governed field lifecycle | **EXISTS** | `functions/src/transitionEngine.ts` — `Accept/Travel/Arrive/WorkStart/Complete/Close`, action-not-status vocabulary, terminal statuses |
| 4 | Field UI uses that lifecycle | **PARTIAL** | `TechnicianDashboard` does; `FieldMode` does **not** |
| 4 | No second state machine | **AT RISK** | legacy 4-state model in active field use; `domain/workOrderWorkflow.js` is a hand-maintained mirror of `transitionEngine.ts` (documented, but a divergence risk) |
| 3 | Technician home ("what do I need to do now?") | **PARTIAL** | `FieldMode` lists assigned jobs; no My Day / next-action / exceptions / dispatch-change concepts |
| 15 | Governed completion gates | **PARTIAL** | `completeAssignedJob.ts` enforces preconditions and fails closed, but requirements are code-fixed, not configuration-driven; no checklist/readings/acknowledgment concept |

### Notes

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 7 | Governed note write path | **EXISTS** | `updateWorkOrderExecutionData.ts` — technician-only, ownership-checked, transactional, append-only `arrayUnion`, server timestamp, `byTechnicianId` |
| 7 | Author identity, not raw UID | **EXISTS** | stores `technicianId`; `domain/actorDisplayName.js` + `useEmployeeDirectory` provide governed display-name resolution |
| 7 | Multi-device note entry | **PARTIAL** | `ExecutionCapture.jsx` textarea exists on the desktop technician surface only; `FieldMode` has no note entry at all |
| 8 | Note **types/categories** | **MISSING** | one undifferentiated `note` string |
| 7 | Relationship to equipment / workflow step | **MISSING** | note relates to Work Order only |
| 18 | Edit history / append-only policy | **PARTIAL** | append-only by construction (no edit path at all) — a policy decision, not yet a governed choice |
| 9 | Quick entry, autosave, draft | **MISSING** | no draft, no autosave, no sync state |
| 17 | Draft preservation / idempotent submission | **MISSING** | notes are lost if the network drops mid-submit |

### Picklists & structured selections

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 10 | Governed picklist authority | **MISSING** | no picklist/option-set/configuration source anywhere in `functions/src` or `src` |
| 10 | No scattered hard-coded arrays | **VIOLATED TODAY** | e.g. `PartsScanner.jsx`'s literal `ACTIONS` array; status/filter literals across modules |
| 12 | Input-type contract in the domain model | **MISSING** | no field-type declaration layer |
| 13 | Dependent / conditional picklists | **MISSING** | — |
| 11 | Device-adaptive selection controls | **MISSING** | native `<select>` used in field surfaces — explicitly called out as hard to operate in the field |
| 14 | Selections rendered at the workflow step | **MISSING** | — |
| 21 | Platform default → customer config → business override | **DESIGN REQUIRED** | seam does not exist; must be designed before any picklist is hard-coded |

### Scanning & capture

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 5 | Scanning exists | **PARTIAL** | `PartsScanner.jsx` — `BarcodeDetector` API, `qr_code` format only, camera + manual entry |
| 5 | Resolves to a **governed** entity | **MISSING** | resolves against the demo parts array, not the governed Part Master |
| 5 | Multi-entity scanning (equipment/truck/location/WO/serialized) | **MISSING** | parts only |
| 5 | `SCAN → RESOLVE → VERIFY CONTEXT → AUTHORIZED ACTIONS` | **MISSING** | actions are a fixed literal list, not authority-derived |
| 6 | Shared entity-resolution boundary (camera / HID / manual / future RFID) | **MISSING** | resolution logic is inline in the component |
| 6 | Hardware HID scanner support | **MISSING** | no keyboard-wedge input path |
| 4 | Photo / evidence capture | **MISSING** | **no Firebase Storage, no file input, no attachment model anywhere in the repo** |
| 4 | Customer signature | **MISSING** | — |

### Platform behaviour

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 19 | Authority-driven field UX | **EXISTS** | `operationalRoleAccess` (Issue #100), capability preview, `ROLE_NAV_ACCESS`; technician job reads are scope-interlocked (F-RULES-1) |
| 19 | Device type is not authority | **HOLDS** | no device-based gating found |
| 20 | Field persona variants | **PARTIAL** | `OPERATIONAL_ROLE` exists (Parts Manager / Warehouse Manager / Parts Associate); no field-supervisor/installer/inspector |
| 16 | Offline / connectivity design | **MISSING** | no Firestore persistence configured — which is *correct* per the directive's "do not just switch it on", but no queue/retry design exists either |
| 16 | Idempotency for field operations | **PARTIAL** | idempotency keys exist in access/inventory command services; **not** on field job/note writes |
| 18 | Audit / history | **PARTIAL** | audit infrastructure and append-only execution log exist; no per-selection audit, no device/session capture |
| 2 | Responsive/adaptive across phone/tablet/laptop | **PARTIAL** | Gate 2 shell is responsive to 390px; field *content* is not device-adapted |
| 23 | Sandbox field scenarios | **PARTIAL** | `SBX-SCN-001` covers job → shortage → parts-room → receipt, but on `fieldops_jobs`; none of the 16 negative cases |
| 24 | Field load model | **MISSING** | — |
| 22 | Next-best-action | **PARTIAL** | `domain/technicianRecommendationEngine.ts` exists; not wired to field workflow, advisory-only posture not yet formalised |

### Supporting domains (shared authority — reuse, do not duplicate)

| Domain | Status |
|---|---|
| Truck inventory | **EXISTS** — `truckRegistry` callables, `truckInventoryView`, `truckManagement`; write UI gated (PR #518) |
| Equipment / serialized assets | **EXISTS** — register, detail, timeline, serialized-asset identity, installation |
| Parts / Part Master | **EXISTS** — governed catalog + `partMasterCommands` |
| Warehouse inventory | **EXISTS** — governed warehouses, receiving (activation gated) |
| Customers / locations | **EXISTS** |
| Permissions / capabilities | **EXISTS** |
| Attachments / evidence | **MISSING — no storage layer at all** |

---

## 4. Duplicate / parallel models to avoid

1. **`fieldops_jobs` vs `fieldops_wos`** — the central one. Must converge on the governed
   engine; do not extend the legacy model.
2. **`domain/workOrderWorkflow.js` mirroring `transitionEngine.ts`** — a hand-synced copy of
   the transition table and permission matrix. Acceptable as defence-in-depth, but it must be
   contract-tested against the server table, not maintained by comment.
3. **`demo/InventoryContext.jsx`** — an in-memory parts/truck/warehouse model shadowing the
   governed inventory. Field must not grow further on it.
4. **`PartsScanner`'s literal `ACTIONS`** — the seed of a scanner-owned action vocabulary.
   Actions must derive from authority + entity type.
5. **Any new "field note" collection** — `executionLog` is the governed note authority; extend
   it (type, relations) rather than introducing a parallel notes store.

---

## 5. Recommended architecture

Four seams, in dependency order. Each is independently reviewable.

**S1 — Field Job Authority.** Field surfaces read and transition `fieldops_wos` through
`transitionWorkOrder`. Retire `updateJobStatus`/`fieldops_jobs` from the field path. Contract-test
the client mirror against `transitionEngine.ts`.

**S2 — Entity Resolution Boundary.** One pure module: `resolveScannedIdentity(rawValue) →
{ entityType, entityId, confidence } | Unresolved`. Camera, HID keyboard-wedge, manual search and
future RFID all feed it. It resolves identity **only** — never actions. Authorized actions are then
derived from `(entityType, entity state, caller capabilities, current job context)`.

**S3 — Structured Field Authority.** A governed definition layer declaring, per field: `inputType`
(single/multi/boolean/ordered/text/numeric/date-time), option source, dependency rules, and
requirement rules bound to workflow transitions. Server-validated on write; the client renders the
contract and explains blocked completion using the server's reason. Platform defaults with a
customer-override seam — the seam only, not the engine.

**S4 — Field Capture & Sync.** Attachment/evidence model (Storage + governed metadata), note
drafts with explicit unsaved/syncing/synced state, idempotency keys on field writes, and an
explicit per-operation classification of *queueable offline* vs *requires authoritative online
validation*.

---

## 6. Proposed gates

| Gate | Scope | Type |
|---|---|---|
| **F0** | Field Job Authority convergence (S1) — no new UX | repo-only |
| **F1** | Field shell + Technician Home + Current Job, phone/tablet/laptop, on governed data | repo-only |
| **F2** | Entity Resolution Boundary (S2) + governed part/equipment scan resolution | repo-only |
| **F3** | Structured Field Authority (S3) + notes with types/relations at workflow steps | repo-only; **schema/config authority = Tier 2** |
| **F4** | Capture & Sync (S4) — attachments, drafts, idempotency, offline classification | **Storage enablement = protected/authorization required** |
| **F5** | Sandbox field scenarios incl. the 16 negative cases; field load model | repo-only + sandbox |
| **F6** | Next-best-action, advisory-only | repo-only |

**Protected / authorization required:** Firebase Storage enablement and its Rules (F4);
any Firestore Rules change; picklist configuration authority schema (F3); production activation
of receiving-adjacent field actions.

---

## 7. Gate 3 impact

Gate 3's proving set becomes five surfaces, and must distinguish **shared platform primitives**
from **desktop management patterns** from **field patterns**:

1. Dashboard / Operations
2. Inventory / Parts
3. Service / Work Orders
4. Purchasing / Purchase Orders
5. **Field Mode / Current Job** — job summary, status/next action, customer/location, equipment,
   scanning, parts/truck inventory, technician notes, governed picklist selection,
   checklist/required fields, completion action — rendered and tested at 390px / tablet / laptop.

Desktop registry and card layouts must not be forced onto the phone because they were built first.

**Sequencing note:** the Field proving surface can only be honest once **F0** lands. Until Field
runs on the governed Work Order Engine, a Gate 3 field surface would be proving patterns against a
model the platform intends to retire.
