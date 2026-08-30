---
artifact_type: assessment
gate: Repository Assessment
status: Ratified
date: 2026-08-30
owner: Claude Code
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Assessment Report: EOS Ownership Model v1 — reconciliation

**Business Request:** Owner authorization "EOS OWNERSHIP MODEL v1" (2026-08-30). Approved
invariant: *every governed business record has an owner*; ownership is separate from Created By
and Assigned To; ownership never changes implicitly; every change is an explicit auditable
handoff; typed `owner.type` + `owner.id`, never display names.

The body of this document is **reconciliation only** — no code, Rules, Functions or schema were
changed to write it, and it records the repository as it stood before any ownership work. The
Owner's rulings and what they changed are in the **Addendum at the end**; read it before treating
any "Today" column here as current. Backfill and enforcement remain gated either way.

## Scope of this assessment

Inspected: every `match` block in `firestore.rules` (55 collections), every metadata entity
definition (`field-ops-app-vite/src/metadata/definitions/`, 34 files), every `functions/src`
module that writes an ownership-like field, the audit authority, the caller/person authority,
and every existing company-identity concept.

Not inspected: live Firestore data. No record counts, no unresolved-record census — that
requires a sandbox/production read, which is separately Owner-gated. **This is the reason
enforcement cannot be turned on from repository evidence alone** (see Gate 4).

## Current repository state — the ownership-like fields that already exist

Six distinct, *already-governed* concepts occupy ownership-adjacent space. None of them is
`owner.type` + `owner.id`. None may be silently replaced.

| # | Existing concept | Where it lives | What it actually means | Verdict |
|---|---|---|---|---|
| 1 | `accountOwner` | `field-ops-app-vite/src/domain/commercialProfile.js:206` (`isCompleteAccountOwner`), declared as `accountOwnerEmployeeId` in `metadata/definitions/account.js:319` | A **7-field Person Assignment map**: `assignedToEmployeeId`, `assignedToUserId`, `assignedToDisplayName`, `assignedByEmployeeId`, `assignedByUserId`, `assignedByDisplayName`, `assignedAt`. All seven or none — a partial record is rejected fail-closed. | **This is already an explicit, provenanced handoff.** It is the closest thing the platform has to the approved model, and it is *richer* than `owner.type`+`owner.id`. Do not delete it. |
| 2 | `ownerEmployeeId` | `opportunity.js:116`, `salesOrder.js:142`, `salesAgreement.js:90`; enforced in `functions/src/opportunity/opportunityCommands.ts:127`, `closeOpportunityAsWon.ts:402`, `createSalesOrderFromOpportunity.ts:295` | A canonical Employee reference. **Required and caller-supplied on create** — never inherited. | Person ownership already exists here, but the *inheritance* half of the approved invariant does not. |
| 3 | `currentOwner` | `firestore.rules` — ~15 enforcement clauses across `reorder_requests` (lines 211–956) | A **role queue**: `INVENTORY` / `PARTS_MANAGER` / `PARTS_ASSOCIATE`. Workflow custody, not record ownership. Paired with `assignedToUserId`. | **Naming collision only.** This is not ownership and must not be folded into it. Renaming it is a Tier-2 change against live-deployed Rules — do not. |
| 4 | `explicitTitleHolder` / `OWNERSHIP` | `field-ops-app-vite/src/domain/inventoryControlLifecycle.js:121`, mirrored `functions/src/fulfillment/inventoryControlLifecycle.ts:76` | `VENTANA` / `TAYLOR` / `CUSTOMER` / `UNKNOWN`. **Legal title** to a serialized asset. Its own axis, explicitly independent of control, custody and installation; absent fact ⇒ `UNKNOWN`, never derived. | An existing governed company-ownership authority. The new model must **resolve to it, never restate it**. |
| 5 | `ACCOUNT_LINE_OF_BUSINESS` | `field-ops-app-vite/src/domain/constants.js:143` | Optional, additive, **multi-valued** Account array (`TAYLOR`, `VENTANA`, or both). Informational, gates no authorization. | Not ownership. Its own comment already declares it "a FOURTH distinct concept". |
| 6 | `createdBy` / `createdByUid` / `actor` | ~30 modules (`receivingRepository.ts:136`, `cycleCountRepository.ts:71`, `opportunityCommands.ts:148`, …) | Actor UID at creation. Consistent, validated (`receivingRepository.ts:272` even cross-checks `createdBy === actor.id`). | Already correctly separate from ownership. The approved separation is *already honoured* here. |

