---
artifact_type: specification
gate: Frontend Cutover Specification
status: Draft
date: 2026-08-03
owner: Claude Code
session: CUSTOMER
depends_on:
  - docs/specifications/enterprise-inventory-receiving-phase2.md
  - docs/specifications/enterprise-inventory-architecture.md
related_adrs: [ADR-003, ADR-005]
implements: []
supersedes: []
superseded_by: []
related_pr: null
related_issue: null
target_release: null
---

# Inventory Receiving — Frontend Cutover Specification (Phase F)

**Status: DRAFT — docs-only. Merging this document authorizes NO implementation.**
It specifies the *future* frontend cutover (Phase F) from the legacy status-only
`receiveReorderRequest()` client writer to the trusted Receiving command defined by
the Inventory session's backend slice. It creates no runtime code, Firestore Rule,
index, Function, callable export, capability grant, Hosting release, migration, or
production-data change. **This is a read-only reconciliation plus a written plan.**

**Session boundary.** Authored by the **CUSTOMER** session. The **INVENTORY**
session owns Receiving Phase B (the trusted command) under `functions/**` and its
own backend specification `docs/specifications/enterprise-inventory-receiving-phase2.md`.
This document **does not** touch, duplicate, or re-decide anything under
`functions/**`, `firestore.rules`, indexes, the capability/AuditAction catalogs,
`field-ops-app-vite` runtime code/tests, the `receiveReorderRequest()` implementation,
`App.jsx`, `package.json`, callable exports, deployment files, Hosting, production
data, or any Truck record. It is the **frontend counterpart** to that backend spec's
Phase F row (§11/§13), specified here so the UI cutover has a reviewed contract of
its own.

**Backend-contract boundary (binding).** Phase B is not yet merged. This document
**does not invent or pin** the callable name, request payload, error codes, or
response shape. Where it needs the command, it references **"the trusted Receiving
command (Phase-B internal command / Phase-E callable export), per
`enterprise-inventory-receiving-phase2.md`"** and specifies only the **frontend data
requirements** (what the UI must collect, display, and surface). No speculative
client adapter is implemented; F1 (below) is an **inert, unwired** adapter shell
that is written only after the Phase-B/E contract is merged.

Verified against `origin/main` @ `7c804cb` (== authoritative head at issue). Path
convention: `firestore.rules`, `functions/…`, `docs/…` repo-root-relative; `src/…`
relative to `field-ops-app-vite/`.

---

## 0. Reconciliation — current Receiving UI/client inventory (READ-ONLY, VERIFIED)

### 0.1 Legacy writer and every caller/screen

| # | Path | Role |
|---|---|---|
| L1 | `src/domain/inventoryReorderRequests.js:263-269` `receiveReorderRequest(requestId)` | **The legacy status-only writer.** Client-direct `updateDoc` writing `{ status: RECEIVED, receivedAt: Date.now(), receivedBy: auth.currentUser.uid }` to `reorder_requests/{id}`. No ledger, no `receiving_orders`, no location. |
| L2 | `src/modules/inventory/PartDetail.jsx:25` (import), `:808` (call) | `ReorderRequestMarkReceived` component (`:796`): assignee-gated "Mark Received" card + button → `await receiveReorderRequest(request.id)` → `onReceived()` refresh. Disclaimer at `:818` ("does not update stock yet"). |
| L3 | `src/modules/inventoryRole/PartsAssociateHome.jsx:10` (import), `:272` (call) | `OrderedCard` component `handleReceive()` → `await receiveReorderRequest(request.id)`. Second production entry point for the same write. |

**These are the only two production UI entry points (L2, L3) and the only client
writer (L1) capable of setting `reorder_requests.status = RECEIVED`.**

### 0.2 Every direct client write capable of setting `status = RECEIVED`

