---
artifact_type: domain-foundation
gate: Domain Foundation
unit: C-1
status: Draft
date: 2026-07-24
owner: Claude Code
related_adrs: [ADR-005, ADR-006, ADR-009]
depends_on:
  - docs/BusinessEntityModel.md
  - docs/specifications/customer-account-business-model.md
  - docs/specifications/account-commercial-profile-and-financial-forecast-horizons.md
  - docs/architecture/ADR-006-equipment-and-installed-asset-management.md
implements: []
supersedes: []
superseded_by: []
related_pr: null
related_issue: null
target_release: null
---

# Customer Domain Foundation (C-1)

**Status: DRAFT — docs-only. Merging this document authorizes NO implementation.**
It defines *what the Customer domain is* and the vocabulary, relationships,
identifiers, lifecycle, ownership, audit posture, and boundaries every later
Customer unit (C-2+) must conform to. It creates no collection, field, Firestore
Rule, Cloud Function, index, route, component, migration, or production-data
change, and it grants, revokes, or approves no access. Each of those remains its
own separately-authorized Owner gate under `docs/ai/workflow.md`.

**Runtime status (C-1 operating model): BLOCKED.** The Customer workstream is
docs-only while the Inventory workstream owns the production deployment lane
(unit I-1). Nothing here may be built, migrated, deployed, or smoke-tested against
a release until the deployment lock is explicitly transferred to Customer.

Every claim below is marked **VERIFIED** (checked directly against the codebase
or a governance doc this session), **PROPOSED** (a new C-1 design decision, not
yet built), or **CARRIED OVER** (stated from an existing doc, not re-derived).
Verified against `origin/main` @ `a6daf63`. Path convention: `firestore.rules`,
`functions/…`, `docs/…` are repo-root-relative; `src/…` is relative to
`field-ops-app-vite/`.

---

## 1. Purpose & why this foundation exists

The platform already ships an **Account** domain (`accounts`/`contacts`/
`locations` collections, live since Sprint 2.0.2) and has since layered a
Commercial Profile, relationship-type classification, and a sectioned Account
page onto it. What it does **not** yet have is a single governing statement of
the *Customer* concept: what "customer" means relative to Account/Location/
Contact, how one customer relates to another (hierarchy), how a billing party
differs from a service site, how customers are uniquely identified and
de-duplicated, how their status moves over time, and who owns them.

C-1 writes that governing statement **before** any C-2+ build, so downstream
units extend one coherent model rather than re-litigating the vocabulary each
sprint. This is the same "domain foundation before implementation" discipline
`docs/BusinessEntityModel.md` applies platform-wide; C-1 is the Customer-scoped
deepening of that document, not a replacement for it.

---

## 2. Scope & non-goals

**In scope (definitions and governing rules only):**

1. Customer vs Account vs Location vs Contact — precise definitions and the
   relationship between them.
2. Billing customer vs service location.
3. Parent–child customer hierarchy.
4. Customer ↔ Location ↔ Equipment relationships (referencing ADR-006, not
   redesigning it).
5. Customer identifiers and duplicate prevention.
6. Customer status lifecycle.
7. Territory and ownership concepts.
8. Audit requirements for customer mutations.
9. Migration and integration boundaries.
10. Open decisions, risks, dependencies.
11. Recommended future implementation units (C-2+) and their sequence.

**Explicit non-goals (C-1 does NOT do these):**

- Does **not** create a `customers` collection or any new entity (see §3 —
  "Customer" is a role an Account plays, not a new object).
- Does **not** change `firestore.rules`, `accounts`/`contacts`/`locations`
  schema, indexes, Functions, frontend, or feature flags.
