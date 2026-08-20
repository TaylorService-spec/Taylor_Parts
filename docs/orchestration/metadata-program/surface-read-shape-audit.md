# Surface read-shape audit — reclassifying the composites

> Workstream: `X-SURFACE-CLASSIFICATION-COMPOSITES` (LEDGER.md phase 6, READY at time of writing)
> Base: origin/main @ `26f4c0324b003cb8bb047cf04526dc5c63584e9c`
> Scope: analysis only. No code changed, no ledger entries changed.

## Why this document exists

Four consecutive migration attempts on surfaces the Phase 0 inventory had classified
`A_ENTITY_LIST` were evaluated and declined: **Transfers** (owns four governed write
actions), **Purchase Orders** (a request-driven join whose status lives on the *other*
collection), **Parts** (a cross-catalog full-accounting invariant no list contract
expresses), and **Employees** (the nav label and the underlying dataset disagree). Each
looked like an independent discovery. They are the same discovery made four times: the
Phase 0 classification recorded what a surface *looks like* — a table with rows — rather
than what its read *actually is*, because it predates the list runtime and was never
re-tested against real code.

This audit re-tests every surface still marked unmigrated in the ledger against its
actual source, one pass, so the burn-down stops rediscovering this lane by lane. It does
**not** re-litigate the four surfaces above; their recorded findings are taken as given.

## Method

For every surface below: the page component and its data-fetching hook/service were
read in full (not grepped), the exact collection(s)/callable(s) were identified, the
bound (or absence of one) was quoted, every write/mutation action reachable from the
surface was enumerated, and the presence of a merged `EntityDefinition` was checked
against `field-ops-app-vite/src/metadata/definitions/`. Where a claim could not be
established from code, it is stated as unknown rather than inferred.

Classification taxonomy used throughout (distinct from the ledger's existing
`A_ENTITY_LIST`/`B_ENTITY_RECORD`/… labels, which record *route shape*; this is about
*read shape*):

- **LIST** — genuinely migratable on the proven Warehouses/Suppliers pattern.
- **COMPOSITE** — a lifecycle/join/invariant/dashboard surface a single list contract
  cannot express honestly (owns governed writes, derives its dataset from a join or
  client-side composition, or fans multiple collections into one view).
- **BLOCKED** — would be a list, but a specific, named dependency doesn't exist yet.
- **MISLABELLED** — the nav label/ledger description and the underlying data disagree.

## Scope audited

15 surfaces not previously attempted, covering every remaining `SURFACE`-kind ledger
entry still in `BLOCKED_DEPENDENCY`/`BLOCKED_PROTECTED` whose read path could plausibly
be mistaken for a list, plus the two `B_ENTITY_RECORD`/dashboard entries whose recorded
blocker text turned out to need checking against current code. `B_ENTITY_RECORD` detail
pages (Sales Order detail, Work Order detail, Part detail, Equipment detail) are excluded
— they route through the page runtime, not the list runtime, and nothing found in this
pass calls that boundary into question. `X-ACCOUNT-TAG-CATALOG` is a facet gap on the
already-merged Customers list, not an independent surface, and isn't separately
classified here.

---

## 1. Job Assignments — `/service/job-assignments`

- **Reads**: `fieldops_wos` (`WORK_ORDERS_COLLECTION`), via `hooks/useWorkOrders.js` →
  `services/workOrderService.ts`'s `subscribeToWorkOrders`
  (`onSnapshot(collection(db, WORK_ORDERS_COLLECTION), …)` — no query, no limit).
- **Same hook, same collection as the already-merged S-SVC-WORK-ORDERS.** `Jobs.jsx`'s
  own header comment says so directly: "this surface now READS the governed Work Order
  Engine (`fieldops_wos`) instead of the legacy `fieldops_jobs` collection." There is no
  distinct `Technician`-style dataset here, and the ledger's own `entity` field already
  says `WorkOrder`, not a `Job` entity.
- **No write actions.** The one action on the page, "New Work Order," is a plain
  `<Link>` to the WorkOrderWizard — not a callable invoked from this component.