- **Exactly one:** `receiveReorderRequest()` (L1). Confirmed by exhausting every
  `RECEIVED` token in `field-ops-app-vite/src`:
  - `domain/constants.js:183` — `REORDER_REQUEST_STATUS.RECEIVED` enum (terminal).
  - `analytics/operationsIntelligenceService.ts`, `domain/inventoryLedgerEvent.js`,
    `domain/inventoryTransferPairing.js`, `domain/transferLine.js`,
    `domain/serializedAssetIdentity.js` — reference `RECEIVED` on **other** objects
    (Purchase Order status, ledger event types, transfer-pairing states). **None**
    writes `reorder_requests.status`.
  - The `ORDERED → RECEIVED` transition is authorized in `firestore.rules`
    (assignee-only, inside the single shared `isAdminOrDispatcher() && (…)` gate on
    `reorder_requests`' `allow update`). No client path other than L1 exercises it.

### 0.3 Related UI surfaces (context, not all retired)

- **Reorder Request** — `PartDetail.jsx` cards: `ReorderRequestMarkReceived` (retire),
  `ReorderRequestReceived` (terminal read-only; keep), `ReorderRequestOrdered`,
  `ReorderRequestCancelled`.
- **Reorder Purchase Order** — `usePurchaseOrderForReorderRequest(request.id)` hook
  feeding `OrderedCard`; the PO is **read-only to the command** (backend §4) and its
  document is byte-identical before/after a receipt. The frontend reads it for
  display (ordered part, ordered quantity) only.
- **Parts Detail** — `modules/inventory/PartDetail.jsx` (admin/dispatcher inventory
  surface).
- **Parts Associate** — `modules/inventoryRole/PartsAssociateHome.jsx` (assignee
  queue: "Waiting"/"In Progress"/Ordered).

### 0.4 Role / capability visibility & accessVersion patterns (VERIFIED)

- Capability for the current action: **`reorder.request.markReceived`**
  (`access/permissionCatalog.ts:168`, `action: "markReceived"`;
  `access/compatibilityRoles.ts`; `access/parityFixtures.ts`). The *card itself*
  today gates only on **assignee identity** (`user.uid === request.assignedToUserId`),
  not on that capability.
- The trusted command's capability is **`inventory.stock.receive`** (backend §6) —
  a **different** capability, currently **inert/ungranted** (backend Phase C).
- `accessVersion` lives in the compact custom claims (`access/compactClaims.ts`) and
  is the revocation-latency signal (ADR-005 §2.3 hybrid enforcement).

### 0.5 Reusable seams (the cutover reuses these; it invents no new machinery)

| Concern | Reuse | Evidence |
|---|---|---|
| **Fail-closed write-readiness** | Compile-time constant + `resolveWriteReadiness(override)`; explicit `false` ⇒ zero callable attempts; flip constant + Hosting release to activate | `config/truckManagementReadiness.js` (Gate D→E1→E3 model) |
| **Trusted-command client (thin, injectable)** | Builds the exact payload, `httpsCallable`, `idempotencyKey`+`expectedVersion` supplied by caller; outcome mapping stays in a pure domain module; mirrors `adminPasswordResetClient.js`, `reportExecutionSeam.js` | `services/truckRegistryCommandClient.js` |
| **Idempotency key + sanitized/ambiguous/replay states** | `newIdempotencyKey(randomUuid)` (prefix+uuid, pattern-validated), `isValidIdempotencyKey`, `…StorageKey(uid,id)` sessionStorage scoping (one pending attempt survives refresh), `build…Request` (only allowed fields representable), `validate…Response` (malformed ⇒ `ambiguousOutcome`, never treated as success), response `idempotentReplay` boolean | `domain/completionFlow.js` (+ `services/completionService.js`) |
| **Location reference contract** | `validateLocationRef({ type, locationId })` fail-closed over the bounded `INVENTORY_LOCATION_TYPES` (`WAREHOUSE/BIN/MOBILE/VENDOR/CUSTOMER/VIRTUAL`) | `domain/inventoryLocation.js` |
| **Bounded pick-list read** | One-shot `getDocs` → `{ id, label }`, sorted; only fetched when authorized **and** write-ready; active/existence authoritatively re-checked server-side | `fetchWarehouseOptions()` in `services/truckRegistryCommandClient.js` |
| **Readiness-gated command modal** | Full modal with loading/blocked/validation/conflict/applied states + single-submit | `modules/inventory/truckManagement/ManageTruckDrawer.jsx`, `CreateTruckModal.jsx`; `shared/ui/ConfirmDialog.jsx` |
| **Service-boundary rule** | No page component calls `httpsCallable` directly; it goes through a `services/*` client | `services/workOrderService.ts` convention |

**Current Inventory Location / warehouse option sources:** `domain/inventoryLocation.js`
(type + reference contract) and the `warehouses` collection via `fetchWarehouseOptions()`.
The **active receiving location** selector consumes these; the trusted command
re-validates active/existence server-side (frontend never asserts custody).

**Current production rollback/readiness pattern:** the truck-registry model —
deploy+verify callables (Gate D), flip the single readiness constant (Gate E1),
serve via Hosting release (Gate E3) — plus backend §11's fail-closed rollback
(never restore a ledgerless writer). Phase F below is the Receiving instance of this
exact pattern.

---

## 1. Exact legacy paths to remove or disable (at F3/F4)

1. **L2** — remove the `receiveReorderRequest` call + button action from
   `ReorderRequestMarkReceived` (`PartDetail.jsx`); replace with the Receiving entry
   point (§2) that opens the Receiving modal.
2. **L3** — remove the `receiveReorderRequest` call from `OrderedCard.handleReceive`
   (`PartsAssociateHome.jsx`); replace with the same Receiving entry point.
3. **L1** — `receiveReorderRequest()` (`domain/inventoryReorderRequests.js`) is
   **retired as a receipt path**: after cutover it is no longer imported by any UI.
   Its physical removal from the domain module is an **INVENTORY-owned** change
   (that file is on the excluded list for this session); this spec only mandates that
   **no UI path imports or calls it** post-F4 and that it is **never re-wired** on
   rollback (§12).

**Acceptance for §1:** a repo-wide search for `receiveReorderRequest` returns **zero**
importers/callers under `src/modules/**` after F4.

---

## 2. Receiving UI entry points

- A single **"Receive"** action replaces both "Mark Received" affordances (L2, L3),
  rendered on the **Ordered** state of a Reorder Request:
  - `PartDetail.jsx` — in place of `ReorderRequestMarkReceived`'s button.
  - `PartsAssociateHome.jsx` — on the assignee `OrderedCard`.
- The action opens a **Receiving modal/drawer** (one shared component) — it never
  performs an inline write. Choosing the same component in both surfaces guarantees a
  single receipt contract (no second production receipt path — a named STOP guard).
- Visibility is capability + readiness driven (§6); the action is **absent**, not
  merely disabled, when the capability is not held.

---

## 3. Form fields

The modal collects the **minimum** to satisfy the backend's NONE-only,
single-line, source-bound receipt (backend §2/§5/§8). Frontend data requirements
only — wire shape deferred to the merged contract.

| Field | Kind | Rule |
|---|---|---|
| `reorderRequestId` | **immutable, hidden/read-only** | from the request in context; never user-editable |
| `purchaseOrderId` | **immutable, read-only** | resolved from `usePurchaseOrderForReorderRequest`; displayed, never edited |
| Ordered part | **read-only display** | part id + name from the linked PO/request |
| Ordered quantity | **read-only display** | the **exact ordered quantity**; the single received line equals it (backend §5 binds line-count = 1 and `receivedQuantity == orderedQuantity`; the frontend does not offer partial/over/under entry) |
| Receiving location | **selectable** | one **active** receiving location (`{ type, locationId }` via `validateLocationRef`; options from the location/warehouse source, §0.5); active/existence re-checked server-side |
| Received line | **exactly one, NONE-tracked** | the UI constructs exactly one line, tracking mode **NONE**; no SERIAL/LOT capture; the UI cannot represent >1 line |
| `idempotencyKey` | **client-generated, hidden** | minted once per distinct receive intent (`newIdempotencyKey`-style, prefix `recv-`), reused across retries of that intent, persisted in scoped sessionStorage for refresh recovery |

**Unrepresentable-by-construction:** the request builder accepts only these fields
(the `buildCompletionRequest` discipline) — quantity overrides, extra lines,
tracking modes, or caller identity are **not parameters**, so no caller can smuggle
them in. `receivedBy`/actor identity is **server-derived** from `request.auth.uid`,
never sent.

---

## 4. Read-only source fields (never user-editable)

`reorderRequestId`, `purchaseOrderId`, ordered part, **exact ordered quantity**,
requestor/assignee, and order timestamps are **display-only**. They are rendered from
the request/PO already loaded; the modal has no control that edits them. The only
user input is the **receiving location selection** and the **confirm** action.

---

## 5. Fail-closed readiness before backend deployment

- A dedicated **`RECEIVING_WRITE_READY`** seam (a new
  `config/receivingReadiness.js`, modeled exactly on
  `config/truckManagementReadiness.js`) is the **single** activation switch, with a
  `resolveReceivingWriteReadiness(override)` for tests/preview.
- **Default `false`** through F1–F3. While `false`: the Receiving entry point renders
  its **blocked** state (§7) and the client adapter makes **zero** callable attempts —
  no runtime probing of Functions.
- The constant flips to `true` **only at F4**, and only reaches production when a
  **Hosting release** serves the bundle. Legacy `receiveReorderRequest()` is **not**
  a fallback while readiness is `false` (that would reintroduce ledgerless receipt);
  the action is simply **unavailable**.

---

## 6. Capability-driven visibility & denied behavior

- Visibility is gated on the **`inventory.stock.receive`** capability (backend §6),
  **AND** `RECEIVING_WRITE_READY`, resolved through the existing
  `resolveEffectivePermission`/`useReportCapabilities`-style capability seam.
- **Not held ⇒ absent.** The Receive action is not rendered at all (no disabled
  teaser). Direct navigation/deep-link to a receive affordance renders nothing
  actionable (fail-closed).
- **Held but not write-ready ⇒ blocked** state (§7), never a live control.
- The client **never self-authorizes**: the trusted command re-enforces
  `inventory.stock.receive` server-side; client visibility is a convenience, not the
  security boundary (ADR-005).

---

## 7. Interaction states

The modal is a small state machine (reusing `completionFlow.js` semantics). Each
state has one canonical rendering:

| State | Trigger | Rendering / behavior |
|---|---|---|
| **Loading** | resolving PO/location options | spinner + disabled confirm; no callable yet |
| **Blocked** | `!RECEIVING_WRITE_READY` (or capability absent → action not shown) | explanatory copy ("Receiving is not yet available"); confirm disabled; zero callable attempts |
| **Validation** | location not selected / not an active `validateLocationRef` | inline field error; confirm disabled until resolved |
| **Submitting** | confirm pressed | confirm disabled + busy label; single in-flight request (§8) |
| **Conflict** | version/CAS or wrong-status outcome from the command (e.g. already received, stale `expectedVersion`) | non-destructive message ("This request changed — refresh to see the latest"); offers refresh; no retry with the same stale state |
| **Replayed** | response `idempotentReplay == true` | treated as **success** (same key, no duplicate); success rendering |
| **Applied** | fresh successful receipt | success rendering + reconciliation (§10) |
| **Ambiguous / sanitized error** | malformed/failed response (`validate…Response` ⇒ `ambiguousOutcome`), or a sanitized backend error code | **not** treated as success; user sees a **sanitized** message (no stack, no internal ids); the pending idempotency key is retained so a retry re-uses it (safe because the command is idempotent) |

All backend error copy is **sanitized** — the UI maps the merged contract's error
codes to human messages and **never** renders raw errors, internal ids, or ledger
internals.

---

## 8. Single-submit / no-double-click

- Confirm is disabled the instant it is pressed and while a request is in flight
  (`submitting` guard, as in every reuse seam).
- **One idempotency key per receive intent**, persisted in scoped sessionStorage
  (`receiving:{uid}:{reorderRequestId}`); a double-click, a refresh mid-submit, or a
  retry after an ambiguous outcome all **re-use the same key**, so the backend's
  idempotency (backend §8) collapses them to a single receipt (response
  `idempotentReplay == true` ⇒ Replayed/Applied, never a duplicate).
- A **new** key is minted only for a genuinely new receive intent (after a confirmed
  terminal outcome, the stored key is cleared).

---

## 9. accessVersion invalidation & stale-completion suppression

- On an `accessVersion` change (claims refresh), the modal **re-resolves capability**
  before allowing submit; a receive begun under a now-stale capability is **not**
  submitted (fail-closed).
- **Stale-completion suppression:** if a receive's result returns after the request
  context has changed (component unmounted, request already terminal, or user/session
  changed), the outcome is **dropped** (no state write against a stale target) — the
  `completionFlow.js` ambiguous/stale discipline. The authoritative state always
  comes from the refreshed `reorder_requests` subscription, never from an
  in-flight response applied blindly.

---

## 10. Refresh / reconciliation after success

- On **Applied** or **Replayed**, the modal closes and the surfaces re-read from the
  live `reorder_requests` subscription; the Ordered card is replaced by the terminal
  **`ReorderRequestReceived`** read-only card via existing realtime status filtering
  (no manual list surgery).
- The receipt's downstream effects (`receiving_orders`, `RECEIVED` ledger event) are
  **backend-owned**; the frontend displays only what the refreshed request document
  and existing read hooks expose. No client-side aggregate is computed or stored.

---

## 11. Explicit prohibition on direct client `RECEIVED` writes

- After F4, **no** client code may set `reorder_requests.status = RECEIVED` directly.
  The only receipt path is the trusted command. This is enforced structurally: UI
  imports the command client, not `receiveReorderRequest()`.
- A test-level guard (§15) asserts **zero** `receiveReorderRequest` importers under
  `src/modules/**` and that the Receiving modal has no `updateDoc`/`setDoc` path to
  `reorder_requests`.

---

## 12. Fail-closed rollback

- Rollback = **disable/hide** the Receiving action (flip `RECEIVING_WRITE_READY`
  false and/or ship a prior frontend build), leaving receipt submission
  **unavailable**. The user cannot mark `RECEIVED` at all rather than marking it
  without a ledger event.
- The **verified trusted callable stays deployed** during any frontend rollback
  (the ledger-backed path is preserved; backend §11).
- **The legacy ledgerless `receiveReorderRequest()` writer is NEVER restored or
  re-wired.** Recovery is a forward fix or a separately-reviewed rollback that still
  routes every `RECEIVED` through the trusted command. Re-introducing L1 is
  prohibited.

---

## 13. Responsive layout (desktop / tablet / mobile)

- **Desktop:** modal/drawer centered; read-only source block as a two-column table;
  location selector + confirm in a footer bar.
- **Tablet:** single-column modal; source block stacks label→value; confirm remains a
  persistent footer action.
- **Mobile (primary for Parts Associate):** full-screen sheet; large tap targets for
  the location selector and confirm; read-only fields collapse into a compact summary
  list; sticky confirm honoring safe-area insets. The `PartsAssociateHome.jsx` entry
  point is mobile-first (assignees work in the field).

---

## 14. Accessibility

- **Modal:** `role="dialog"` + `aria-modal="true"`, labelled by its heading; focus
  **trapped** within; focus **returns** to the invoking Receive control on close;
  Escape closes when not submitting.
- **Fields:** every control has a programmatic label; the location selector is
  keyboard-operable; read-only source fields are exposed as text, not disabled inputs.
- **Errors:** validation/sanitized errors are associated via `aria-describedby` and
  announced through an `aria-live="polite"` region (assertive for submit failures).
- **Focus on state change:** on Blocked/Conflict/Ambiguous, focus moves to the
  message; on success, focus moves to the confirming summary before close.
- **Confirmation:** the confirm control states the consequence ("Receive ordered
  quantity into <location>"); the single-submit busy state is announced.

---

## 15. Unit / component test matrix (frontend only)

Pure/domain (node runner, injected effects — the `completionFlow.test.mjs` convention):

- idempotency key mint/validate/reuse; storage-key scoping; refresh recovery.
- request builder rejects extra fields; only the §3 fields representable.
- response validator: applied vs replayed vs ambiguous (malformed ⇒ not-success).
- location reference validation (active `{type,locationId}`; fail-closed).
- readiness resolver: default false; explicit override; false ⇒ zero attempts.

Component (RTL):

- capability absent ⇒ action **not rendered**; held+not-ready ⇒ **blocked**.
- each §7 state renders its canonical UI; sanitized errors show no raw internals.
- single-submit: rapid double-click ⇒ one in-flight call, one key.
- conflict/replay outcomes render correctly and reconcile from the subscription.
- accessVersion change mid-flow re-resolves capability / suppresses stale outcome.
- **guard:** no `receiveReorderRequest` importer under `src/modules/**`; modal has no
  direct `reorder_requests` write.
- a11y: dialog roles, focus trap/return, `aria-live` error announcement.

Test doubles only — **no** emulator, **no** deploy, **no** real callable (that
coverage is the backend spec's §12).

---

## 16. Future visual-acceptance checklist (F5)

- Receive action visible only to `inventory.stock.receive` holders, only when
  write-ready, on Ordered requests — on desktop, tablet, and mobile.
- End-to-end (production, operator-run at F5): a real receipt produces the terminal
  `ReorderRequestReceived` card **and** a `RECEIVED` ledger event exists (backend §12
  Phase-G evidence); at no point does the UI show "received" without the ledger event.
- Rollback drill: flipping readiness false hides the action and leaves receipt
  unavailable (never ledgerless).
- Screenshots captured for each breakpoint + each §7 state for the visual record.

---

## 17. Phased frontend implementation sequence (F1–F5)

Each phase is its own separately-authorized gate; all are docs/repo-scoped until F4,
and **F3+ depends on the merged, verified Phase-B/E backend contract**.

| Phase | Scope | Depends on | Gate |
|---|---|---|---|
| **F1 — inert client adapter** | `services/receivingCommandClient.js` shell + pure `domain/receivingFlow.js` (idempotency/build/validate), **unwired**, built to the **merged** Phase-B/E contract; no UI change | merged Phase-B/E contract | repo-only DRAFT → Codex → Owner merge |
| **F2 — UI behind `readiness=false`** | Receiving modal + entry points + `config/receivingReadiness.js` (**false**); capability-gated; **zero** callable attempts; legacy L1 still live but untouched | F1 | repo-only DRAFT → Codex → Owner merge |
| **F3 — wiring after callable verification** | wire the modal to the client; **remove L2/L3 legacy calls**; still readiness-false in production | F2, **Phase-E callable deployed + verified** | repo-only DRAFT → Codex → Owner merge |
| **F4 — readiness + Hosting release** | flip `RECEIVING_WRITE_READY = true`; Hosting release serves the bundle; legacy writer no longer imported anywhere | F3, Owner activation auth, **deployment-lock** | activation gate → Owner auth (operator-run) |
| **F5 — production visual verification** | operator-run production visual + ledger-existence verification (§16), sanitized evidence | F4 | verification gate → Owner auth (operator-run) |

**No interval** exists where the UI implies physical receipt without a `RECEIVED`
ledger event: L2/L3 are removed at F3 (before activation), and the trusted path only
becomes reachable at F4 after the callable is verified.

---

## 18. Backend-contract dependencies (unresolved here, by design)

Resolved by the **merged** Phase-B/E contract, not by this document:

- Exact callable **export name**, request **payload**, **error codes**, and
  **response shape** (incl. the `idempotentReplay`-equivalent and version/CAS
  conflict signal).
- `expectedVersion` / CAS field name and where the frontend reads the current version
  for the Ordered request.
- The precise `receiving_orders` line/source object the command expects (frontend
  supplies data satisfying backend §2/§5, wire shape TBD at merge).
- The active-location authority the command re-validates against.

F1 is written **only after** these are merged; until then this spec stands as the
frontend requirement and no adapter code exists.

---

## 19. Approval

**Gate:** Frontend Cutover Specification (Phase F). **Status: DRAFT.** Opened as a
**DRAFT PR** for Codex review; authorizes no implementation and no production-data
action. No `functions/**`, Rules, index, capability/AuditAction, runtime code/test,
`receiveReorderRequest()`, `App.jsx`, `package.json`, callable, deployment, Hosting,
production, or Truck change is made or proposed by merging this document. **STOP for
Codex review.**
