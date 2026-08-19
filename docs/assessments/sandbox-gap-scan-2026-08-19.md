# Sandbox gap scan — 2026-08-19

**Status:** analysis only. Nothing here was fixed, deployed, or authorized. This is a prioritized
list for Owner triage, produced by five read-only scouts against `eos-platform-sandbox` at Hosting
`0884e480` / 84 Functions / 38 indexes, immediately after the metadata-program sandbox promotion
closed (`docs/orchestration/metadata-program/sandbox-promotion-package.md` §15).

Findings already carried as promotion follow-ups are marked **[tracked]** and are restated here only
because the scan quantified them.

## Method and its limits

Five lenses, run in parallel, each forbidden from writing: deployed-callable surface vs client
consumers; metadata definitions vs mounted surfaces; live Firestore data integrity; authorization,
capability and Rules coverage; and a live behaviour sweep of read callables across four personas.

What this scan did **not** cover, so the gap is visible rather than implied:

- **62 of 84 callables were never invoked** — every name implying mutation was skipped by rule.
  Their behaviour is therefore unverified live; only their source was read.
- **No UI was driven.** Whether an affordance actually reaches the callable behind it is unverified;
  only transport-level names were matched.
- Deployed function *source* was not hash-compared against the branch — only exported names were,
  and those match exactly.

## HIGH

### H1 — Every Opportunity renders with a blank name and blank reference number

8 of 8 live `opportunities` documents lack both `name` and `opportunityNumber`.
`opportunityReadService.ts` frames a null here as "this record predates identity" — a rare legacy
case. It is universal.

Two distinct causes, and the second is the interesting one:

- `opportunityCommands.ts`'s `CreateOpportunityInput`/`BuiltOpportunity` have **no `name` field at
  all**. No code path in this repository ever writes one, so no amount of reseeding fixes it.
- `opportunityNumber` **is** allocated by `persistCreatedOpportunity` on every governed create — yet
  all 8 documents lack it. Those records were therefore written **outside the governed path**, which
  is worth understanding independently of the blank field.

### H2 — `stock_locations` and the governed ledger disagree about on-hand stock

For `PRT-1001`: `stock_locations` bin total is **0**, while the ledger computes **3** governed on
hand (`RECEIVED 4 + TRANSFER_IN 5 − TRANSFER_OUT 5 + ADJUSTED −1`). Net reservation is 2.

This reconciles two figures that looked contradictory during triage. Both were correctly computed:

    getInventoryAnalytics:  binTotal(0) − netReserved(2) = -2
    ledger-derived:         governed(3) − netReserved(2) = +1

The negative available stock recorded as a promotion follow-up **[tracked]** is a *symptom*. The
defect is that the physical-bin source the analytics callable reads is out of sync with the ledger
that is supposed to be authoritative. Fixing the sign without reconciling the sources would hide it.

### H3 — Five Work Orders reference a Sales Order that does not exist

`fieldops_wos` documents `wo-c713-1` … `wo-c713-5` carry `salesOrderId: "so-harbor-c713"`. No such
document exists in `sales_orders` (14 documents, all generated ids). `coordinatedVisitReadService`
and `getSalesOrderContext` resolve these five to not-found.

### H4 — `invoice.index` would throw for the first user who opens it, and the validator built to prevent that cannot see it

`invoiceEntity` declares `readCallable: "listAccountInvoiceAr"`; `invoiceIndexList` declares none and
silently inherits it; `callableListSource.js` has never registered that name, so
`fetchPage` throws `no known response mapping for readCallable`.

The sharper half: `listViewDefinition.js`'s validator — whose own comment says it exists to catch
"naming a callable callableListSource.js has never heard of ... caught here instead of at the first
user who opens the list" — is wrapped in `if (def.readCallable)`. It only checks a list view's own
override and never the inherited entity callable. **The guard is blind to exactly the case it was
written for.**

## MEDIUM

### M1 — The technician's entire operational grant set is unsatisfiable by construction

