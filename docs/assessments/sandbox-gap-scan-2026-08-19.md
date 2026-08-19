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