- **No free-text search.**
- **Authoritative state**: `job.status` is read straight off the same `fieldops_wos`
  document being listed — no join.
- **Verdict: MISLABELLED.** This is not an independent surface with its own read shape
  to classify — it is the Work Orders list, rendered a second time under a legacy route
  and a legacy label, with no distinguishing collection, filter, or action. The ledger's
  own next-action text ("Migrate or retire — overlaps the Work Orders list") already
  named the correct fork; the read-shape evidence resolves it: **retire**, don't migrate.
  A second `A_ENTITY_LIST` migration onto the identical `WorkOrder` entity would just be
  the same list definition mounted twice under two routes.

## 2. Saved Reports — `/reporting/saved`

- **Reads nothing from Firestore directly.** Every read and write goes through trusted
  callables (`domain/reporting/savedReportService.js`): `listSavedDefinitionsCallable`,
  which server-side does
  `db.collection("reportDefinitions").where("ownerUid","==",actorUid).get()`
  (`functions/src/reporting/savedDefinitionCommands.ts`). The client "NEVER touches the
  `reportDefinitions` collection directly (firestore.rules denies that unconditionally)"
  — the file's own header comment.
- **Owns four governed write actions**, all invoked from this exact page: `create`,
  `rename`, `duplicate`, `remove` (`SavedReports.jsx` lines 102–114), each followed by a
  mandatory re-list from the server (never an optimistic splice).
- **No `SavedReportDefinition`/`ReportDefinition` EntityDefinition exists** under
  `metadata/definitions/`.
- **Verdict: COMPOSITE.** Two independent, compounding reasons, either sufficient alone:
  (1) it owns four governed CRUD write actions with confirmed-only re-fetch semantics,
  the same class of defect that disqualified Transfers; (2) the read is `CALLABLE`-only
  and per-owner-scoped — there is no shared collection a list definition could declare
  against, since Rules deny direct client reads of `reportDefinitions` unconditionally.
  This is close to Purchase Orders' shape in one respect (no `A_ENTITY_LIST` fits) but
  the decisive property here is ownership of the CRUD surface, not a cross-collection
  status split.

## 3. Part Master bulk status table — `/inventory/part-master`

- **Reads**: the entire `parts` collection, one-shot, unbounded.
  `services/partMasterQueries.js:15` — `const snap = await getDocs(collection(db, PARTS_COLLECTION));`
  No `limit()`, no cursor, no `truncated` flag (there is an `invalidCount` surfaced in the
  UI, but that counts malformed docs, not a row cap — there is no cap).
- **Owns three governed write actions** with optimistic-concurrency (`expectedVersion`):
  `createPart`, `updatePart`, `changePartStatus`, via `hooks/usePartMasterWrite.js` →
  `partMasterCommandClient`. Currently fail-closed by a write-readiness flag in
  production, but the affordances (create/edit/status-change modals) are wired into this
  exact page (`PartMasterList.jsx` `submitCreate`/`submitEdit`/`submitStatus`).
- **A merged `Part` EntityDefinition exists** (`part.js`, merged under
  `S-INV-PART-DEFINITION`) — the same entity `S-INV-PARTS` was declined against for a
  different, cross-catalog-invariant reason.
- **Verdict: COMPOSITE.** The write actions alone are disqualifying (same class of
  defect as Transfers — `create`/`update`/`changeStatus` with concurrency control is not
  expressible by a list contract), independent of whether the writes are currently
  gated off. Separately, the read is genuinely unbounded with no truncation disclosure
  at all — worse than the "capped but undisclosed" pattern flagged elsewhere in the
  program; here there's no cap to disclose.

## 4. Equipment workspace — `/equipment`

- **Not a single list.** `EquipmentWorkspace.jsx` is a three-tab surface: "Customer
  Equipment" (default — a read-only cross-customer paginated list), "Available
  Equipment" (a stub, "not yet connected"), and "Add Equipment" (`EquipmentRegister`,
  which calls `createEquipment` — a governed write).