Nine `TECHNICIAN_ROLE` permissions (`reorder.request.*`, `inventory.transaction.read`,
`inventory.action.read`, `inventory.catalog.read`) are conditioned on
`{ kind: "operationalRoleActive" }`, and no callable in the repository ever supplies a populated
condition context. Every one resolves DENY for every technician regardless of their actual Parts
Manager / Warehouse Manager assignment.

This is a third denial class that is **indistinguishable from the other two from outside**: not
denied-because-inactive, not denied-because-the-role-lacks-it, but denied-because-the-condition can
never be satisfied. It locates the long-standing "`operationalRoleActive` repo-wide unexercised"
open question at a specific file and set of permissions.

### M2 — Eight governed Roles can never be granted to anyone, including `owner`

`GOVERNED_BUSINESS_ROLES` declares 15 Roles; `trustedWriterCommands.ts` builds a grantable set of 10,
and both `grantRole` and `assignApprovedRole` throw `UnknownRoleError` for the rest. The excluded
eight — `generalEmployee`, `officeManager`, `salesManager`, `accountingManager`, `financeManager`,
`fieldManager`, `operationsManager`, `owner` — are fully specified permission bundles that cannot be
conferred on any principal in any environment. The admin UI offers fewer still. Acknowledged in
source comments; unchanged since the prior audit.

### M3 — Admin has *less* CRM access than dispatcher

Live, same `accountId`: dispatcher `200`, admin `403` on `getCrmActivities`, technician `403`.
`crm.activity.read` is sandbox-activated, but activation only lifts the catalog block — a Role grant
is still required, and the admin persona's assignments lack it. Worth confirming whether that is
omission or design, because the resulting shape reads as a bug to anyone testing.

### M4 — Sales Order timestamps are null on 14 of 14 records **[tracked]**

`salesOrderReadService.ts` projects `createdAtMillis`/`updatedAtMillis`; the write path explicitly
destructures those out and stores `createdAt`/`updatedAt` server timestamps instead. Quantified here:
every live record. Precondition already recorded — correct this **before** any surface consumes
those fields.

### M5 — Text-query operators are validated as executable and are not

`listViewDefinition.js` declares that `FIRESTORE_NATIVE` can serve `TEXT_EXACT`/`TEXT_PREFIX` and the
validator accepts that combination; `firestoreListSource.js`'s operator map has no entry for either,
so the runtime throws on first use. Inert today — no definition uses them. The validator's
acceptance is itself the false promise.

### M6 — 23 callables carry headers stating they are not deployed

Each says some form of "NOT deployed ... until a separate Owner authorization". They **are** deployed
to `eos-platform-sandbox` today, which is correct under the per-environment activation program — but
the comments now misinform anyone reading them to decide what is live.

### M7 — Two callables are unconsumed with no ahead-of-UI note

`detectInventoryEffects` and `getInventoryAnalytics` sit among consumed Work Order Engine callables
and carry none of the "EXPORT != DEPLOY" boilerplate that marks the other 23 as deliberate seams.
They need a keep-or-cut decision rather than an assumption either way.

### M8 — Eleven collections a read service targets are entirely empty

`crm_activities`, `equipment_models`, `equipment_part_compatibility`,
`equipment_compatibility_sources`, `manufacturers`, `purchase_orders`, `payments`, `refunds`,
`sales_territories`, `commercial_coverage_assignments`, `supplier_catalog`. Expected for capabilities
still ungranted, but it means those screens cannot be visually verified against real data.

## LOW

- **L1** — `savedView.kind` (`STATIC`/`RECENTLY_VIEWED`/`MINE`) has no runtime consumer anywhere, and
  unlike the unmounted index lists, no comment acknowledges it. Every list declaring `savedViews` is
  declaring UI nothing renders.
- **L2** — An operational-record section vocabulary (`LIFECYCLE`, `READINESS`, `BLOCKERS`,
  `NEXT_ACTIONS`, `CUSTODY`) is declared, validated and enforcement-gated, with zero consumers; only
  one PageDefinition exists in the app and it is `RECORD` mode.
