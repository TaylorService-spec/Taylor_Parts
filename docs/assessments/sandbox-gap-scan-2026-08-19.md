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

---

# Wave three — whole-site sweep

Page-level scouts across every screen, then surface-type scouts (backend subsystems, Rules blocks,
test suites, hooks, shared UI, operator scripts, CI coverage), then persona scouts. Each was given
this document and told to skip what it already records.

Items marked **[verified]** were re-checked independently before being recorded.

## HIGH

### H7 — Discovering a serialized part is missing INCREASES its available stock **[verified]**

`inventoryService.ts` sums the ledger with `else if (t.type === "ADJUSTED") governed += t.quantity;`
and no `trackingMode` check. A cycle count records a missing SERIAL-tracked unit as
`ADJUSTED, quantity: 1` — SERIAL entries are forced to quantity 1 and cannot carry the negative sign
that would encode a loss. So finding a unit missing adds 1 to reservable availability.

Affects `getAvailableQuantity` (Work Order reservation) and `sumLedgerEligibleOnHand` (Sales Order
available-to-promise). The correct pattern exists three files away — `mobileLocationPresenceProbe.ts`
does `if (v.trackingMode !== "NONE") continue;` with a comment explaining why SERIAL custody must be
excluded. It was not applied here.

Related, same file: `RETURNED` and `SCRAPPED` are schema-legal ledger types that these two consumers
omit while three others include them. Dormant until an RMA or scrap command ships, at which point
those movements vanish from availability on day one.

### H8 — Two migration CLIs validate a project they never bind to **[verified]**

`warehouseGovernanceMigrationCli.js:123` and `warehouseBackupRestoreCli.js:113` both call bare
`admin.initializeApp()`. Both parse `--project`, require `--confirm-project` to match, gate execution
behind `--acknowledge-production-write`, and pin a content hash — then connect the Admin SDK to
whatever ambient credentials resolve to. Every gate validates a string the write never uses, while
presenting the operator with a careful confirmation flow.

### H9 — A seed script writes to production with no guard of any kind **[verified]**

`seedOperationsDemoData.js:22` — `initializeApp({ projectId: "taylor-parts" })` at module load. No
flags, no dry run, no confirmation, no emulator check. Compare `salesOrderNumberBackfillCli.js`,
which refuses before Firebase initialises unless `--environment sandbox` resolves the project from
the registry.

### H10 — A credited invoice permanently locks quantity on its Sales Order

`billedQty` is only ever incremented; nothing decrements it. A credit memo or write-off zeroes the
invoice balance but never touches the Sales Order, so an invoice issued in error and fully credited
removes that quantity from the billable pool forever. Re-issuing fails `QTY_EXCEEDS_ELIGIBLE`. The
customer was never charged and now cannot be billed properly; the only remedy is manual Firestore
surgery outside any governed path.

### H11 — The Sales chain cannot be walked past DECISION **[verified]**

Three facts compose: `NewOpportunityForm` never collects lines; the section-edit save path needs an
`onSaveSection` prop that `App.jsx:201` does not supply and no call site anywhere provides; and the
backend refuses `WON` without at least one line. So lines can never be added and "Mark Won" fails for
every Opportunity. Separately, `createSalesOrderFromOpportunity` has zero client call sites — a WON
Opportunity has no UI path to its Sales Order either.

### H12 — Work Order parts plans silently overwrite each other

`setWorkOrderPartsPlan` replaces the whole plan array with no `expectedVersion` baseline — the input
contract has no version field at all. A dispatcher saving from a stale draft resurrects a part
another dispatcher removed, with no conflict surfaced. The repo's own equipment-compatibility
commands already implement `expectedVersion`/`commandFingerprint`.

### H13 — Reporting is unreachable by every persona, and fails silently **[verified]**

Both Reporting nav items gate on capabilities only the `owner` Role carries. A live query returns
**10 active role assignments across 9 roles — none `owner`**, and `owner` is one of the eight roles
no grant path can confer (M2). `App.jsx` filters route generation by the same check, so routes are
never mounted, and because neither subnav uses `path === ""` the "not available to your role"
fallback never fires. `/reporting/builder` redirects to `/dashboard`, indistinguishable from a typo.