### The finding that changes the plan

`operatingCompanyId` — the field the wireframes call "whose books this transaction lands in,
immutable once stamped" (`docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md:222`)
— **is stored nowhere.** It appears only in design docs and in negative-space comments
("no `operatingCompanyId`" — `salesOrderReadService.ts:16`). There is **no `companies`
collection** in `firestore.rules`.

Consequence: the approved invariant's company leg — *"Parts, Equipment, Inventory and other
company-owned records resolve ownership to the appropriate governed company authority,
including Taylor or Ventana"* — **has no authority to resolve to today.** Building one is not
duplicating an existing authority (rule 4 is satisfied), but it is a new governed authority and
therefore a material architecture decision, not an implementation detail. See Decision D-2.

## Ownership matrix

`owner.type` values proposed: `EMPLOYEE` (a person, by canonical Employee id) and `COMPANY`
(a governed operating company id). No third type is proposed — a role queue is custody, not
ownership.

**Legend — Transfer behavior:** *Explicit handoff* = auditable command, never implicit.
*Immutable* = historical; the record keeps the owner it was created with, forever.

### A. Commercial — person-owned

| Record family | Collection | Owner type | Inheritance source (NEW records) | Transfer behavior | Today |
|---|---|---|---|---|---|
| Account | `accounts` | EMPLOYEE | None — assigned at creation or later | Explicit handoff | `accountOwner` map exists |
| Contact | `contacts` | EMPLOYEE | Parent Account owner at creation | Explicit handoff; does **not** follow the Account | **Gap** |
| Location | `locations` | EMPLOYEE | Parent Account owner at creation | Explicit handoff | **Gap** |
| Opportunity | `opportunities` | EMPLOYEE | **Customer (Account) owner** — approved default | Explicit handoff; existing Opportunities do **not** move when Account ownership moves | `ownerEmployeeId` exists, required, **not inherited** |
| Sales Agreement | `sales_agreements` | EMPLOYEE | Opportunity owner | Explicit handoff | `ownerEmployeeId` exists, not inherited |
| Sales Order | `sales_orders` | EMPLOYEE | Opportunity owner | Explicit handoff | `ownerEmployeeId` exists, required, **not inherited** |
| Invoice | `invoices` | EMPLOYEE | Sales Order owner | **Immutable** — an issued invoice is historical | **Gap** |
| Payment / Payment Application / Invoice Adjustment / Refund | `payments`, `payment_applications`, `invoice_adjustments`, `refunds` | EMPLOYEE | Invoice owner | **Immutable** — financial events are historical | **Gap** |

### B. Service / operational

| Record family | Collection | Owner type | Inheritance source | Transfer behavior | Today |
|---|---|---|---|---|---|
| Work Order | `fieldops_jobs`, `fieldops_wos` | EMPLOYEE | Sales Order owner where one exists; otherwise Account owner | Explicit handoff. **Distinct from `assignedTechId`**, which stays assignment | **Gap** — only assignment exists |
| Reorder Request | `reorder_requests` | EMPLOYEE | Requester's Employee | Explicit handoff. **`currentOwner` is untouched** — role queue, separate axis | Partial (custody only) |

### C. Company-owned (resolve to the governed company authority)

| Record family | Collection | Owner type | Inheritance source | Transfer behavior | Today |
|---|---|---|---|---|---|
| Part / Part Alias / Part Supplier Item | `parts`, `part_aliases`, `part_supplier_items` | COMPANY | Company that owns the catalog | Explicit handoff (rare) | **Gap** |
| Manufacturer / Equipment Model / Compatibility | `manufacturers`, `equipment_models`, `equipment_part_compatibility`, `equipment_compatibility_sources` | COMPANY | Shared reference data | Explicit handoff (rare) | **Gap** |
| Supplier / Supplier Catalog | `suppliers`, `supplier_catalog` | COMPANY | Company holding the supplier relationship | Explicit handoff | **Gap** |
| Equipment (serialized asset) | `equipment` | COMPANY | Operating company that carries the record | Explicit handoff. **Record owner ≠ `explicitTitleHolder`** — see D-3 | `explicitTitleHolder` exists (title axis) |
| Warehouse / Stock Location / Mobile Location / Truck | `warehouses`, `stock_locations`, `mobile_locations`, `trucks` | COMPANY | Operating company | Explicit handoff | **Gap** |
| Purchase Order / Reorder PO / Void | `purchase_orders`, `reorder_purchase_orders`, `reorder_purchase_order_voids` | COMPANY | Buying company | **Immutable** once issued | **Gap** |
| Receiving Order / Transfer Order / Cycle Count | `receiving_orders`, `transfer_orders`, `cycle_counts` | COMPANY | Destination/owning warehouse's company | **Immutable** — operational events | **Gap** |
| Inventory Transaction / Inventory Action | `inventory_transactions`, `inventory_actions` | COMPANY | Owning warehouse's company | **Immutable** — ledger | **Gap** |