- **L3** — Column `width` is accepted and stored by `makeColumn`, read by nothing, set by nothing.
- **L4** — The `usernames` domain module is fully built and tested with zero I/O anywhere and no
  Rules block. Self-documented as future work.

## Verified clean

These were the likeliest places for live breakage and none was found:

- **84 exported = 84 deployed**, exact parity in both directions.
- **No client call site targets an undeployed callable** — including the generic-typed
  `httpsCallable<T1,T2>(...)` form a naive grep misses.
- **88 live calls** (22 read callables × 4 personas): **zero 500s, zero unauthenticated 200s, zero
  leaked stacks, paths, Firestore statuses or project ids.**
- Permission-catalog mirrors byte-identical; all 27 sandbox activation overrides name real
  capabilities; no callable checks a capability the catalog does not know.
- No orphan `accountId`, `ownerEmployeeId`, `customerId` or part references (0 across
  `sales_orders`, `opportunities`, `fieldops_wos`, `invoices`).
- `getWorkOrderFieldContext` correctly technician-only: technician 200, dispatcher and admin 403.

## Not defects — authority that exists on paper and cannot be exercised

`coverage.*`, `report.*` field-level ids, `equipment.compatibility.*`, `equipment.model.manage` and
`admin.credentialReset.initiate` are `active:false` with no activation path, each documented as a
deliberate later decision. Listed so the inventory is complete, not as work.

M1 and M2 belong in this category by intent and in the HIGH-adjacent category by effect: the
authority is real, documented, and unreachable. That is a decision to revisit, not a bug to patch
blindly.

---

# Wave two — write paths, client wiring, Rules

Three further lenses, each given this document and told to skip anything already in it. Two came back
clean; one produced the most consequential findings of the scan. Same read-only mandate; the
write-path lens was additionally forbidden from invoking anything at all.

All four findings below were **spot-verified independently** before being recorded here — one of them
turned out to be twice the size the scout reported.

## HIGH

### H5 — The busiest write surface in the product is invisible to the access model

The Work Order Engine (`createWorkOrder.ts:110`, `updateWorkOrderExecutionData.ts:94`,
`completeAssignedJob.ts:215`) and all nine Truck Registry callables
(`truckRegistry/truckRegistryCommands.ts:137-143`, plus an inline `role !== "admin"` at line 431)
authorize with **ad-hoc role comparisons** rather than resolving a capability through the catalog.
`transitionWorkOrder.ts` layers its own bespoke permission matrix on top.

Consequence: `resolveEffectiveAccess` — and anything built on it, including any future audit tooling
— cannot answer "who may mutate `fieldops_wos`". Every Work Order create, transition and
execution-update is outside the model that is supposed to describe authority.

This exact normalization was already performed once, for `getInventoryAnalytics`
(`permissionCatalog.ts:394` documents it), so there is a precedent to follow rather than a design to
invent. The Truck Registry case is stated as a design choice in its `index.ts` header, but not framed
as a deliberate catalog exemption — it needs an explicit decision either way.

### H6 — `allocateSalesOrder` has no audit trail and no idempotency contract

Verified directly: **0** occurrences of `stageAudit` / `idempotencyKey` / `mkAuditId` in
`fulfillment/allocateSalesOrder.ts`, against **20** in its sibling `salesOrder/salesOrderCallables.ts`.

Every other callable in the Sales→Cash spine — `createSalesOrder`, `transitionSalesOrder`,
`createSalesOrderFromOpportunity`, `issueInvoice`, `applyPayment`, `recordRefund`,
`recordInvoiceAdjustment` — requires an idempotency key, derives a deterministic audit id from it,
and stages the audit event in the same transaction as the write. This one does none of that.

Consequences, in order of seriousness:

1. **No record of who allocated what quantity, or when** — on the collection Finance later invoices
   against.
2. **Replay safety rests on transaction conflict alone.** The write is safe against concurrent
   double-submits, because Firestore optimistic concurrency re-reads `allocatedQty` on retry — but
   there is no deterministic-id replay guard, so unlike every neighbour, the guarantee is a property
   of the storage engine rather than an explicit, testable contract.