The same query settles M3 exactly: `crmActivityContributor` is assigned to one persona, not admin.

### H14 — Two hooks have no error channel at all

`useWorkOrder` and `useLocation` register no `onSnapshot` error callback, so a denied read never
resolves: the Work Order detail page spins on "Loading work order…" indefinitely with no recovery.
No consumer can fix this. That same page also drops `useAccount`'s `error` and `loading`, which the
hook does provide.

### H15 — Governed write paths whose tests CI never runs

`completeAssignedJob.ts` — a live callable — has a test file, and **no workflow references either**.
The `supplierMaster` subsystem has **13 test files wired to no workflow**. Also uncovered:
`reorderRequestNumbering`, `inventoryEffectCallables`, the client reorder domain modules, and
`field-ops-app-vite/src/auth/`.

The mis-filter pattern repeats too: `receiving-e2-verifier-tests.yml` exists to hash-verify the
Firestore rules and omits `firestore.rules` from its own `paths:` filter — the same shape as the
`firestore.indexes.json` gap that let the D4 breach through.

### H16 — A second, less careful `toMillis` reintroduces the bug its canonical twin exists to prevent

`schedulingWorkspace.js` defines its own `toMillis` alongside the canonical `timestampMillis.js`, and
the past-due attention projection imports the *former*. Two divergences: a `0` timestamp returns
`null` from the canonical helper (guarding exactly the "epoch read as a real date" regression it was
written to kill) but `0` from this one, so an unset `scheduledStart` emits a PAST_DUE item dated
1970; and string timestamps parse in the canonical helper but return `null` here, so a job can show a
correct date on its detail page while never appearing in the dispatcher's past-due list.

## MEDIUM (selected)

- **M11** — The reorder lifecycle has no callable and no audit trail; Rules enforce all nine
  transitions rigorously, but who did what survives only in mutable fields each transition overwrites.
- **M12** — Quantity integrity request → PO → receipt: a PO can be recorded for any quantity with no
  check against the approved request; no unit-of-measure field exists anywhere in the chain; receipt
  captures no quantity, so partial, over- and under-receipt are indistinguishable from a full receipt.
- **M13** — Creating supplier terms never verifies the supplier exists or is ACTIVE, and deactivating
  a supplier does not cascade, so a part can keep a `preferred: true` item pointing at a dead supplier.
- **M14** — `partId == SKU` is an observed data property, not an enforced invariant.
- **M15** — Warehouse reconciliation reports "No discrepancies" without ever running: its fail-closed
  guard fires whenever bin stock has a `warehouseId` and a ledger entry lacks one, and no ledger write
  ever sets that field — it is not on the type. Correct behaviour, dishonest message.
- **M16** — Allocation readiness is computed, stored, then discarded by both the read projection and
  the UI, so the page can never explain why something is not ready.
- **M17** — Technician availability is stale by construction: only `completeAssignedJob` writes
  `fieldops_technicians.status`; `transitionWorkOrder` never does.
- **M18** — `mapCommandError` is untested in every finance/salesOrder/opportunity write callable, so
  the client-facing error contract ships unverified the day any grant activates.
- **M19** — The `readCallable` validator still only covers the list-view override, never the
  inherited-from-entity path.
- **M20** — Work Order status renders three incompatible ways, and "Active" names a 5-status set on
  one screen and a 1-status set on another, so the same technician shows different counts.
- **M21** — A technician created in the UI has no `employeeId` or `uid` link and no in-app way to get
  one; dispatchers can assign them work nobody can act on.
- **M22** — The legacy `fieldops_jobs` write path is unreachable from the UI but still armed in code
  and Rules, bypassing governance if ever re-imported.
- **M23** — Blind-count integrity is defeated: Cycle Counts shows "Expected: N" above the count input.
- **M24** — Free-text notes are lost without warning on navigation in Field Mode and the technician
  dashboard. Quantity edits are safe — each is an awaited callable.
- **M25** — `LoadingEmptyState` has no failure state, so seven consumers render permission-denied as
  "empty". Its sibling `MetadataListGrid` routes DENIED and UNAVAILABLE correctly — the pattern exists.