- Does **not** resolve the multi-tenant / operating-`Company` model
  (Issue #140) — that boundary is named here but decided elsewhere.
- Does **not** authorize the Customer runtime build, any migration execution, or
  any production deployment (blocked per the banner above).
- Does **not** design Equipment (owned by ADR-006) or the Enterprise
  Authorization model (owned by ADR-005) — it only states how Customer consumes
  them.

---

## 3. Foundational reconciliation — "Customer" is a role, not a new entity

**VERIFIED.** The current model (`docs/BusinessEntityModel.md` §3, §10;
`domain/constants.js`) already establishes:

- The internal entity is **`accounts`**; the UI labels it **"Customers"** where
  clearer for users. This naming mismatch is deliberate and permanent.
- An Account carries `relationshipTypes: string[]` with values `"CUSTOMER"` /
  `"VENDOR"` (either, both, or neither). This is **informational only** — it does
  not gate authorization and does not show/hide UI.
- The live Work Order field `fieldops_wos.customerId` points at an `accounts`
  document ID and is **never renamed** (a live Cloud Function contract).

**PROPOSED (D-C1-1 — foundational).** C-1 therefore defines **Customer** as a
*business role an Account plays*, **not** a distinct entity or collection:

> A **Customer** is an Account whose `relationshipTypes` includes `"CUSTOMER"` —
> i.e. a party the operating business performs service for and/or bills. The
> authoritative record is always the `accounts/{id}` document. There is no
> `customers` collection, now or planned.

This preserves the platform's hard rule against competing domain models (a repo
that has previously accumulated duplicate "work order" and "person" concepts —
see `BusinessEntityModel.md` §12 and `CLAUDE_CONTEXT.md`). Every C-1 term below
("billing customer", "parent customer", "customer identifier") resolves to an
attribute or relationship **on the Account**, never to a second object.

Vocabulary map (authoritative for the Customer domain):

| C-1 term | Resolves to | Collection |
|---|---|---|
| Customer | Account with `relationshipTypes ∋ CUSTOMER` | `accounts` |
| Billing customer | The Account that carries the Commercial Profile / is invoiced | `accounts` |
| Service location | A Location under that Account where work is performed | `locations` |
| Parent / child customer | Account ↔ Account via `parentAccountId` (PROPOSED) | `accounts` |
| Customer contact | A person associated with the Account | `contacts` |
| Serviceable asset | Equipment at a Location (ADR-006) | `equipment` (deferred) |

---

## 4. Entity definitions — Customer / Account / Location / Contact