- **The default tab's read, in isolation, is genuinely clean**: `equipment` collection,
  true cursor pagination —
  `hooks/useInstalledEquipmentPage.js`: `query(base, orderBy(documentId()), startAfter(cursor), limit(pageSize))`,
  `pageSize = 25`, with an honest `hasMore`/"Load more" affordance surfaced in the UI
  (not a silently-discarded `truncated` flag — this is the pattern the program should
  want more of). Status is read from the same `equipment` doc, not joined. Account/
  Location *names* are resolved via bounded lookups against `accounts`/`locations` for
  display only.
- **A merged `Equipment` EntityDefinition exists** (`equipment.js`, merged under
  `S-INV-EQUIPMENT-DEFINITION`).
- **No free-text search** — two `<select>` filters, explicitly documented as not a
  global search.
- **Verdict: COMPOSITE at the surface boundary the ledger defines** (`/equipment` as one
  entry covering all three tabs) — a single list contract cannot express a workspace that
  also contains a stub tab and a create-flow tab. **But the default tab alone is the
  single closest thing to a clean LIST candidate found in this entire audit** — the read
  is bounded, cursor-paginated, honestly truncation-disclosed, has no embedded writes,
  and its entity is already defined. If the surface boundary were redrawn to just
  Customer Equipment (leaving Available Equipment and Add Equipment as separate, later
  decisions), it would very likely qualify as LIST outright. That redraw is a scoping
  decision, not a leaf lane's call, so it is recorded here rather than assumed.

## 5. Receipts — `/purchasing/receipts`

- **Reads a join, not a collection.** `Receipts.jsx` composes
  `useReorderRequestsByStatuses([RECEIVED])` (unbounded `onSnapshot` on
  `reorder_requests` filtered `status == RECEIVED`) with `usePurchaseOrdersByIds(ids)`
  (chunked `documentId() in […]` reads against `reorder_purchase_orders`), through
  `buildPurchaseOrdersView` — **the identical view-model `PurchaseOrders.jsx` already
  uses and was declined against.** The page's own header says exactly this: "the received/
  result side of the ONE governed Receiving capability... the same view-model Purchase
  Orders and the Receiving workspace use."
- **Status is cross-collection.** `domain/purchaseOrdersView.js`'s row builder derives a
  third, view-level status (`RECEIVED`/`VOIDED`/`OPEN`/`ORPHAN`) by combining
  `request.status` (on `reorder_requests`) with `po.status` (on `reorder_purchase_orders`,
  which per the already-declined S-COM-PURCHASE-ORDERS finding is permanently
  `"ORDERED"`). Neither collection alone carries the label this page shows.
- **The governed receipt ledger isn't read at all.** The real `receiving_orders`
  collection (written by the backend-only `receiveInventoryStock` service) is deny-all to
  the client; this page's "receipts" are inferred from the request+PO join, not the
  governed receiving record.
- **No write actions** — confirmed read-only by the page's own comment.
- **Verdict: COMPOSITE, for the identical decisive reason S-COM-PURCHASE-ORDERS was
  already declined for.** This is not a new finding so much as confirmation that the
  Purchase Orders finding generalises exactly as predicted: Receipts is a *filtered
  slice* of the same join, inheriting the same "authoritative state lives on the other
  collection" defect. A metadata list driven off either `reorder_requests` or
  `reorder_purchase_orders` alone could not reproduce this view.

## 6. Users (admin) — `/administration/users`

- **Not a static placeholder** — it has one live, capability-gated read. The "Set user
  status" section is unconditionally `disabled` with no read backing it at all (no
  governed target-user directory read exists for that action). The password-reset
  section, when `admin.credentialReset.initiate` is granted (catalog entry `active:
  false` today, so effectively off in every environment), calls `listResetEligibleUsers`,
  which server-side does `db.collection("users").limit(limit).get()` — a real, bounded
  directory read, but **scoped to reset-eligibility, not a general Users list** (it also
  does a per-row `employees/{employeeId}` lookup for link resolution).
- **One write action reachable**: the reset-initiation callable, itself gated behind the
  same inactive capability.