- **M26** — Transfer and cycle-count commands are the stated reference implementations for
  transactional safety and have **no concurrent-writer test at all**; the Work Order concurrency suite
  shows what that test should look like.
- **M27** — PARTS_MANAGER holds a reorder-creation grant in Rules with no UI to exercise it, and the
  WAREHOUSE_MANAGER warehouse-scoped read grant has no consumer or route at all.

## Verified clean in wave three

- **No privilege escalation exists in the identity Rules**, and none in the server-side access core
  either — the permission resolver fails closed at every layer, activation overrides have no caller
  seam, actor identity is always `request.auth.uid`, and `auditEvents` is unwritable by any client.
- **No pre-authentication exposure**: no source maps deployed, the Firebase web config is correctly
  public, zero Web Storage usage, no self-signup or access-request surface, and a no-role user gets an
  honest denial distinct from a failed identity read.
- **Finance arithmetic is sound** — integer minor units throughout, no float or rounding,
  over-application and negative balances blocked, all four money writes transactional.
- **The Part Master / Supplier family satisfies all six write guarantees**; its gaps are referential.
- **Equipment-compatibility mirror parity is genuinely tested**, not merely claimed.
- **Modal, ConfirmDialog and MetadataListGrid** are exemplary and should be the pattern others follow.
- **Client UI wiring** and the **inventory/warehouse Rules blocks** each came back with no defects.

## Coverage limits

Several persona scouts were still running when this was written. The write-path review has covered
roughly half of the 62 mutating callables in depth. No UI was driven in any wave — every finding is
static or read-callable evidence, so runtime-only defects remain out of reach, which is what the
outstanding Account-page UAT covers.

## Correction to H1 — the Opportunity records did NOT bypass the governed path

H1 states that because `opportunityNumber` is allocated on every governed create yet all 8 live
records lack it, "those records were therefore written **outside the governed path**." **That
inference was wrong.**