### D. Explicitly OUT of the ownership model

| Collection(s) | Why excluded |
|---|---|
| `users`, `employees`, `fieldops_technicians` | Person/identity authority — subjects of ownership, not objects |
| `permissions`, `roles`, `roleAssignments`, `accessRequests` | Access authority (Issue #226 platform), governed separately |
| `auditEvents` | Immutable audit authority; client-deny-all |
| `reportDefinitions` | Already has its own "private by owner" model (`firestore.rules:1583`) — a *platform* record, not a governed business record. Do not disturb |
| `sales_territories`, `commercial_coverage_assignments` | **Coverage is not ownership, credit, commission or security.** Folding coverage into ownership would collapse a distinction the register deliberately preserves |
| `counters`, `inventory_sync_status`, `location_truck_claims`, `equipment_compatibility_operations`, `technician_working_availability`, `technician_blocked_time` | Infrastructure, idempotency keys, or person-scoped scheduling — not business records |

## Decisions required before any code mutation

These are the points where two readings produce materially different systems. None can be
settled by this assessment.

**D-1 — Does `accountOwner` become `owner`, or project into it?**
`accountOwner` is a richer, already-fail-closed, already-provenanced structure. Two options:
(a) keep it as the Account's storage and expose a *derived* typed `owner` view; (b) migrate to
typed `owner` and demote the assignment provenance to the handoff audit event.
**Recommendation: (a).** It is non-destructive, honours rule 5, and the seven fields already
encode exactly the "explicit auditable handoff" the invariant asks for.

**D-2 — What is the governed company authority?**
None exists. `operatingCompanyId` is design-only; there is no `companies` collection;
`ACCOUNT_LINE_OF_BUSINESS` is informational and multi-valued, so it cannot serve. A governed
company registry must be created before *any* company-owned family in section C can be
populated. This is new architecture, not a field addition.

**D-3 — For `equipment`, is the record owner the operating company or the title holder?**
`explicitTitleHolder` can be `CUSTOMER`; a customer is not an operating company and cannot own
an internal record. **Recommendation: record owner = operating company; title stays its own
independent axis, unchanged.** Stating this explicitly is what stops a future reader from
"reconciling" the two into one field and destroying the D-1/D-2 Ventana title rulings.

**D-4 — Relaxing the required `ownerEmployeeId` inputs.**
`createOpportunity`, `closeOpportunityAsWon` and `createSalesOrderFromOpportunity` all *require*
`ownerEmployeeId` and reject an empty one. Implementing "Customer owner is the default owner for
NEW Opportunities" means making that input optional-with-inheritance — a contract change to
deployed callables. Confirm the callers may be relaxed rather than a new default being layered
above them.

**D-5 — Audit action vocabulary.**
The single audit authority is `functions/src/access/auditEventWriter.ts`, whose `AuditAction`
exists twice: the erased TS union (`functions/src/types/access.ts:192`) **and** the runtime array
(`auditEventWriter.ts:69`). A handoff action must be added to **both** — adding to only one
compiles cleanly and fails at runtime, a mistake this repo has already made once and documented.
Note `ScopeType` has no per-record value (`global`, `tenant`, `domain`, `location`,
`ownAssignment`); the existing `objectId` field added for reports is the right carrier, not a
new ScopeType.

## Risks

- **Rules surface.** Every enforcement clause is Tier 2 and `firestore.rules` is not
  auto-deployed — merged is not live. Enforcement must land behind the `verify-rules-deploy`
  checklist, and the dual-copy parity requirement applies.
- **Silent conflation.** Three separate collapses would each destroy governed distinctions:
  `currentOwner` into `owner`, coverage into ownership, `explicitTitleHolder` into `owner`.
  The matrix names all three so a later reader cannot "tidy" them together.
- **Backfill without a company authority.** Section C cannot be backfilled at all until D-2 is
  settled; attempting it would mint an ungoverned company id namespace.
- **Immutability vs. correction.** Eight families are marked immutable. A mis-owned historical
  invoice then has no legal path to correction. If the Owner wants one, it must be a named,
  audited exception rather than an implicit edit.

## Sequencing — the four gates the authorization requires

1. **Reconciliation** (this document) — Owner review. *No code.*
2. **Decisions D-1 through D-5** ratified, `SYSTEM_AUTHORITIES.md` row drafted in the same change.
3. **Typed owner shape + inheritance defaults + handoff command + audit action**, written but
   **inert** — no Rules enforcement, no backfill. Then a **dry-run mapping** producing an
   unresolved-record census per family.
4. **Enforcement** only after the census reads zero unresolved records — which needs a live data
   read this session cannot perform.

## Estimated PR count

Six to eight, one per architectural concern: company authority (D-2); typed owner shape +
validators; inheritance defaults in the commercial creation path; handoff command + audit
action; dry-run mapping script; per-family Rules enforcement, split by risk.

## Open questions for Architecture Review

D-1 through D-5 above. D-2 is blocking — section C of the matrix cannot proceed without it.

---

# Addendum — Owner rulings, 2026-08-30

D-1 through D-5 were ratified the same day. The full text is DECISIONS #142; the authority map row
is `docs/architecture/SYSTEM_AUTHORITIES.md`. What changed in the matrix above:

- **D-1** — `accountOwner` stays authoritative storage; the typed owner is derived. Section A's
  "Today" column is unchanged by design.
- **D-2** — the missing company authority now exists as `operating_companies` with the governed ids
  `taylor` / `ventana`. Section C is therefore unblocked *architecturally*, but every row in it
  still reads OWNERLESS until `operatingCompanyId` is actually stored on those records — which is
  backfill, and backfill is gated.
- **D-3** — the equipment row's owner is the operating company. `explicitTitleHolder` is not an
  ownership input and does not appear in the matrix's `ownerFields`.
- **D-4** — Opportunity, Sales Agreement and Sales Order now inherit when no owner is supplied.
  Their storage is unchanged; only the creation contracts relaxed.
- **D-5** — `OWNERSHIP_HANDOFF` extends the existing audit writer.

The owner type for person-owned families is **`USER`** (the ruling's word), not `EMPLOYEE` as this
document originally proposed.

## Open items carried forward

**O-1 — the `USER` id namespace is the canonical Employee id.** The ruling named the *type*; it did
not name the *identifier*. Every person-owned family already stores a canonical Employee id
(`accountOwner.assignedToEmployeeId`, `ownerEmployeeId`), and only the Account additionally stores a
linked user uid. Deriving a uid for an Opportunity would need a cross-collection lookup that can
fail, which would make a *projection* fallible — and a fallible projection cannot be
"read-normalized" as D-1 requires. The Employee id is the one identifier every family carries
natively, so the derivation uses it. Confirmation wanted; changing it later is a change to one
function.

**O-2 — an explicit deny-all Rules block for `operating_companies`.** Firestore denies every client
read and write to a collection no rule matches, so the collection is already fail-closed without a
Rules change, which is why this pass made none. An explicit `allow read, write: if false` block
matching the convention the `refunds` block uses would change no behavior and would make the denial
legible to a reader of the Rules file rather than implied by absence. Tier 2, so it is not taken
autonomously — and there is a second, harder reason to leave it: `firestore.rules` is **hash-anchored
to the live deploy** (`functions/test/verifyTruckRegistryDeployment.test.js` asserts the committed
file's sha256 against the governed live-deploy baseline). Any byte change, a comment included,
diverges that hash and fails the verifier until a governed deploy updates the baseline. So even a
behavior-free clarity edit here costs a Rules deploy. It is worth doing WITH the enforcement change,
not before it.

**O-3 — the census cannot be run from a repository session.** It needs Admin-SDK credentials against
a real target, which is a separately authorized data action. The classifier is written, typed and
unit-tested (`functions/test/ownershipCensus.test.mjs`) so the numbers it will produce are checkable
before it is ever pointed at data.

**O-4 — three modules each declare their own `ACCOUNTS_COLLECTION = "accounts"`.** A fourth was not
added; consolidating them into `constants/collections.ts` is a worthwhile tidy that is not this
change's business.

---

# Sandbox census — measured, 2026-08-30

Owner-authorized read-only run (ruling O-3) against `eos-platform-sandbox`. Raw output:
`sb-evidence/ownership-census-sandbox-2026-08-30.txt` / `.json`.

**Totals: 1,359 scanned — 36 RESOLVED, 1,323 OWNERLESS, 0 INVALID, 0 UNKNOWN, 0 AMBIGUOUS,
0 UNREADABLE, 0 TRUNCATED.**

Every family was read in full. No malformed ownership value exists anywhere in the sandbox, and no
record has two ownership facts that disagree — so the backlog is entirely *absent* ownership, not
*broken* ownership. That is the cheaper of the two problems to be facing.

## The finding

**`accounts`: 103 records, 0 with an owner, reason "no accountOwner".**

This is categorically different from every other OWNERLESS row. The other 1,220 are "family has no
ownership storage yet" — the field does not exist to be filled. Accounts *has* the storage, the
governed write path, the seven-field completeness invariant and the UI — and not one of the 103
sandbox Accounts uses it.

That matters because ruling D-4 makes the Account owner the **root of the whole person-owned
inheritance chain**. On this data, a `createOpportunity` call that omits `ownerEmployeeId` REFUSES
for every one of the 103 accounts, exactly as designed. The chain is correct and its root is empty.

**Caveat, and it is load-bearing:** the sandbox is synthetic seeded data. A 0/103 rate very likely
says the seed scripts never set `accountOwner`, not that the business does not assign account
owners. Production would answer that, and this census does not.

## Commercial families are already complete

`opportunities` 14/14, `sales_agreements` 5/5, `sales_orders` 17/17 — 100% RESOLVED, because
`ownerEmployeeId` was *required* until this change relaxed it. Those 36 records need no remediation
of any kind.

## By family

| Collection | Owner type | Scanned | RESOLVED | OWNERLESS | Reason |
|---|---|---|---|---|---|
| `accounts` | USER | 103 | 0 | 103 | **no accountOwner** — storage exists, unused |
| `opportunities` | USER | 14 | **14** | 0 | — |
| `sales_agreements` | USER | 5 | **5** | 0 | — |
| `sales_orders` | USER | 17 | **17** | 0 | — |
| `contacts` | USER | 339 | 0 | 339 | no ownership storage yet |
| `locations` | USER | 183 | 0 | 183 | no ownership storage yet |
| `fieldops_jobs` | USER | 45 | 0 | 45 | no ownership storage yet |
| `fieldops_wos` | USER | 30 | 0 | 30 | no ownership storage yet |
| `reorder_requests` | USER | 6 | 0 | 6 | no ownership storage yet |
| `invoices` | USER | 1 | 0 | 1 | no ownership storage yet |
| `equipment` | COMPANY | 288 | 0 | 288 | no ownership storage yet |
| `inventory_transactions` | COMPANY | 103 | 0 | 103 | no ownership storage yet |
| `parts` | COMPANY | 52 | 0 | 52 | no ownership storage yet |
| `equipment_models` | COMPANY | 48 | 0 | 48 | no ownership storage yet |
| `transfer_orders` | COMPANY | 47 | 0 | 47 | no ownership storage yet |
| `cycle_counts` | COMPANY | 24 | 0 | 24 | no ownership storage yet |
| `part_aliases` | COMPANY | 21 | 0 | 21 | no ownership storage yet |
| `mobile_locations` | COMPANY | 7 | 0 | 7 | no ownership storage yet |
| `part_supplier_items` | COMPANY | 7 | 0 | 7 | no ownership storage yet |
| `warehouses` / `stock_locations` | COMPANY | 5 / 5 | 0 | 5 / 5 | no ownership storage yet |
| `reorder_purchase_orders` | COMPANY | 3 | 0 | 3 | no ownership storage yet |
| `suppliers` / `receiving_orders` / `trucks` | COMPANY | 2 each | 0 | 2 each | no ownership storage yet |
| `payments`, `payment_applications`, `invoice_adjustments`, `refunds`, `manufacturers`, `supplier_catalog`, `purchase_orders`, `inventory_actions` | — | 0 | 0 | 0 | empty in sandbox |

Eight families are empty in the sandbox, so this run says nothing about them either way.

## What the census does NOT establish

Per the Owner's instruction, expected ownerlessness is **not** permission to backfill. The census
establishes facts; it does not name a deterministic Taylor-vs-Ventana source for any family, and
none was inferred from `lineOfBusiness`, display text, title holder, customer, location name,
creator, or assignment.

---

# Matrix reconciliation — post-census, 2026-08-30

Owner rulings D-6 … D-16 reclassified the matrix against the measured census. The authoritative
form is `functions/src/ownership/ownershipMatrix.ts`; this records what changed and why.

## The invariant narrowed, on evidence

    EVERY GOVERNED BUSINESS RECORD HAS AN OWNER
      ->  EVERY **OWNABLE** GOVERNED BUSINESS RECORD HAS AN OWNER

The census is what forced it. 130 sandbox records sit in families where "which company owns this?"
has no true answer, because Taylor and Ventana legitimately use the same part, the same
manufacturer, the same equipment model. The original wording would have been satisfied only by
fabricating a fact, so ruling D-8 added the classification instead.

## Four classes, 50 families

| Class | Families | Meaning |
|---|---|---|
| PERSON | 6 | responsibility belongs to an employee |
| COMPANY | 20 | responsibility belongs to Taylor or Ventana |
| REFERENCE | 7 | governed, intentionally company-neutral, not an owned object |
| EXCLUDED | 17 | not a business record: identity, access, audit, coverage, infrastructure |

26 families are ownable and censused. EXCLUDED families are now *recorded* rather than omitted — a
collection absent from the file entirely is indistinguishable from one nobody considered.

## What was reclassified, and why

- **Financial artifacts** (`invoices`, `payments`, `payment_applications`, `invoice_adjustments`,
  `refunds`) — PERSON → **COMPANY** (D-15). A ledger entry belongs to the books it lands in, not to
  the salesperson upstream. Commercial attribution stays fully available through the
  Customer → Opportunity → Agreement → Sales Order lineage. Accounting ownership and sales credit
  are different questions and must not share one field.
- **Service records** (`fieldops_jobs`, `fieldops_wos`) — PERSON → **COMPANY** (D-13). The
  responsible operating company owns the job; the technician performs it. `assignedTechId` is
  deliberately not an `ownerField`, which is the ownership/assignment distinction this whole model
  rests on.
- **`reorder_requests`** — PERSON → **COMPANY** (D-14). The inventory obligation is the company's.
  `currentOwner` (role queue), `requestedBy` (actor) and `assignedToUserId` (processor) all stay
  separate and untouched.
- **Catalog families** (`parts`, `part_aliases`, `part_supplier_items`, `manufacturers`,
  `equipment_models`, `supplier_catalog`) — COMPANY → **REFERENCE** (D-11). Both operating companies
  may legitimately use the same record.
- **`transfer_orders`** — now **CROSS_COMPANY_CAPABLE** (D-10). A transfer has a source and a
  destination and a Taylor↔Ventana move is legitimate, so a single owner may be the wrong shape.
  It carries no backfill source on purpose.
- **`equipment`** — stays COMPANY (D-12), stays distinct from `explicitTitleHolder`, and gets **no
  mass assignment**. Every candidate source on the record is a prohibited proxy.

## Five new columns

`ownerClass`, `inheritanceSource`, `companyScope`, `backfillSource`, `unresolvedPolicy`.

`backfillSource: null` is the most load-bearing value in the file. It is the honest statement that a
family cannot be populated without new business input, and it is what stops a plan from inventing
one. A test asserts that no `backfillSource` anywhere names a prohibited proxy.

## The Account seed correction (D-6)

`functions/scripts/certificationWorld/seedAccountOwners.mjs` — dry-run by default, sandbox-only,
marker-scoped, never overwrites an existing owner, idempotent. Assignment is deterministic from a
legitimate business fact: the employees whose governed roles actually include `salesperson`, sorted
by employee id, selected round-robin by the account's fixture index. The assignor is the
`salesManager`, and the script refuses rather than nominating one if no manager resolves.

Applied to sandbox: **100 of 103 accounts assigned**, 25 each across four salespeople; a second run
reported 0 to assign. The 3 unassigned are non-fixture accounts and are correctly left alone —
a seeding script fills silence, it does not reassign ownership.

It is a post-provision applier, not part of `buildWorld()`, because a complete `accountOwner` needs
provisioned user uids that the world builder does not have. Same shape and same reason as
`applyRoleGrants.mjs`. Consequence: a `rebuild` wipes it and it must be re-run.
