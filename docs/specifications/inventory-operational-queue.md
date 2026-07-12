---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-07-12
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/inventory-operational-queue.md]
implements: []
supersedes: []
superseded_by: []
related_pr: 154
target_release: Post-Release 2.1 (Inventory -> Procurement chain)
---

# Sprint Specification: Inventory Operational Queue -- Manager Oversight, Complete-Catalog Show All, History Discovery

**Architecture Review:** `docs/assessments/inventory-operational-queue.md` -- **APPROVED, 2026-07-12** (Issue #154 / PR #155, merged). Six decisions adopted there govern this Specification directly; each is restated in the relevant section below rather than re-litigated. **No Rules change is approved by that review.** This Specification proposes none, with one exception surfaced during technical design (PR A's assignment-eligibility fix) that is a schema/data addition, not a Rules change -- see "Firestore Rules impact" and PR A's Technical design below for why, and what it actually requires.

## Executive summary

Three related gaps in the Inventory workspace, closed as three independent PRs:

- **PR A** gives a manager visibility into work already assigned to someone else ("All Assigned Work"), and closes a real, silent dead-end where a `technician`-security-role employee could be assigned Parts Associate work they can never see.
- **PR B** makes "Show All" actually mean the complete parts catalog (it doesn't today), adds accurate counts to every filter tab, and replaces one undifferentiated empty-state message with filter-specific ones.
- **PR C** adds a History view so terminal Reorder Requests (`CANCELLED`/`VOIDED`/`RECEIVED`/`REJECTED`) -- invisible today the instant they leave their last active-status query -- become findable by status, assignee, part, or exact request id.

None of the three requires a `firestore.rules` change to the *visibility* model -- per Architecture Review decision #1, this phase keeps `reorder_requests` read access at `admin`/`dispatcher` exactly as it is today. PR A's assignment-eligibility fix does surface a real, previously-undocumented data gap (below) that needs a small schema addition and a one-time backfill, not a Rules change.

## Sprint objective

An admin/dispatcher can see every Reorder Request currently assigned to any Parts Associate (not just their own), can browse the complete parts catalog under "Show All" with accurate counts and honest empty states everywhere, and can find any terminal (closed-out) Reorder Request without already knowing its part or id. An admin/dispatcher can no longer assign Parts Associate work to a `technician`-security-role employee who would have no way to ever see it.

## Scope

**PR A -- All Assigned Work oversight, plus safe assignment eligibility**

- New hook `useReorderRequestsByStatuses(statuses[])` in `hooks/useReorderRequests.js`, reusing the existing `where("status", "in", [...])` shape (single-field `in`, no composite index) -- the assignee-independent counterpart to `useReorderRequestsByStatus()`.
- New read-only "All Assigned Work" section on `PartsList.jsx`, driven by `useReorderRequestsByStatuses([ASSIGNED_TO_PARTS_ASSOCIATE, PURCHASING_IN_PROGRESS])` -- every currently-assigned request, regardless of assignee, rendered alongside (never replacing) the existing personal Waiting/In Progress sections.
- Each row shows: the linked part, the current assignee (`resolveActorDisplayName()`, never a raw uid), `status`, `urgency` (where applicable, `—` otherwise), and age (time since `assignedAt`). Rows are `<Link>`s into `PartDetail.jsx` carrying `?requestId=<id>`, per the established exact-id navigation contract (PR #148) -- no action control of any kind renders on this view.
- New field `employees/{employeeId}.securityRole` (denormalized copy of `users/{uid}.role` at provision time) and a client-side filter in `useAssignableEmployees()`/`EmployeeAssignmentPicker.jsx` excluding `technician`-security-role employees from `PARTS_ASSOCIATE` assignment eligibility. See Technical design below -- this is the one part of PR A that isn't purely additive.

**PR B -- complete-catalog Show All, filter counts, differentiated empty states**

- Show All's data source changes from `healthEntries` (ledger-active parts only) to the full `PARTS_CATALOG` merged with whatever `healthEntries` exist -- every catalog part appears; a part with no ledger activity renders with an explicit "No ledger activity" state instead of being silently absent.
- `QUEUE_FILTER_OPTIONS`'s three tabs gain populated `count` values, rendered via `FilterBar.jsx`'s already-existing `(N)` suffix support.
- `InventoryHealthPanel.jsx` gains an optional `emptyText` prop (defaulting to today's string, so `Operations.jsx`'s own call site is byte-for-byte unaffected); `PartsList.jsx` supplies a filter-specific message per tab.
- The lower "Parts Catalog" table's relationship to the now-complete-catalog Show All tab is resolved by this Specification (see Technical design) -- Architecture Review required consolidation or relocation, not leaving two indistinguishable complete-catalog views indefinitely.

**PR C -- Reorder Request History / terminal-status discovery**

- New "History" section on `PartsList.jsx`, driven by `useReorderRequestsByStatuses([CANCELLED, VOIDED, RECEIVED, REJECTED])` (reusing PR A's new hook).
- Client-side text filter (part name/SKU, assignee name, or exact request id) and a status filter, since this view has no natural upper bound and only grows over time -- see Risks.
- Each row shows: the linked part, `status`, the terminal actor (`cancelledBy`/`voidedBy`/`receivedBy`, whichever applies, resolved via `resolveActorDisplayName()`), and the terminal timestamp. Rows link into `PartDetail.jsx` with `?requestId=<id>`, same navigation contract as PR A.

## Explicitly out of scope

- **Any `firestore.rules` change to `reorder_requests` visibility.** Per Architecture Review decision #1, broader authorization (an actual signed-in Parts Manager/Parts Associate role, as opposed to today's advisory `operationalRoles[]`) is deferred to a separate Tier-2 identity/authorization design, coordinated with Issue #100. Not this Specification's problem to solve.
- **The Inventory Action Log redesign** -- Issue #152, confirmed separate again here per the Owner's repeated instruction.
- **The Cancel/Void initiative** -- PR #151 (merged, deployed) is not reopened, changed, or depended on by this Specification. `ReorderRequestCancelled`/`ReorderRequestVoided`'s own read paths are untouched; PR C's History view reads the same `reorder_requests` documents through a new query, not through any Cancel/Void code.
- **The broader page-restructuring ("Reorder Work" / "Inventory Health" / "Parts Catalog" headings)** the Assessment's "Live-page architecture finding" recorded as an adopted future direction. PR A/B/C add sections to the existing page structure; regrouping the whole page under that three-part hierarchy is a larger, separate follow-up, not bundled into any of PR A/B/C here.
- **Pagination/virtualization of any queue.** Every new view added here is expected to stay small in practice for the near term (see Risks for History's specific growth concern, addressed with a client-side filter, not pagination, at this size).

## Technical design

### PR A: `useReorderRequestsByStatuses()`

```js
// hooks/useReorderRequests.js
export function useReorderRequestsByStatuses(statuses, enabled = true) {
  const [state, setState] = useState({ data: [], loading: enabled });

  useEffect(() => {
    if (!enabled || !statuses?.length) {
      setState({ data: [], loading: false });
      return;
    }
    setState((prev) => ({ ...prev, loading: true }));
    const q = query(reorderRequestsRef, where("status", "in", statuses));
    const unsubscribe = onSnapshot(
      q,
      (snap) => setState({ data: toDocs(snap), loading: false }),
      () => setState({ data: [], loading: false })
    );
    return unsubscribe;
  }, [statuses.join(","), enabled]);

  return state;
}
```

A single-field `in` query with up to 10 values needs no composite index (Firestore's own documented limit is comfortably above both call sites' 2 and 4 values). `firestore.rules`' existing `reorder_requests` read rule (`allow read: if isAdminOrDispatcher();`) is unconditional on query shape -- no Rules change. Both PR A's "All Assigned Work" and PR C's "History" reuse this one hook, not two separate implementations.

### PR A: the assignment-eligibility gap, verified precisely

The Assessment recommended excluding `technician`-security-role employees from Parts Associate assignment eligibility, "prefer[ring] client-side filtering of the already-authorized Employee result if that avoids a new composite index/query contract." **Verified during this Specification: that filtering needs data that does not exist on the Employee document today, and cannot be read the way one might assume.**

- `employees/{employeeId}` (`domain/employees.js`'s `buildAssignableEmployeesQuery()`) has no `role`/security-role field -- confirmed against `docs/BusinessEntityModel.md` Section 8a's own field table and `provisionEmployeeAccess.js`'s actual writes, which set `role` only on `users/{uid}` (`userUpdates: { role: securityRole }`), never on the Employee document.
- `users/{uid}` is **hard self-read-only** (`firestore.rules:172-175`: `allow read: if isSignedIn() && request.auth.uid == userId;`, no admin/dispatcher exception). An admin/dispatcher cannot read a candidate assignee's `users/{uid}.role` at all, by any query shape -- this is not a missing index or a missing query parameter, it is a Rules-enforced boundary.

**Resolution -- a denormalized, read-only mirror field, not a Rules change:**

- Add `securityRole` to `employees/{employeeId}` (written by `functions/scripts/provisionEmployeeAccess.js`, at the same point it already writes `users/{uid}.role` -- one additional field on an existing write, same script, same transaction/batch, no new write path).
- `employees` is already fully `admin`/`dispatcher`-readable (`firestore.rules:198-202`, unchanged) -- reading the new field needs no Rules edit.
- `useAssignableEmployees()` (or `EmployeeAssignmentPicker.jsx`, whichever proves the smaller diff during implementation) filters the already-returned, already-authorized employee list client-side: `employees.filter((e) => e.securityRole !== ROLES.TECHNICIAN)`, applied only when `requiredOperationalRole === OPERATIONAL_ROLE.PARTS_ASSOCIATE`. No new `where()` clause on `buildAssignableEmployeesQuery()` -- avoids the open question of whether Firestore's inequality-filter rules would even permit a second field-level constraint alongside the existing `where("userId", "!=", null)`, which the Assessment correctly flagged as a risk to avoid.
- **`operationalRoles[]`'s own documented principle is preserved, not violated:** `docs/BusinessEntityModel.md` Section 8a states `operationalRoles[]` "[determines] assignment eligibility only -- never a substitute for the existing security `role` on `users/{uid}`." `securityRole` on the Employee document is the same kind of thing -- a read-only, query-convenience *mirror* of the real authority (`users/{uid}.role`), not a second, competing source of truth. Nothing in `firestore.rules` reads or trusts `employees.securityRole` for authorization; every actual write/read permission remains gated exactly as it is today, solely by `users/{uid}.role` via `isAdminOrDispatcher()`.

**Required prerequisite, called out explicitly -- a one-time backfill, not part of PR A's own code:**

Every `employees/{employeeId}` document created before PR A's `provisionEmployeeAccess.js` change lacks `securityRole` entirely (not `null` -- genuinely absent, the same "legacy document" shape this codebase has handled repeatedly elsewhere, e.g. Cancel/Void's own legacy-`reorder_requests` handling). **A missing `securityRole` must fail open (treated as not-technician, i.e. not additionally excluded)** -- the alternative (fail-closed) would silently remove every already-provisioned, legitimately-eligible employee from the assignment picker the moment PR A ships, which is a worse regression than the gap this PR closes. This means **PR A's interim safety constraint is incomplete until a backfill runs**: any `technician`-role employee provisioned before PR A remains selectable until their Employee document is backfilled with `securityRole`. Backfilling means reading each existing Employee's linked `users/{uid}.role` and writing it onto the Employee document -- an Admin-SDK-only operation this environment cannot perform itself (no production Admin SDK credentials, this project's standing, repeatedly-established boundary). **The backfill is the Owner's own follow-up action, under its own separate Production Data Authorization, exactly the same pattern as every other production-data-touching step in this project's history** -- not something PR A's Final Review can treat as already covered by the PR's own scope.

### PR B: complete-catalog Show All

```js
// PartsList.jsx, illustrative -- exact placement is an implementation detail
function mergeCatalogWithHealth(catalog, healthEntries) {
  const byPartId = new Map(healthEntries.map((e) => [e.partId, e]));
  return catalog.map((part) => byPartId.get(part.sku) ?? { partId: part.sku, noLedgerActivity: true });
}
```

`queueFilter === "ALL"` uses `mergeCatalogWithHealth(PARTS_CATALOG, healthEntries)` instead of raw `healthEntries`. `InventoryHealthPanel.jsx`'s row renderer needs one new branch for a `noLedgerActivity` entry (no `usage`/`recommendation` to read) -- rendered the same way the existing lower Parts Catalog table already renders a part with no ledger activity (`PartsList.jsx:387-388`'s established pattern, reused, not reinvented). **Critical & High and Needs Planning are unaffected** -- both remain scoped to real `healthEntries` only, since a part with no ledger activity has no computed `urgency`/`recommendationStatus` to begin with and correctly cannot belong to either calculated subset (Architecture Review decision #2's own framing).

**Lower "Parts Catalog" table -- resolved as consolidation, not relocation.** Once the top section's Show All is the true complete catalog, the lower table's own "browse everything" purpose is fully subsumed -- it becomes a second, redundant "every part" view differing only in column set (it shows SKU/cost/price; the top section shows stock/usage/urgency). **Consolidation:** the lower table's SKU/cost/price columns are added to the top section's Show All row rendering (conditionally, only under Show All -- Critical & High/Needs Planning stay unchanged, they don't need catalog-static columns for a risk-triage view), and the lower table itself is removed. This keeps exactly one "complete catalog" experience on the page, per Architecture Review decision #2's explicit requirement not to leave two indistinguishable ones indefinitely, without introducing a second new UI surface (a toggle, a relocated page) that the Assessment's "Live-page architecture finding" would only need to unwind again during the later, separate page-restructuring follow-up.

### PR C: History view

Reuses `useReorderRequestsByStatuses([CANCELLED, VOIDED, RECEIVED, REJECTED])` from PR A. Client-side filter state (text input matching part name/SKU/assignee display name/exact request id; a status dropdown) narrows the rendered rows -- no new Firestore query per keystroke, consistent with every other client-side filter already on this page (`queueFilter`, `category`). Terminal actor/timestamp resolution reuses the exact fields already established per status: `cancelledBy`/`cancelledAt` (`CANCELLED`), `voidedBy`/`voidedAt` (`VOIDED`), `receivedBy`/`receivedAt` (`RECEIVED`), `reviewedBy`/`reviewedAt` (`REJECTED`, since rejection is recorded on the review fields, not a dedicated terminal field) -- all already-existing fields, no schema addition.

## Authorization

Unchanged from today for every existing action on this object -- PR A/B/C add zero new write paths and zero new action controls. "All Assigned Work" and "History" are both read-only, `<Link>`-only views, gated to the same `admin`/`dispatcher` audience that can already reach `PartsList.jsx` (`ROLE_NAV_ACCESS`) and already read every `reorder_requests` document that audience can see today (`isAdminOrDispatcher()`, unchanged). The one write-adjacent change -- PR A's assignment-eligibility filter -- narrows an existing selection list client-side; it does not add, remove, or alter any `firestore.rules` write permission. `voidPurchaseOrder()`/`cancelReorderRequest()`/every other existing writer is untouched.

## Firestore Rules impact

**None**, for the visibility features themselves (PR A's oversight view, PR B's Show All/counts/empty-states, PR C's History) -- every new query reuses the existing, unconditional `reorder_requests` read rule (`allow read: if isAdminOrDispatcher();`), same as every query already on this page. **PR A's `employees.securityRole` field also needs no Rules change** -- `employees`' existing read rule (`allow read: if isAdminOrDispatcher() || (isSignedIn() && userData().employeeId == employeeId);`) already covers the new field once it exists; only the *writer* (`provisionEmployeeAccess.js`, Admin SDK, already bypasses Rules by design) needs updating to populate it. **Both copies of `firestore.rules` remain byte-identical to their current, deployed state** through all three PRs.

## UI impact

- `PartsList.jsx` gains two new read-only sections ("All Assigned Work" under PR A, "History" under PR C) and one restructured section (Show All under PR B, plus the lower Parts Catalog table's removal per the consolidation above).
- `EmployeeAssignmentPicker.jsx` (or `useAssignableEmployees()`) silently omits `technician`-role candidates from the Parts Associate picker's results -- no new error state, no visible "excluded" indicator; they simply don't appear, same posture as every other eligibility filter already on this component (`employmentStatus`, `operationalRoles`, linked-user).
- `InventoryHealthPanel.jsx` gains an optional `emptyText` prop and one new row-rendering branch for a no-ledger-activity catalog entry (Show All only).
- `FilterBar.jsx` itself is unchanged -- its existing `count` support is simply used for the first time by `QUEUE_FILTER_OPTIONS`.
- No new route, no new nav entry -- all three additions live on the existing `/inventory` (Parts) page.

## Testing strategy

Primary test: extend the `run-field-ops-app-vite` Playwright skill's `driver.mjs`, same established pattern as `verify-notification-identity`/`verify-cancel-void` (PR #148/#151) -- one new named command per PR (or one combined command covering all three, decided at Implementation Plan time), signed in as more than one `admin`/`dispatcher` account where the test requires proving cross-user visibility.

Required coverage, restated from the Assessment's "Verification requirements" section (unchanged, not re-litigated here):
- Manager B sees, in "All Assigned Work," a request assigned to user A, without being the assignee.
- User A's own personal Waiting/In Progress views remain scoped to exactly user A, unbroadened.
- Every lifecycle section (Critical & High, Needs Planning, Show All, All Assigned Work, History) displays an accurate count.
- Empty messages distinguish "no records at all," "records exist but none match the active filter," and "no ledger history."
- Show All contains the complete catalog, including at least one part with zero ledger activity.
- At least one `CANCELLED`, `VOIDED`, `RECEIVED`, and `REJECTED` fixture request is each findable in History by status, assignee, part, and exact request id.
- No action control appears in "All Assigned Work" or "History" for any account/status combination that wouldn't already see it on `PartDetail.jsx` directly.
- **New for this Specification (the assignment-eligibility fix):** a `technician`-security-role employee with a `securityRole`-backfilled Employee document does not appear in the Parts Associate assignment picker; an otherwise-identical `dispatcher`/`admin`-role employee does. A fixture Employee document with `securityRole` entirely absent (simulating a pre-PR-A, not-yet-backfilled document) is confirmed to still appear (fail-open, per Technical design above) -- proving the interim gap is real and observable, not just a Note in this document.

## Rollback strategy

- **Before any PR in this Specification deploys:** normal revert, no live impact -- none of the three PRs has a schema-deployment sequence or an irreversible write.
- **After PR A deploys (oversight view + eligibility filter), before the `securityRole` backfill runs:** reverting PR A's frontend removes the oversight view and the eligibility filter cleanly -- no data was migrated, `employees.securityRole` (if PR A's writer change already went live) simply stops being read; existing Employee documents are unaffected either way, since this is a purely additive field.
- **After the backfill runs:** rolling back PR A's *eligibility filter* code (not the backfill itself) is safe and independent -- `securityRole` remains on Employee documents, simply unused again, until/unless a future PR re-adopts it. **The backfill itself is never rolled back** -- it only ever adds a read-only mirror field; no existing Employee data is altered or removed by writing it.
- **PR B and PR C are both purely additive/restructuring UI changes with no schema or Rules component** -- reverting either at any point is a normal frontend revert, no rollback-ordering constraint of any kind.

## Acceptance criteria

- [ ] `useReorderRequestsByStatuses(statuses[])` added to `hooks/useReorderRequests.js`, reused by both PR A and PR C -- confirmed via `git grep`, not two separate implementations.
- [ ] "All Assigned Work" (PR A) shows every `ASSIGNED_TO_PARTS_ASSOCIATE`/`PURCHASING_IN_PROGRESS` request regardless of assignee, additive to (never replacing) the existing personal Waiting/In Progress sections; every row navigates via `?requestId=`; no action control renders.
- [ ] `employees/{employeeId}.securityRole` written by `provisionEmployeeAccess.js` at the same point `users/{uid}.role` is written; `useAssignableEmployees()`/`EmployeeAssignmentPicker.jsx` excludes `technician`-role candidates from Parts Associate eligibility, client-side, with a missing `securityRole` failing open (confirmed by a dedicated test fixture).
- [ ] The `securityRole` backfill for pre-existing Employee documents is **explicitly not claimed as done by PR A** -- recorded in `docs/DECISIONS.md` as a separate, Owner-authorized, Owner-executed follow-up, per this project's standing production-data-write discipline.
- [ ] Show All (PR B) renders every `PARTS_CATALOG` part, including ones with zero ledger activity, each showing an explicit "No ledger activity" state; Critical & High and Needs Planning remain scoped to real `healthEntries` only, unaffected.
- [ ] `QUEUE_FILTER_OPTIONS`'s three tabs display accurate `(N)` counts via `FilterBar.jsx`'s existing support.
- [ ] `InventoryHealthPanel.jsx`'s empty-state message is filter-specific on `PartsList.jsx`'s call site; `Operations.jsx`'s own call site renders byte-identically to before (its own `emptyText` prop omitted, default preserved).
- [ ] The lower "Parts Catalog" table is removed, its SKU/cost/price columns folded into Show All's row rendering -- confirmed exactly one "complete catalog" view remains on the page.
- [ ] History (PR C) shows every `CANCELLED`/`VOIDED`/`RECEIVED`/`REJECTED` request, filterable by status/part/assignee/exact request id; every row navigates via `?requestId=`; no action control renders.
- [ ] `npm run build && npm run lint` / `npx tsc --noEmit` clean for every PR.
- [ ] Browser verification (Playwright, `run-field-ops-app-vite` skill) covers every item in "Testing strategy" above, run against a fresh emulator, for each PR before it's considered complete.
- [ ] No `firestore.rules` diff in any of PR A/B/C -- confirmed via `git diff firestore.rules` returning empty for each PR.

## Risks

- **History has no natural upper bound.** Unlike every other queue on this page (bounded by "currently in an active status," which churns), terminal requests only ever accumulate. A client-side text/status filter is sufficient at today's scale (confirmed low request volume throughout this project's history), but if volume grows substantially, an unfiltered `where("status", "in", [...])` read with no `limit()` could become a real cost/performance concern -- flagged here as a known, accepted scaling limit of this Specification's design, not solved now. A future `limit()` + cursor-based "load more," or a server-side text-search integration, would be the natural next step if this ever becomes a problem in practice.
- **The `securityRole` backfill is a real, separate dependency this Specification cannot close on its own.** PR A's interim safety constraint is genuinely incomplete (not merely "pending deployment," but pending a specific, separately-authorized Owner action) until the backfill runs. Any Final Review of PR A must not treat the constraint as fully closed without independently confirming the backfill's own status.
- **PR B's consolidation removes an existing table.** Any hidden consumer of the lower Parts Catalog table's specific column set (cost/price alongside SKU) that isn't satisfied by folding those columns into Show All would be a regression -- worth a final visual/functional comparison against the current lower table before removing it, not assumed safe purely from this design.
- **`InventoryHealthPanel.jsx` is shared with `Operations.jsx`.** The `emptyText`/no-ledger-activity-row changes must be verified, not just designed, to leave `Operations.jsx`'s own rendering byte-identical -- restated from the Assessment's own Risks section, still the single most likely place an unintended regression could hide.

## Open questions

None blocking Implementation Plan drafting. Two items are recorded as **Implementation Plan-level decisions**, not open architecture questions (Architecture Review's own scope is already closed per PR #155):

1. Whether PR A/B/C ship as three separate PRs (as named throughout this Specification) or some are combined, is the Implementation Plan's own sizing call, consistent with `docs/ai/workflow.md`'s "one architectural concern per PR" guidance applied to each of the three concerns named here.
2. The exact backfill script's shape (a new one-off script under `functions/scripts/`, or a small extension of an existing one) is an implementation detail for whoever the Owner designates to run it -- not decided here.

## Approval

**Not yet reviewed.** This Specification requires ChatGPT Approval (per `docs/ai/workflow.md`'s stage 4) before an Implementation Plan is drafted or any PR in this Specification is opened. No code, Rules, deployment, or production-data change has been made while producing this document -- planning only.