Verified: `allocateOpportunityNumber` was introduced in commit `3fdf1ccf`
(*feat(sales): Opportunity reference numbering (OPP-YYYY-######)*, #1120) on **2026-08-17**. The 8
live Opportunities were created between **2026-08-14T18:38Z and 2026-08-14T20:07Z** — three days
earlier. They were fully governed when written; the field did not exist yet.

No seed script writes to `opportunities` at all: the collection appears in no seed, no fixture spec,
and no manifest. The only writer in the repo is the governed `createOpportunity` callable.

**The real defect is a process gap, and it generalises.** Sales Order numbering shipped with a
backfill CLI, a runbook and a CI workflow. Transfer/Receiving/Reorder numbering shipped with
`backfillOperationalNumbering.mjs`. Opportunity numbering shipped with **no backfill tool at all**,
so its legacy records have no remediation path and nothing flagged it until this scan.

The rule worth adopting: when a numbering or audit field is added to a governed create path, its
backfill ships in the same PR or is explicitly recorded as deferred debt.

The `name` half of H1 is unaffected and stands — no write path for it has ever existed.

**H3 is likewise deliberate, not accidental.** `seedSandboxCoordinatedInstall.js:142` sets
`salesOrderId: "so-harbor-c713"` on the five Work Orders, and the file's own header explains the
choice: a set of Work Orders sharing one `salesOrderId` *is* the coordinated group, and seeding a
real Sales Order was rejected as dishonest while the Sales-Order-linked capabilities were undeployed.
That premise has since changed — `salesOrder.read` is now granted and its read UI is live — so this
needs an Owner decision rather than a bug fix: seed a minimal governed Sales Order, or have the read
services treat an unresolvable `salesOrderId` as "ungrouped" rather than a dangling reference.

## Correction to the M6 class — a grant-state comment, not just a deploy-state one

Four files state that `inventory.stock.receive` is "REGISTERED BUT UNGRANTED" and "denies every
principal": `index.ts:181`, `permissionCatalog.ts:875-879`, `receivingCallableWiring.ts:3-4`, and
`receivingCallables.ts:3-4`.

It has been granted to admin, dispatcher and owner since **2026-08-06** — `compatibilityRoles.ts:79-86`
grants it directly, DECISIONS #65 and #68 record the ratification, and both
`receivingReadiness.js` and `SYSTEM_AUTHORITIES.md` already describe the correct state (grant done;
the client transport flag remains gated separately).

This is sharper than the rest of the M6 class: those comments misstate *deployment*, these misstate
*authorization*. The two most natural files to check when asking "can an admin receive stock?" both
answer no, and both are wrong.

## Persona walks — what each role actually experiences

Four persona scouts walked the whole product as one role each, live-verifying authorization with read
callables. Two of them corrected earlier findings in this document.

### The technician's day works end to end

Assignment → travel → arrive → capture → consume parts → complete is reachable and correctly scoped.
Live-verified as the technician persona: their own scoped Work Order query returns 10 documents, the
unfiltered collection read returns 403, and every other business collection returns 403. No
over-exposure anywhere.

**This corrects M1's scope, again.** Probing `resolveEffectiveAccess` as a real ACTIVE technician
returns `false` for all four `operationalRoleActive`-gated capabilities — but **no
technician-reachable screen ever invokes them** (zero matches across the mobile, technicianDashboard
and jobs modules). M1's blast radius is the `/inventory-role/*` homes, which a base technician cannot
see, and those homes use the working Rules-side check anyway. M1 is real and should be fixed, but it
does not degrade the technician experience at all.

**H3 also does not propagate to the field.** All five `wo-c713-*` Work Orders resolve
`getWorkOrderFieldContext` cleanly, because that projection derives from the Work Order's own
`customerId`/`locationId` and never traverses the Sales Order.

### H17 — Coordinated Visits and Coordinated Mission are inert for every persona, including owner

`fulfillment.coordinatedVisit.read` is activated in sandbox but **granted to no Role anywhere**.
Activation only lifts the catalog block; a Role grant is still required. Live-verified 403 for
technician, dispatcher, admin **and owner**.

Two nav-visible destinations can therefore never show data — and unlike the sibling case in
`AvailableEquipment.jsx`, neither screen's copy tells the user this is expected. This is also the one
surface built to show a dispatcher a customer's whole coordinated obligation across Work Orders, so
its absence is the second half of why the Sales-Order-linked monitoring path is broken.

### H18 — Administration cannot administer

- The nav item labelled **"Employees" renders `Technicians.jsx`**, which writes `fieldops_technicians`
  — a legacy collection disconnected from the governed `employees`/access model. The only
  nav-reachable "add a person" affordance in the product creates a row that confers no Auth account,
  no Role and no application access.
- Enable/disable user and assign-role are both shipped permanently `disabled`.
- Password reset is gated on an inactive capability that the client never even requests (H-ADMIN-1).
- **No UI anywhere reads an audit event.** Permission Preview and Audit Logs are literal
  "unavailable" stubs, and a repo-wide search finds no other client consumer of `auditEvents`. So the
  audit records that *are* written — the Sales Order fulfillment write-back — are invisible too. "Who
  touched this and when" is unanswerable from the product for every object type, which compounds the
  audit gaps at H6, M9 and M11 rather than merely sitting alongside them.
- There is no admin-reachable path to correct data or void a mistake.

Every administrative action an admin might need is either wired to the wrong collection or disabled;
the only working path is the CLI.

### M28 — Two more capability asymmetries, both breaking "owner ≥ admin"

- **Owner is denied `getCrmActivities` too**, not just admin — `crmActivityContributor` is a
  per-persona role assignment outside the admin/dispatcher/owner composition, so owner's superset
  property does not hold for it. M3 is broader than recorded.
- **`workOrder.parts.plan` resolves true for dispatcher and false for admin** (live-verified). The
  parts-plan editor works for one and not the other, with nothing in the UI indicating why. Same
  shape as M3, second instance.

### M29 — Dispatcher blind spots and a doomed control

- **Create Transfer is enabled and wired for a dispatcher whose `inventory.transfer.create` resolves
  false** — the form fills, submits, and is rejected server-side.
- No screen tells a dispatcher whether parts are actually in stock before scheduling or dispatching a
  job, whether a technician is genuinely free beyond a three-value status, or that a Work Order's
  `salesOrderId` is broken.
- **There is no intake object at all** — no ticket or request entity precedes a Work Order; the chain
  begins at "create a Work Order".
- Three independent technician-status vocabularies and three independent work-order-status
  vocabularies are all dispatcher-visible; the same technician reads "Busy" on one board and "On job"
  on another.
- Control Tower's parts panel aggregates *planned demand*, not on-hand stock, and nothing labels it
  as such next to Inventory's on-hand figures.

### M30 — Operational-role gaps found by walking those roles

- **PARTS_ASSOCIATE genuinely cannot read `parts`** — settled, and it is documented intent (DQ-B1),
  not an oversight. The consequence is permanent: every reorder card shows raw part ids instead of
  names, for every associate, forever, until that decision is revisited.
- **PARTS_MANAGER holds a reorder-creation grant in Rules with no UI to exercise it** — the panel is
  rendered without the `onRequestReorder` prop its sibling passes.
- **The WAREHOUSE_MANAGER warehouse-scoped read grant has no consumer and no route** — that role can
  never see the warehouses it is scoped to.

## H19 — Four Work Orders already completed against a Sales Order that never existed **[verified]**

H3 recorded five Work Orders pointing at a non-existent `so-harbor-c713`. The consequence is worse
than a dangling reference, and it has already happened. Verified live:

    wo-c713-1  COMPLETED   PRT-1002 qtyUsed=1
    wo-c713-2  COMPLETED   PRT-1002 qtyUsed=1
    wo-c713-3  CANCELLED   PRT-1002 qtyUsed=0
    wo-c713-4  COMPLETED   PRT-1002 qtyUsed=1
    wo-c713-5  COMPLETED   PRT-1002 qtyUsed=1
    so-harbor-c713 exists: false

`transitionWorkOrder.ts:241-309` gates the entire Sales Order fulfillment write-back on
`if (soSnap.exists)`. When the Sales Order is missing, `soWriteBack` stays null and **the transaction
proceeds normally** — no error, no rollback, and no audit event, because the only `stageAuditEvent`
call in the file sits inside that same `if`.

So four completions consumed governed inventory against a Sales Order that does not exist, and left
**no record anywhere that the write-back was skipped**. This is not a future risk; it is
already-executed state that no replay can reconstruct, because the evidence of the skip was never
written.

It also answers the question M9 left open: a failed write-back does not roll back the completion. It
diverges silently.

## H20 — Dispatch can reassign a scheduled Work Order to a different technician, unchecked

`transitionWorkOrder.ts:205-224` writes `assignedTechId` from a caller-supplied value with **no check
against `wo.scheduledTechId`**, and never updates `scheduledTechId` to match. The dispatcher's
technician picker shows every available technician with no reference to who the job was scheduled for.

A dispatcher can Schedule for technician X and Dispatch to technician Y entirely through the shipped
UI, with no warning. The weekly scheduling board keys on `scheduledTechId` and keeps the slot
reserved under X; the technician board and dashboard key on `assignedTechId` and show it under Y.
Two technicians own the same Work Order on two governed surfaces.

Worse, `findScheduleConflict` ran once, at Schedule time, against **X's** calendar. Y's calendar is
never checked for that window, so the double-booking guard — which is otherwise rigorous, with a
per-technician transactional lock — is simply bypassed for the technician who actually gets the job.

## M31 — `completeAssignedJob` is a deployed, technician-invokable door back into the retired model

Its only client wrapper has zero importers, and so does its read hook. Both technician surfaces that
once used the legacy `fieldops_jobs`/`fieldops_technicians` pair were migrated to the governed Work
Order Engine. But the callable stays deployed and technician-invokable with a real write cascade into
both legacy collections — and it is the sole writer of `fieldops_technicians.status` (M17). A future
PR adding a caller would resurrect the parallel system F0/F1 retired, and the comments in
`WorkOrderActions.jsx` and `completeAssignedJob.ts` still describe that coexistence as current.

## Verified clean in the Work Order engine

The per-technician lock is correct: written only to force write-write contention inside the
transaction, never read as a gate, so an aborted transaction cannot strand a technician. `executionLog`
has a single writer, appends via `arrayUnion`, and stamps `at`/`byTechnicianId` from the authenticated
caller — it cannot be reordered, overwritten or misattributed. All 11 statuses are reachable, the only
trap states are the three intended terminals, and every status has a label.