| Entity | Definition | Cardinality | Status |
|---|---|---|---|
| **Account** (Customer) | The company/organization the business serves and/or bills — root of "who is this work for". Holds identity, status, relationship type, Commercial Profile, ownership. | Root | **VERIFIED** live (`accounts`) |
| **Location / Site** | A physical place tied to exactly one Account where service is delivered. First-class collection (`locations.accountId`), never embedded on the Account. | Account 1:many Location | **VERIFIED** live (`locations`) |
| **Contact** | A person associated with an Account (optionally scoped to specific Locations via `locationIds[]`). Not a login/auth identity. | Account 1:many Contact | **VERIFIED** live (`contacts`) |
| **Equipment / Asset** | An installed, customer-serviceable asset at a Location. Separate domain from inventory Parts (hard boundary). | Location 1:many Equipment | CARRIED OVER — ADR-006 Accepted, **deferred** (`equipment` not built) |
| **Company** (operating business) | The tenant using the platform; the future multi-tenant boundary. | 1 (implicit today) | CARRIED OVER — **Future**, unresolved (Issue #140) |

### 4a. Party roles — why they collapse to Account (and where they could split)

The domain has several *party* concepts — **customer**, **organization**,
**billing account**, **service recipient**, **equipment owner**. The simplest
model that supports current Taylor Parts operations collapses them onto the
Account, because today one company is simultaneously the org, the billed party,
and the serviced party:

| Party role | C-1 mapping | If it must split later (extension point) |
|---|---|---|
| Customer | Account (`relationshipTypes ∋ CUSTOMER`) | — (foundational, does not split) |
| Organization / legal entity | The Account itself | If org ≠ billed party (e.g. a buying group), promote `parentAccountId` or a future `Organization` grouping — **D-C1-OPEN-b** |
| Billing account / bill-to | The Account (holds Commercial Profile) | Location-level or third-party bill-to → future ADR — **D-C1-OPEN-b** |
| Service recipient | The Location under the Account | Already first-class; no split needed |
| Equipment owner | The Account (per ADR-006 `equipment.accountId`) | Serviced-vs-owning party (leased/manufacturer-owned asset) → reserved extension, **D-C1-OPEN-f** (§7) |

**C-1 recommendation:** do not create separate `organization` / `bill_to` /
`equipment_owner` party entities now. Model them as roles on the Account and keep
the named extension points above, per the platform's "named-for-coherence, built-
when-required" convention. This is the simplest model consistent with §3.

Current Account document shape (**VERIFIED**, `domain/accounts.js`):

```
{ id, name, billingAddress?, status?, notes?, tags?,
  relationshipTypes?: string[],
  customerNumber?, erpId?, accountingId?, legacyId?,      // integration-reserved
  // Commercial Profile (additive):
  defaultCurrency?, purchaseOrderRequired?, invoiceDeliveryMethod?,
  billingContact?, accountOwner?, paymentTerms?, taxStatus?,
  createdAt, updatedAt }
```

`createdAt`/`updatedAt` are `Date.now()` epoch-ms numbers (platform convention),
not Firestore Timestamps.

---

## 5. Billing customer vs service location

**PROPOSED (D-C1-2).** The platform separates *who is billed* from *where work
happens*, and both resolve without a new entity:

- The **billing customer is the Account.** It is the legal/billing party and the
  sole carrier of the Commercial Profile (`paymentTerms`, `taxStatus`,
  `invoiceDeliveryMethod`, `defaultCurrency`, `purchaseOrderRequired`,
  `billingContact`) and of `billingAddress`. Financial rollups and invoices
  (Future) attach to the Account, never to a Location.
- The **service location is a Location** under that Account. Work Orders are
  performed at a Location and reference the Account via `customerId`; the Location
  is where the technician goes, the Account is who pays.

**C-1 decision:** do **not** introduce a separate "Bill-To" entity or per-Location
billing terms in this foundation. A single billing party per Account is the
governing model. If a future requirement needs Location-level or third-party
bill-to (e.g. a property manager billed for a tenant's site), that is a **named
future decision (see §12 / D-C1-OPEN-b)**, resolved by its own ADR — not assumed
here. This keeps the Commercial Profile's single-owner invariant intact.

---

## 6. Parent–child customer hierarchy

**PROPOSED (D-C1-3).** No hierarchy exists on `accounts` today (**VERIFIED** —
no parent field in `domain/accounts.js` or `constants.js`). C-1 defines the
governing model for one, to be built under a later unit:

- A nullable self-reference **`parentAccountId`** on the Account (adjacency-list
  model). `null` = a root/standalone customer.
- **Single parent, acyclic** — an Account has at most one parent; a cycle is
  invalid and must be rejected at write time (a later Rules/writer concern, not a
  client-trust concern).
- **Depth is bounded** (proposed limit: 5 levels) to keep derived rollups cheap
  and prevent pathological trees; the exact bound is a C-2 decision.
- **Rollups are derived, never stored.** Any "total across a customer family"
  (open Work Orders, spend, locations) is **computed read-side** from the tree;
  C-1 forbids denormalized aggregate totals on the parent (they drift and become
  a second source of truth — the same anti-pattern `CLAUDE_CONTEXT.md` rules 11/12
  guard against for analytics).
- **Hierarchy is organizational, not authorization.** Being a child of a parent
  Account does not, by itself, grant any user access to the child. Authorization
  stays with `users/{uid}.role` + `firestore.rules` exactly as today.
- **Each node keeps its own identity, status, and Commercial Profile.** A child is
  a full Account; the parent link adds structure, it does not merge records or
  centralize billing (that would require the §5 bill-to decision, which is
  deliberately deferred).

---

## 7. Customer ↔ Location ↔ Equipment relationships

**CARRIED OVER (from ADR-006, Accepted).** C-1 does not redesign Equipment; it
records how the Customer domain relates to it so C-2+ stays consistent:

```
Account (Customer)
  └── 1:many ── Location
                   └── 1:many ── Equipment   (deferred; ADR-006)
```

- **Equipment belongs to one Account** (`equipment.accountId`) **and one active
  Location** (`equipment.locationId`), and that Location must belong to the same
  Account (ADR-006 §2.1 — the ownership invariant).
- **Moving Equipment between Locations is an explicit, audited action**, never a
  side effect of an ordinary edit (ADR-006).
- **Service history is derived from linked Work Orders**, not duplicated — the
  same pattern the Account page's Service Activity section already uses.
- Equipment is **out of C-1's build scope entirely**; it is named so the hierarchy
  and location model above leave a clean, unbroken extension point (Account →
  Location → Equipment) rather than needing reshaping when ADR-006 is implemented.
- **Extension point — equipment-owning party (D-C1-OPEN-f).** ADR-006 ties
  Equipment to the Account that *is serviced at* the Location. Some operations
  distinguish the party that *owns* an asset (a leasing company, a manufacturer)
  from the customer it is serviced for. C-1 does **not** model this split — the
  serviced Account is the sole equipment party today — and records it as a reserved
  extension point for ADR-006's program to decide if a real requirement appears.

---

## 8. Customer identifiers, duplicate prevention & merge policy

**VERIFIED (current identifiers):**

| Identifier | Role | Enforcement today |
|---|---|---|
| `accounts/{id}` (doc ID) | Technical, immutable, non-human-readable primary key | Firestore-native uniqueness |
| `customerNumber` | Human-facing customer number (e.g. on invoices) | **Reserved** — passed through, not populated or validated |
| `erpId` / `accountingId` / `legacyId` | External-system correlation keys (integration-only) | **Reserved** — pass-through, no read/write logic |
| `name` | Display name | No uniqueness constraint |

**PROPOSED (D-C1-4 — identity governance):**

- The **doc ID is the only hard-unique key**; Firestore provides no native
  multi-field uniqueness, so `name`, `customerNumber`, and external IDs are **not**
  DB-enforced unique.
- **Duplicate prevention is advisory-at-create, not a hard DB constraint.** The
  governing rule: before creating a customer, a normalized-match check (case/
  whitespace/punctuation-folded `name`, plus any provided `customerNumber`/`erpId`)
  surfaces likely duplicates for human confirmation. This is a C-4 build, not C-1.
- **External IDs are correlation keys, never the primary key** — the platform's ID
  space stays independent of any ERP/accounting system so a future integration or
  provider change cannot reshape the Customer entity (mirrors the Employee model's
  "no vendor-specific identity fields" rule, `BusinessEntityModel.md` §8a).
- **Open gap flagged (D-C1-OPEN-c):** whether `customerNumber` should ever become
  a soft-unique, system-assigned sequence (like `employeeNumber`) versus remain
  free-text is an unresolved decision, called out in §14.

**Merge policy (PROPOSED — D-C1-7).** Because uniqueness is advisory, true
duplicates will occasionally be created. C-1 defines the governing merge model
(a later C-4 build, not C-1):

- A merge names **one surviving Account** and one or more **merged-away Accounts**.
- Child references re-point to the survivor: `locations.accountId`,
  `contacts.accountId`, `equipment.accountId` (ADR-006), `parentAccountId` links,
  and — critically — the **historical `fieldops_wos.customerId`** on already-closed
  Work Orders. Because `customerId` is a live Cloud Function contract that is never
  renamed, re-pointing it is a **trusted-writer operation** (ADR-005 / Issue #226),
  never a client-direct rewrite.
- The merged-away Account is **`ARCHIVED`, never hard-deleted** — it retains a
  `mergedIntoAccountId` tombstone pointer so historical links and audit trails
  stay resolvable.
- A merge is a **single audited, reversible-by-record action** emitting an audit
  event; it is not a bulk silent overwrite.
- **Governing constraint:** merge is impossible to do safely client-direct (it
  crosses the `customerId` Function contract), so it is explicitly gated on the
  trusted-writer seam (Issue #15) — the same blocker as C-6. C-1 defines the
  policy; it builds nothing.

---

## 9. Customer status lifecycle

**VERIFIED.** `ACCOUNT_STATUS` already exists as enum values in
`domain/constants.js` — `ACTIVE`, `INACTIVE`, `PROSPECT`, `ARCHIVED` — but with
**no formal transition governance** (any value can currently be written to any
other via the generic account store).

**PROPOSED (D-C1-5).** C-1 formalizes the lifecycle these existing values imply
(it does not invent new states):

```
        (create)
           │
           ▼
       PROSPECT ──────────► ACTIVE ◄──────► INACTIVE
                               │                │
                               └──────┬─────────┘
                                      ▼
                                  ARCHIVED   (terminal, soft — never deleted)
```

| Status | Meaning | Allowed next |
|---|---|---|
| `PROSPECT` | Potential customer, not yet transacting | `ACTIVE`, `ARCHIVED` |
| `ACTIVE` | Current, serviceable/billable customer | `INACTIVE`, `ARCHIVED` |
| `INACTIVE` | Dormant, retained for history; may reactivate | `ACTIVE`, `ARCHIVED` |
| `ARCHIVED` | Soft-retired; read-only, excluded from default lists | *(terminal)* |

Governing rules:

- **`ARCHIVED` is soft-delete only.** Customer records, their Work Order history,
  Contacts, and Locations are **never hard-deleted** — historical operational and
  financial records must remain intact and attributable.
- **Status is not authorization.** An `INACTIVE`/`ARCHIVED` customer restricts new
  operational actions (new Work Orders) by product rule, but does not change who
  can *read* the record; permissions stay with `firestore.rules`.
- **A child cannot be `ACTIVE` under an `ARCHIVED` parent** is a candidate
  invariant for C-2/C-3 to decide (flagged, not fixed here).
- Enforcing these transitions in `firestore.rules` / a trusted writer is a **later
  unit (C-3)**; C-1 only defines the legal graph.

---

## 10. Territory & ownership

**VERIFIED.** `accountOwner` already exists as a Commercial Profile field (a named
owner of the account relationship). **No territory concept exists** anywhere today.

**PROPOSED (D-C1-6).**

- **Ownership** — `accountOwner` is the governing "who owns this customer
  relationship" attribute. C-1 keeps it a *single named owner* on the Account;
  team/pooled ownership is a future decision, not assumed.
- **Territory** — introduce a reserved **`territoryId`** (nullable) as an
  *organizational grouping* attribute on the Account. C-1 defines it as
  **descriptive metadata only**:
  - It groups customers for reporting, routing, and assignment *eligibility* —
    it is **not** an authorization boundary. `firestore.rules` continues to
    enforce every real permission via `users/{uid}.role` / `isAdminOrDispatcher()`.
  - Whether territory should *ever* scope reads/writes (territory-based data
    partitioning) is explicitly deferred to the Enterprise Authorization program
    (**ADR-005**) and flagged as **D-C1-OPEN-d** — C-1 must not pre-empt that
    decision by baking territory into any access path.
  - No Territory *entity/collection* is proposed; `territoryId` is a value on the
    Account until a concrete requirement justifies a first-class Territory object
    (named-for-coherence convention, `BusinessEntityModel.md` §2).

---

## 11. Audit requirements

**CARRIED OVER + PROPOSED.** The Commercial Profile work already establishes the
target posture (**VERIFIED**, `domain/accounts.js` header): GOVERNED customer
fields are today admin/dispatcher client-direct-write-with-Rules **on an interim
basis only**, and are slated to move behind an **audit log + trusted server-side
writer** once that seam ships (the ADR-005 / Issue #226 Enterprise Access
trusted-writer seam; gated by Functions deployment, Issue #15).

C-1 states the governing audit rule for the whole Customer domain:

- **Audited (must route through the trusted writer + emit an audit event once that
  seam exists):** changes to `relationshipTypes`, `status`, `parentAccountId`
  (hierarchy), `accountOwner`/`territoryId` (ownership/territory), and the governed
  Commercial Profile fields (`paymentTerms`, `taxStatus`). These are
  relationship-, money-, or org-structure-affecting.
- **Ordinary edits** (display `name`, `notes`, `tags`, `billingAddress`, adding a
  Contact/Location) remain client-direct-with-Rules, consistent with today.
- **Until the trusted-writer seam ships** (Issue #15 blocker), audited mutations
  stay on the existing interim path where they already are, and no *new* governed
  customer mutation surface is added that would need to be retrofitted — i.e. C-2+
  should not multiply interim client-direct governed writes.
- **Soft-delete/immutability:** archival and hierarchy changes must preserve prior
  state for audit; no destructive rewrite of historical linkage.

C-1 introduces no audit collection or writer itself — it defines *which* customer
mutations are audit-class so C-6 (§13) builds the right seam.

---

## 12. Migration & integration boundaries

**VERIFIED / CARRIED OVER.**

- **No data migration.** The Customer domain is a fresh build — the dead
  `domain/customers.js` store had zero real documents; `accounts`/`contacts`/
  `locations` were greenfield at Sprint 2.0.2 (`BusinessEntityModel.md` §12).
  C-1's hierarchy/territory/lifecycle additions are **additive** to live records
  (all proposed new fields are nullable), so no backfill is forced.
- **Integration is one-directional, reserved-field-only, today.** `erpId`/
  `accountingId`/`legacyId`/`customerNumber` exist to *correlate* with external
  systems; the platform's own ID space is authoritative. No bidirectional sync,
  no external-system write-back, is in scope or assumed.
- **Multi-tenant / operating-`Company` boundary is unresolved (Issue #140).** C-1
  models a single operating business implicitly. Any `companyId`/tenant scoping is
  **out of scope** and must not be improvised into the Customer model — it is a
  platform-level decision (referenced by the Employee model too).
- **`customerId` naming mismatch is permanent** (`fieldops_wos.customerId` →
  `accounts` doc): accepted, not a migration target.

---

## 13. Recommended future implementation units (C-2+)

Docs-first; **all runtime BLOCKED until the deployment lock transfers to
Customer.** Sequence chosen so each unit depends only on prior ones:

| Unit | Deliverable | Depends on | Gate type |
|---|---|---|---|
| **C-1** | *This* Domain Foundation | — | Domain Foundation (docs) |
| **C-2** | Customer Hierarchy — `parentAccountId`, acyclic/depth invariants, derived rollups | C-1 | Assessment → Spec → Impl Plan → build |
| **C-3** | Status Lifecycle enforcement — transition rules in `firestore.rules`/writer | C-1 | Spec → Impl Plan → build (Rules = Tier 2) |
| **C-4** | Customer Identity, Duplicate Prevention & Merge — advisory dedupe at create, identifier governance, trusted-writer merge | C-1, Issue #15 (merge writer) | Assessment → Spec → build |
| **C-5** | Territory & Ownership model — `territoryId` reporting/assignment (non-auth) | C-1, coordinates w/ ADR-005 | Assessment → Spec |
| **C-6** | Customer Audit Trail — governed mutations via trusted writer + audit events | C-1, ADR-005, Issue #15/#226 | Blocked on Functions (Issue #15) |

Any unit touching `firestore.rules` or Functions is **Tier 2** under
`DelegationCharter.md` and additionally gated by the deployment-lock transfer.

---

## 14. Open decisions & risks

**Required decisions (for Owner):**

- **D-C1-1 — Customer = role on Account, no `customers` collection.** *(recommend
  ADOPT.)* Foundational; everything else depends on it.
- **D-C1-OPEN-b — Single billing party per Account?** Recommend **yes** for now;
  defer Location-level / third-party bill-to to a future ADR when a real
  requirement appears.
- **D-C1-OPEN-c — `customerNumber`: system-assigned soft-unique sequence vs
  free-text?** Unresolved; recommend deciding in C-4.
- **D-C1-OPEN-d — May territory ever scope access?** Recommend **no** in the
  Customer domain; route any territory-based partitioning through ADR-005, not C-1.
- **D-C1-OPEN-e — Child-under-archived-parent invariant** and **hierarchy depth
  bound** — recommend deciding in C-2.
- **D-C1-OPEN-f — Equipment-owning party vs serviced party** (§7) — recommend **no
  split** now; reserve for ADR-006's program.
- **D-C1-7 — Merge policy** (§8): surviving-Account + archived tombstone +
  trusted-writer re-point of `customerId`. Recommend ADOPT as policy; build in C-4,
  gated on Issue #15.

**Risks:**

- **Entity proliferation.** Pressure to build a separate `customers`, `bill_to`,
  or `territories` collection would fork the model — treat as scope-creep, resolve
  against §3/§5/§10. *(Mitigation: C-1's "role on Account" rule.)*
- **Denormalized rollups drifting.** Storing family totals on a parent would
  create a second source of truth. *(Mitigation: §6 "rollups are derived".)*
- **Interim governed-write debt.** Adding more client-direct governed customer
  mutations before the trusted-writer seam ships increases retrofit cost.
  *(Mitigation: §11 rule against new interim governed surfaces.)*
- **Multi-tenant surprise.** Improvising tenant scoping into Customer ahead of
  Issue #140 would conflict with the platform decision. *(Mitigation: §12.)*
- **Deployment collision.** Customer runtime work starting before the lock
  transfers would collide with Inventory I-1. *(Mitigation: banner + §13.)*

**Dependencies:** ADR-005 (Enterprise Authorization — territory/audit seam),
ADR-006 (Equipment — Account→Location→Equipment), Issue #15 (Functions
deployment — gates C-6 audit writer), Issue #140 (tenant model), and the
Customer/Inventory deployment-lock transfer.

---

## 15. Approval

**Gate:** Domain Foundation (C-1). **Status: DRAFT.** Awaits ChatGPT Domain/
Governance review and separate Owner authorization. This document authorizes no
implementation and no production-data action. The Customer runtime lane remains
**BLOCKED** until Inventory I-1 closes and the deployment lock is explicitly
transferred. **STOP before merge — Owner review required.**