## MEDIUM

### M9 — Work Order state transitions are almost entirely unaudited

`transitionWorkOrder.ts` contains exactly **one** `stageAuditEvent` call site (line 321), inside the
Sales-Order fulfillment write-back branch. Schedule, Dispatch, Cancel, Hold and
Complete-without-an-SO-link all write `fieldops_wos.status` with no audit event.

`createWorkOrder.ts` stages an audit event only when the caller supplies an **optional**
`idempotencyKey` (line 135) — and per the file's own comment, the deployed client does not send one
by default. So the ordinary path creates a Work Order with no audit trail at all.

The most heavily used state machine in the application has no reconstructible history, in contrast to
every catalog-gated surface reviewed, which audits every applied write.

### M10 — 26 sites convert a capability-resolver failure into a silent denial

The scout reported "~13"; a full scan of `functions/src` found **26** catch blocks that set
`allowed = false` with no logging of any kind. They span finance, opportunity, sales order, coverage,
CRM activity, fulfillment, serialized asset, location display, manufacturer, account portfolio and
`setWorkOrderPartsPlan`.

Failing closed is correct and is consistently documented ("a throwing resolver is a denial, never an
allow"). The defect is diagnostic, not behavioural: a malformed catalog entry, a Firestore transient,
or a genuine bug inside `resolveEffectiveAccess` is **structurally indistinguishable from a
legitimate permission denial** to anyone operating the system.

This is the same mechanism that made the `getInventoryAnalytics` 500 undiagnosable until Cloud
Logging was read directly — a masked catch is why a live failure left no usable trace. A single
`console.error` inside each catch closes it while **changing no authorization outcome**.

## Corrections to this document

**The Rules-deployment risk is not currently real, and was checked rather than assumed.** The live
sandbox ruleset was retrieved through the Firebase Rules REST API — release
`cloud.firestore` → ruleset `c238f983-59aa-4e77-a506-52108366087d`, `updateTime 2026-08-16T08:13:41Z`
— and byte-diffed against `git show origin/main:firestore.rules`: **identical**, SHA-256 `4605a7f0…`.
Dual-copy parity also passes.

A local diff appeared at first and was correctly diagnosed as CRLF-vs-LF from the Windows checkout,
not content drift. Worth recording, because that artifact would otherwise read as drift on any future
Windows check.

## Verified clean in wave two

- **Client UI wiring.** No empty or no-op handlers, no unexplained permanently-disabled controls, no
  nav→route or route→nav mismatches, no form dropping a collected field, no spinner without an error
  branch, no placeholder or lorem data. One suspicious case — two nav entries sharing
  `legacyKey: "fieldMode"` — was chased down and resolves to two intentional projections of the same
  data.
- **Rules vs surfaces.** Every `readVia: "CLIENT_DIRECT"` entity has a matching `match /` block scoped
  consistently with its declared audience; no client-direct read targets a deny-all collection; no
  `readVia: "CALLABLE"` entity is read directly anywhere in the client; no
  `allow read: if request.auth != null` on business data; no dead rule blocks (the deny-all ones are
  consumed server-side through the Admin SDK by design).

Both null results are recorded as findings in their own right. A lens that returns nothing after
checking the right things is evidence, and the alternative — padding a list to look productive — is
worse than useless on a document meant to drive triage.

## Coverage limits, restated for wave two

- The write-path lens reviewed **~24 of 62** callables in depth and named the ones it did not: the
  Part Master / Supplier / Manufacturer / PartSupplierItem catalog family (11, spot-checked only at
  their shared `requireCapabilityOrAudit` call sites), the six Saved-Definition CRUD callables, and
  `runReportDefinitionCallable`.
- The client lens was static only. A runtime-only dead end — a callable failing under specific live
  data, a CSS state hiding content, a race — is out of its reach and remains unverified. That is the
  same gap the outstanding Account-page UAT covers, and this scan does not substitute for it.