- **No `User` EntityDefinition exists.**
- **Verdict: BLOCKED.** The ledger's own next-action ("Inventory only; no governed
  directory read exists to migrate") is correct in substance but slightly imprecise: a
  governed directory read *does* exist, but it is action-scoped (eligibility for one
  specific credential-reset flow) and sits behind a capability that is `active: false`
  everywhere. What's missing, named exactly: a **general-purpose, unscoped Users
  directory read** — distinct from `listResetEligibleUsers` — plus activation of the
  gating capability. Reusing the eligibility-scoped read for a general list would record
  a false action in the audit trail, per the surface's own design comment.

## 7. Roles & Permissions — `/administration/roles-permissions`

- **Reads nothing.** `AdminRolesPermissions.jsx` has no hook, no callable, no `getDocs`/
  `onSnapshot` anywhere in the file. The only "data" is a hardcoded local constant
  (`COMPATIBILITY_ROLES`) filtered client-side to populate a `<select>`.
- **Form is unconditionally disabled** — both the `<select>` and the "Assign Role"
  button carry `disabled aria-disabled="true"` with no `onClick`/`onChange` handlers at
  all; this is a non-interactive static preview, not a gated-but-wired surface.
- **No `RoleAssignment` EntityDefinition exists.**
- **Verdict: BLOCKED.** Confirms the ledger's existing next-action exactly: there is
  nothing to migrate because there is no read at all yet. Named dependency: a trusted
  Role/Permission directory read must exist and ship before this surface has any content
  a list runtime — or anything else — could render.

## 8. Opportunities workspace — `/customers/opportunities`

- **Reads** `opportunities` via the trusted callable `listOpportunityContext`
  (`opportunityReadService.ts`: `db.collection("opportunities").limit(OPPORTUNITY_CONTEXT_LIMIT + 1).get()`,
  limit 1000, honest `truncated` disclosure). This is bounded and disclosed — better
  than several already-migrated surfaces on that axis alone.
- **Owns two governed write actions reachable from this exact page**: `createOpportunity`
  and `transitionOpportunity` (idempotency-keyed, capability-gated lifecycle
  transitions). `SalesWorkspace.jsx`'s own header states the workspace is "intended to
  become an operating workspace where authorized users MAINTAIN Opportunity information"
  with contextual, section-level editing — this is a stated design goal, not an
  accident.
- **The migration was already evaluated and declined in-repo**, with a detailed
  three-blocker comment block at the top of `SalesWorkspace.jsx` (predates this audit).
  Two of the three blockers are runtime-plumbing gaps that generalize beyond this one
  surface: (1) `useMetadataList` has no `readVia: CALLABLE` branch at all — **this
  specific gap was closed after that comment was written**, by
  `X-INDEX-SURFACE-CALLABLE-READ` (merged, PR #1229) — so the ledger's own "stale
  blocks" list is right to flag `S-CRM-OPPORTUNITIES` as worth re-checking. (2)
  `metadata/callableListSource.js` still hardcodes a single response-key mapping for a
  *different*, Account-scoped callable (`listOpportunitiesForAccount`) and has no mapping
  for the real unscoped read this workspace uses (`listOpportunityContext`) — unresolved.
  (3) the declared `opportunityIndexList` columns omit the pipeline's actual triage
  signal (`nextAction`), and `accountId` has nothing to resolve it to without a real
  per-row Account read the governed projection deliberately does not provide (no PII
  copy) — unresolved.
- **Verdict: COMPOSITE**, independent of the three runtime gaps above. Even with every
  plumbing gap closed, this is an editable operating workspace with per-row lifecycle
  transitions and inline create/edit — the same class of surface `S-SVC-DISPATCH-QUEUE`
  is already correctly classified as. The runtime gaps (2) and (3) are real and are
  BLOCKED-shaped sub-findings worth tracking separately since they generalize to any
  future CALLABLE-backed INDEX surface, but they are not why this surface should stay
  off the list runtime — the embedded writes are.

## 9. Dispatch queue — `/service/dispatch`

- **Reads two collections**: `fieldops_wos` (unbounded `onSnapshot`, no query/limit —
  the file's own comment calls it "an UNFILTERED collection listener") joined
  client-side to `fieldops_technicians` (also unbounded) for technician name lookup and
  the "available" filter in the assign dropdown.
- **Owns a governed lifecycle-transition write**: `transitionWorkOrder(job.id,
  "Dispatch", { assignedTechId })`, server-re-validated (two dispatchers can't win the
  same technician) and writing to two collections (`assignedTechId` on the job, `status`
  on the technician) atomically server-side.
- **Verdict: COMPOSITE.** Confirms the ledger's existing classification exactly
  ("queue with governed transition writes, not a list") — decisive reason is the
  Dispatch transition write, structurally identical to why Transfers and Purchase Orders
  were declined. Also unbounded on both reads, a secondary defect that would need fixing
  regardless of classification.

## 10 & 11. Coordinated Visits / Coordinated Mission — `/service/coordinated-visits`, `/service/coordinated-mission`

- **No distinct Firestore collection exists for either.** Both read the same
  `fieldops_wos` documents via the same bounded, disclosed callable
  (`listCoordinatedOperations` → `coordinatedVisitReadService.ts`:
  `db.collection("fieldops_wos").where("status","in",ACTIVE_COORDINATION_STATUSES).limit(limit+1).get()`,
  `DEFAULT_LIMIT = 300`, honest truncation).
- **The dataset each surface renders is a client-side composition, not a read.**
  Coordinated Visits groups the same Work Order documents by `salesOrderId`
  (`domain/coordinatedVisit.js`'s `buildCoordinatedVisits`); Coordinated Mission takes
  one such group and further projects it into a per-visit "field mission" shape
  (`domain/coordinatedFieldMission.js`'s `buildCoordinatedFieldMission`). Field signals
  (parts readiness, load verification) and operational context (schedule/technician/
  truck names) are honestly left empty — never fabricated — pending separate governed
  reads that don't exist yet.
- **This resolves the ledger's own recorded caveat.** Both entries were held on
  "confirm synthetic-source status before migrating" — production is confirmed **not**
  synthetic (`App.jsx` explicitly injects `governedOpportunitySource`'s Work-Order
  analogue, the real callable-backed source; the synthetic fixture module is
  structurally unimportable from production code, per its own header). The caveat
  resolves to: real data, but still a client-side composed projection, not a raw entity
  list either way.
- **No write actions on either surface** — both are read-only by design.
- **Verdict: COMPOSITE for both**, decisive reason: neither surface's dataset is "the
  contents of a collection" — each is a distinct client-side grouping/derivation over the
  same underlying `WorkOrder` documents `S-SVC-WORK-ORDERS` already lists in its raw
  form. A single list definition cannot express two different derived shapes from one
  source, and neither shape is the source's native row shape to begin with.

## 12. Control Tower / Service Operations — `/service-operations`

- **Reads two unbounded collections** (`fieldops_technicians`, `fieldops_wos`, both via
  plain `onSnapshot(collection(db, path))` with no limit) and fans the same snapshot out
  to **six** independent panel components (At Risk, Dispatch Queue, Overloaded
  Technicians, Activity Timeline, Parts Overview, Work Order Attention), each computing
  its own derived signal client-side. This fan-out is an enforced architectural
  invariant in the file itself (no panel may read Firestore directly or inline its own
  scoring).
- **No write actions in this component** (its own header states so explicitly); the
  panels it composes link out to `WorkOrderDetail`/`WorkOrderActions`, which do carry
  transition affordances, but those are separate components.
- **Verdict: COMPOSITE / dashboard**, confirms the ledger's existing `D_DASHBOARD_ANALYTIC`
  classification. Decisive reason: multi-collection fan-out into six independently
  computed panels is dashboard composition, not a list, regardless of the write
  question. Both underlying reads being unbounded is a separate, real defect
  (bounded-read remediation, already named in the ledger) independent of this
  reclassification question.

## 13. My Dashboard — `/dashboard`

- **The admin/dispatcher path reads nothing.** `DashboardIndex` (`App.jsx`) is a static
  grid of five `<Link>` cards to other routes (`LANDING_AREAS`) — no Firestore query, no
  callable, no data of any kind.
- **The technician path is a different, real component** (`TechnicianDashboard.jsx`),
  reading a technician-scoped, assignment-filtered Work Order set via
  `useCurrentTechnician`/`useAssignedWorkOrders` — genuinely bounded by construction,
  unlike Dispatch's unfiltered listener.
- **Verdict: MISLABELLED, for the admin/dispatcher path.** The ledger records this
  surface as `D_DASHBOARD_ANALYTIC`, `BLOCKED_DEPENDENCY`, sharing the same
  "authoritative aggregate" dependency as `S-DASH-OPERATIONS`. The code disagrees: the
  admin/dispatcher view has no data dependency of any kind to be blocked on — it is
  navigation, already fully built, with nothing outstanding. The recorded blocker
  describes a surface that doesn't match what's actually rendered at this route for two
  of three roles. (The technician path is a legitimately separate, already-bounded
  dashboard and isn't in question here.)

## 14. Inventory & Supply Overview dashboard — `/dashboard/operations` (and `S-DASH-OPERATIONS-SCALE`)

- **Reads eight-plus collections, unbounded, one-shot, in parallel**:
  `inventory_transactions`, `stock_locations`, `warehouses`, `transfer_orders` (via the
  same `fetchTransferOrderDocs` named in `X-TRANSFER-ORDERS-UNBOUNDED-READ`), `suppliers`,
  `supplier_catalog`, `purchase_orders`, `fieldops_technicians`, plus two further
  analytics aggregation calls. Every one of the shared fetchers is built on an explicitly
  unbounded `listCollection()` helper.
- **This is deliberate and documented, not an oversight**: `operationsQueries.ts`'s own
  header states that bounded `listCollectionPage` variants exist for list surfaces
  (Warehouses/Suppliers/Transfers) but the dashboard "keeps the unbounded fetcher and
  stays recorded as blocked on an authoritative aggregate" — because it nets raw ledger
  rows into `availableStock`/reconciliation/consumption totals, a computation a bounded
  page cannot do correctly (a page of 25 transactions doesn't net to a true available
  quantity).
- **No write actions anywhere in the file** — confirmed by its own header ("no 'assign,'
  'dispatch,' or 'act on this job' affordance anywhere, and never will").
- **Verdict: COMPOSITE / dashboard**, confirms the ledger's existing classification and
  its own stated blocker exactly (`X-INVENTORY-ANALYTICS-AGGREGATE`, already
  `BLOCKED_PROTECTED` pending an Owner decision on a governed per-part projection). No
  new finding here beyond confirming the recorded reasoning matches the current code.

## 15. New Work Order wizard — `/service/work-orders/new` (stale-block finding, not a reclassification)

- **The ledger's recorded blocker is stale.** `S-SVC-WO-NEW`'s next action reads
  "Bounded-read remediation: it reads the whole accounts collection." The current code
  reads `accounts` through `useAccountPicker()`, which is explicitly bounded, ordered,
  and truncation-disclosed:
  `query(collection(db, ACCOUNTS_COLLECTION), orderBy("name"), limit(cap + 1))`, cap 200.
  The hook's own header names the Work Order wizard as one of three surfaces it was
  built to fix, alongside the Opportunity form and Equipment Register. The unbounded
  read this blocker describes has already been remediated at this exact call site —
  most likely by `A-BOUNDED-READS`/`A-BOUNDED-READS-REMAINING`, both already merged.
- **This surface was never classified `A_ENTITY_LIST`** — it's `F_UTILITY_EXEMPT`, a
  create wizard with a governed `createWorkOrder` write, composing a bounded `accounts`
  picker with a `locations` lookup. That classification is correct and isn't in
  question. What's stale is only the recorded reason it's still `BLOCKED_DEPENDENCY`.
- **Not reclassified** in the four-way taxonomy above since it was never mistakenly
  called a list. Recorded here because the controller should reconcile or re-point this
  block the same way `S-CRM-OPPORTUNITIES` needs re-checking against
  `X-INDEX-SURFACE-CALLABLE-READ` — the "stale blocks" section at the top of LEDGER.md
  exists precisely for findings of this shape, and this one wasn't yet on that list.

---

## Summary table

| Surface | Real classification | Decisive reason | What would unblock it |
|---|---|---|---|
| S-SVC-JOB-ASSIGNMENTS | MISLABELLED | Reads the identical `fieldops_wos` collection through the identical hook as the already-merged Work Orders list; no distinct entity, no writes, no filter. It's a duplicate route, not a surface. | A product decision to retire the route (recommended) rather than migrate a second definition onto the same entity. |
| S-ADM-SAVED-REPORTS | COMPOSITE | Owns 4 governed CRUD write actions (create/rename/duplicate/delete); read is `CALLABLE`-only, per-owner-scoped — Rules deny direct client reads of `reportDefinitions` unconditionally, so no list definition has a collection to declare against. | Not migratable as a list by construction — the metadata program would need a CRUD/action-surface pattern distinct from the list runtime, if one is ever wanted here. |
| S-INV-PART-MASTER | COMPOSITE | Owns 3 governed write actions with optimistic-concurrency (`create`/`update`/`changeStatus`); read is also fully unbounded with zero truncation disclosure. | Not migratable as a list while the write actions live on this surface; the unbounded read is a separate, real defect regardless. |
| S-INV-EQUIPMENT | COMPOSITE (workspace) — its default tab is the closest LIST candidate found | The `/equipment` route is 3 tabs: a clean bounded/cursor-paginated read-only list (Customer Equipment), an unconnected stub (Available Equipment), and a create-write form (Add Equipment). The workspace as a whole can't be one list; the default tab alone plausibly could be. | A scoping decision to redraw the surface boundary to the Customer Equipment tab alone (owner/product call, not a leaf's). |
| S-COM-RECEIPTS | COMPOSITE | Reuses the exact same `reorder_requests`+`reorder_purchase_orders` join and view-model already declined for Purchase Orders — same "authoritative status lives on the other collection" defect, just pre-filtered to RECEIVED. | Same as S-COM-PURCHASE-ORDERS: not migratable as a single-collection list by construction. |
| S-ADM-USERS | BLOCKED | The only real directory read (`users`, bounded) is scoped to one specific action (credential-reset eligibility) and sits behind a capability that is `active: false` everywhere; no general-purpose Users list read exists. | A new, general-purpose, unscoped Users directory read, plus activation of the gating capability — reusing the eligibility-scoped read would misrepresent the audit trail. |
| S-ADM-ROLES | BLOCKED | Zero reads of any kind exist — the page is a static local constant rendered into a permanently-disabled form. | A trusted Role/Permission directory read must be built and shipped before there's anything to migrate. |
| S-CRM-OPPORTUNITIES | COMPOSITE | Owns 2 governed lifecycle writes (`createOpportunity`, `transitionOpportunity`) with contextual section-level editing as a stated design goal — same class as Dispatch Queue, independent of its runtime plumbing gaps. | Not migratable as a list while it's an editable operating workspace; separately, `callableListSource.js` needs an unscoped-callable mapping and the declared column set needs the `nextAction`/reference-resolution gaps closed if any read-only sub-view is ever split out. |
| S-SVC-DISPATCH-QUEUE | COMPOSITE (confirmed) | Owns a governed `Dispatch` lifecycle-transition write across two collections (`fieldops_wos` + `fieldops_technicians`), server-arbitrated for contention. | Not migratable as a list by construction; both underlying reads are also unbounded, a separate defect. |
| S-SVC-COORDINATED-VISITS | COMPOSITE (confirmed, synthetic caveat resolved) | No distinct collection exists — it's a client-side grouping of `fieldops_wos` documents by `salesOrderId`, fed from a real (non-synthetic) bounded callable. | Not a list by construction — its dataset is a derived grouping, not a collection's native rows. |
| S-SVC-COORDINATED-MISSION | COMPOSITE (confirmed, synthetic caveat resolved) | Same underlying read as Coordinated Visits, projected one level further into a per-visit "field mission" shape. | Same as Coordinated Visits. |
| S-SVC-CONTROL-TOWER | COMPOSITE / dashboard (confirmed) | Two unbounded collections fanned into six independently-computed panels — dashboard composition, not a list. | Not a list by construction; bounded-read remediation on the two underlying reads is a separate, already-named task. |
| S-DASH-MY | MISLABELLED | The admin/dispatcher path (2 of 3 roles) reads nothing at all — a static nav-card grid — but is recorded as blocked on the same "authoritative aggregate" dependency as the Operations dashboard, which it has no relationship to. | Correcting the ledger's recorded blocker to match the code; no aggregate is needed because no data is read. |
| S-DASH-OPERATIONS / -SCALE | COMPOSITE / dashboard (confirmed) | Reads 8+ collections unbounded by deliberate design (netting raw ledger rows into availability/reconciliation figures a bounded page can't compute correctly). | Matches its own recorded blocker exactly: Owner decision on a governed per-part availability projection (`X-INVENTORY-ANALYTICS-AGGREGATE`). |
| S-SVC-WO-NEW | *(not reclassified — already correctly F_UTILITY_EXEMPT)* | Recorded blocker ("reads the whole accounts collection") is stale — `useAccountPicker()` already bounds this read (cap 200, disclosed). | Reconcile the stale next-action text; the underlying create-wizard classification was never in question. |

## What could not be established

- Whether `S-ADM-USERS`'s inert "Set user status" action has *any* planned governed
  directory read distinct from `listResetEligibleUsers`, or whether that decision hasn't
  been made yet — the code only shows it's currently missing, not what's intended.
- The exact PR/commit that fixed `S-SVC-WO-NEW`'s accounts read (most likely
  `A-BOUNDED-READS` or `A-BOUNDED-READS-REMAINING`, both merged) — `useAccountPicker.js`'s
  header names the wizard as one of three surfaces it replaced but doesn't cite a PR
  number, and this audit's writeScope doesn't include `git log` archaeology beyond
  confirming current source state.
- Whether the Equipment workspace's tab boundary (Customer Equipment vs. the other two
  tabs) has ever been discussed as a scoping question anywhere in prior program
  decisions — this audit found no record either way.

## Four most consequential findings

1. **The Transfers/Purchase-Orders/Parts pattern generalises exactly as predicted, and
   this pass found no exception.** Every newly-audited `A_ENTITY_LIST`-tagged surface
   (Job Assignments, Saved Reports, Part Master, Equipment, Receipts) turned out to be
   COMPOSITE or MISLABELLED, not LIST. Combined with the four already-declined surfaces,
   **zero surfaces classified `A_ENTITY_LIST` outside the four already-merged ones
   (Customers, Work Orders, Warehouses, Suppliers) survive contact with their actual
   code.** The burn-down should stop treating `A_ENTITY_LIST` as a queue of migratable
   work and start treating it as a label that needs re-verification per surface before
   any further attempt.
2. **Receipts is not a new problem — it's the Purchase Orders problem wearing a filter.**
   Same collections, same join, same view-model, same "status lives on the other
   collection" defect, just pre-scoped to RECEIVED. This is the cleanest confirmation in
   the audit that the underlying pattern, not the surface, is what's disqualifying.
3. **Coordinated Visits and Coordinated Mission's "confirm synthetic-source status"
   dependency resolves to a more interesting fact than a yes/no.** Production is
   confirmed real (not synthetic), but what's real is a *client-side composed
   projection* of Work Order documents — two different derived shapes from one source —
   never a distinct collection. This is a third variant on "the surface's authoritative
   state doesn't live where a list would look": not a governed write, not a
   cross-collection join, but a computed grouping with no native row shape of its own.
4. **The Equipment workspace shows the pattern's edge.** Its default tab is the single
   cleanest read-only, bounded, cursor-paginated, honestly-disclosed list found anywhere
   in this audit — better, on the truncation-disclosure axis, than several already-merged
   surfaces. It is disqualified only because the ledger's surface boundary bundles it
   with two tabs that aren't lists (a stub and a create form). This is worth a deliberate
   look: it may be the cheapest real LIST work available once someone decides whether
   `/equipment` as a route and "the Customer Equipment list" as a migration target are
   allowed to be different things.

## Recovery

None needed — this lane completed in one pass with no lost work.
