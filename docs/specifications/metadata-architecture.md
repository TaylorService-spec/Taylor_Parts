---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-08-17
owner: Claude Code
related_adrs: []
depends_on: [docs/governance/metadata-architecture-ip-boundary.md, docs/DECISIONS.md]
implements: []
supersedes: []
superseded_by: []
related_pr: null
related_issue: 1096
target_release: Metadata-to-Platform Program, Phases 1-3
---

# Specification: EOS Metadata Architecture (v1)

> **GOVERNING BOUNDARY — read first.**
> [`docs/governance/metadata-architecture-ip-boundary.md`](../governance/metadata-architecture-ip-boundary.md)
> is controlling for everything in this specification, and this reference is an
> **acceptance condition** of the spec, required by its §13 — not a courtesy link.
>
> That document exists because "Salesforce-style" appears throughout the planning
> conversation for this work. It is not permission to clone Salesforce. Anything here
> that resembles a pattern from a commercial platform is present because an EOS
> requirement produced it; §3 (prohibited copying) and §12 (stop conditions) apply to
> every implementation decision downstream of this page.

**This specification authorizes no implementation.** It defines *what* the metadata
architecture is and what each build must satisfy. Capability grants, Firestore Rules,
index deployment, schema changes, migrations and any production action each remain their
own gate.

---

## 1. The problem, stated from EOS

Every index and record surface in EOS is built per-page. The Phase 0 inventory found
**43 routed business surfaces**; the same machinery — columns, filters, sorting,
pagination, empty and denied states, row navigation — is re-implemented in each. Adding
Contacts, or Suppliers, or Purchase Orders means writing it again.

That is the ordinary case for a reusable abstraction. Three findings make it urgent
rather than merely tidy, and each is an EOS fact rather than an industry generality:

**Scale is already violated, not approaching.** `listCollection()` in
`operationsQueries.ts` is one factory behind five collections; `subscribeToWorkOrders` is
one unbounded listener behind six dispatcher surfaces; `fetchPartMasterList` has eight
consumers. The Customers list subscribes to the whole `accounts` collection and filters
in the browser. DECISIONS #102 §9 forbids exactly this, so these are governance
violations today, not future scale risks.

**The same defect recurs because nothing prevents it.** A status enum holding
presentation casing put "0 Active" beside a table of ACTIVE rows (#1093). A view-state
producer and its consumer disagreed on case, so an AR panel read "Unavailable" on every
account forever while its own tests passed (#1094). Six surfaces render Firestore
document ids as user-facing labels. These are not carelessness; they are what happens
when each surface re-derives its own conventions.

**Configuration is a product requirement, not an aspiration.** EOS is intended to serve
companies other than Taylor without forking product code. That is impossible while every
page is hand-written.

## 2. What v1 is, and is not

**v1 is** the minimum reusable foundation proven through real consumers: entity, field
and relationship definitions; a list runtime; a page composition runtime; component and
action registries; and visibility/capability declaration.

**v1 is not** the no-code platform. No tenant override store, no admin builder UI, no
custom fields, no workflow metadata. Boundary §14 is explicit that the foundation must be
proven before it is broadened, and the Gate B validation below is what "proven" means.

## 3. Layers (boundary §7)

These stay **separate contracts**. Collapsing them into one page schema is the failure
mode §7 names.

| Layer | Question | v1 |
|---|---|---|
| Entity | What business object exists? | Yes |
| Field | What data exists on it? | Yes |
| Relationship | How do entities relate? | Yes |
| List | How is a collection shaped and displayed? | Yes |
| Page | How is a record composed? | Yes |
| Action | What operations are exposed? | Registry only |
| Capability | Who may perform them? | **Declared, never decided** |
| Workflow | What transitions are valid? | Deferred |
| Tenant | What may a customer configure? | Seam only |

## 4. Provenance: derived from an EOS artifact

Boundary §10 requires the decision trace *EOS requirement → EOS architecture need → EOS
abstraction*, and forbids *vendor feature → EOS equivalent*.

The trace here is unusually short, because the abstraction already exists in this
repository. `domain/reporting/reportCatalog.js` models business objects, fields and
relationships as validated pure data:

- objects carry a collection and a read capability
- fields carry a data type, an operator set, and **a capability id per field**
- relationships are predefined single hops carrying a traversal capability

It exists because governed reporting needed field-level authorization — an EOS
requirement, met before this program began. The metadata contracts generalize those three
concepts so page and list definitions can consume them too. Nothing here was reached by
asking what a commercial platform does.

The report builder is therefore recorded as **exempt from migration**: it is ahead of the
runtime, not behind it.

## 5. Entity / Field / Relationship contracts

Implemented in `field-ops-app-vite/src/metadata/entityDefinition.js`.

### 5.1 Rules that exist because of shipped defects

The validators are not schema hygiene. Each of these makes a defect this codebase
actually shipped **undeclarable**:

- **`id` and `label` must differ**, and an enum label equal to its machine value is
  rejected. Conflating stored value with display label is #1093.
- **Identity is required.** An entity must declare a `nameField` or a `referenceField`.
  "The document id is the label" is rejected as a data-model gap to *record*, not a
  fallback to normalize. Six surfaces do this today.
- **`viaField` is required on every relationship.** It is the parent key a related list
  scopes by; without it a section renders every record of the target entity.
- **Operators are a claim about a real query.** Declaring operators on a non-filterable
  field is rejected, and so is filterable-with-no-operators.

### 5.2 `readVia`

`CLIENT_DIRECT` versus `CALLABLE`, because Phase 0 found both in production use — several
collections are deny-all in Rules and readable only through a trusted callable. A runtime
must know which it faces rather than assuming client-direct.

**Six collections have neither**: `payments`, `payment_applications`,
`invoice_adjustments`, `refunds`, `part_supplier_items`, `part_aliases` are deny-all with
no read callable of any kind. Metadata cannot make them readable — see §7.

## 6. Entity List Metadata (v1)

A `ListViewDefinition` declares columns, sorts (with a **stable tiebreaker**, or rows
duplicate and vanish across page boundaries), an explicit indexed filterable set,
cursor pagination, row navigation, saved views with **Recently Viewed** as the landing
view, and per-column/per-action capability requirements.

**One component, two configurations.** The same runtime serves an index surface (full
grid, paging, filters) and a related-record section (few columns, capped rows, no paging
controls, "view all" handing off to the index pre-filtered by parent). This requires index
routes to accept URL filter parameters.

### 6.1 Reuse, don't invent

Three cursor-pagination implementations already exist — `useInstalledEquipmentPage.js`
(with cursor ref, overlap guard and stale-async discard), reorder-request history, and the
account service-activity timeline — plus a callable-side `limit+1` truncation-honesty
convention. v1 generalizes these.

### 6.2 Pagination is not aggregation

**A page of rows is an honest page of rows. A page of inputs to a sum is not.**

Bounding a list is safe. Bounding the inputs to a netted total produces an arithmetically
false figure under a name implying a complete business total — worse than an honest
failure. Netted `availableStock`, balances and rollups require an authoritative aggregate,
never a page. This applies identically on the server and in the browser.

### 6.3 Metadata must not promise what the backend cannot serve

Each declared filter-and-sort combination needs a Firestore composite index. A validator
must cross-check `ListViewDefinition` filters against declared indexes, importing
`scripts/indexDriftGuard.mjs`'s existing exports rather than re-deriving key
normalization.

## 7. The authorization boundary (§6)

**Metadata never grants authority.** A definition may decide what renders, where, and
which affordances appear. The governed trusted-command and capability architecture remains
the authorization authority.

```
PageDefinition says:   show "Dispatch"
Trusted command says:  this principal may or may not dispatch
                       → the trusted command wins
```

Concretely: `declaredCapabilities()` returns capability **ids** to hand to the real
resolver; it never returns a decision. The contracts module imports nothing from
`access/`, and a test asserts that structurally — the cheapest way for this boundary to
erode is an innocuous import.

No metadata-driven client writes. An action definition references a governed command path;
it never carries one.

## 8. No executable metadata (§8)

Definitions are plain data. A function anywhere in a definition, at any depth, is rejected.
Renderers and validators are referenced by **registered id**. This is what keeps a future
tenant-configuration layer from becoming arbitrary code execution.

## 9. Storage: repository modules in v1

Repo modules are the v1 source of truth — diffable, code-reviewed, CI-validated, typed,
versioned with application behavior, and requiring no new runtime configuration authority
to prove the architecture.

```
repo base metadata → validated runtime → [future] governed tenant override store → effective metadata
```

The tenant seam is **declared now and unbuilt**. Core EOS definitions must not depend on
Firestore documents in v1.

## 10. Operation-centric, not record-centric (§5)

EOS metadata must carry lifecycle state, readiness, blockers, next actions, approvals,
queues, custody and location, inventory demand, scheduling, attention projections and
workflow progression — not only fields and layout.

**Boards, calendars and Field Mode are exempt from the list runtime.** A dispatch board and
a technician's phone screen are not grids, and forcing them into one makes them worse.

That exemption is from the **list runtime only**. It is not an exemption from the
enterprise-scale read rule. Collapsing those two exemptions would quietly bless unbounded
reads on exactly the surfaces that read the most.

## 11. Acceptance — Gate B

The framework is validated against **Work Orders**, a non-CRM operational entity, before
site-wide migration.

**Pass:** a Work Order surface is expressible with no CRM-shaped concession and no bypass
of the governed command path.

**Fail:** the definition needs a Work-Order-specific escape hatch, or an operational
concern can only be expressed by embedding executable logic, or a row action needs to write
directly.

A failure is a finding **about the architecture**, not about Work Orders. It is corrected
before migration continues, not accommodated by widening the definition.

Boundary §14 states the standard plainly: *if the architecture only works well for CRM
records, it is not yet an EOS metadata architecture.*

## 12. Definition of success

Not *"EOS looks like Salesforce."*

> EOS has an independently implemented, enterprise-grade metadata runtime capable of
> Salesforce-class configurability while preserving EOS's operational model, governed
> authority, visual identity, and AI-native architecture.

Boundary §15 designates that sentence the governing design test.

## 13. Traceability

| Concern | Where |
|---|---|
| Governing IP/architecture boundary | [`governance/metadata-architecture-ip-boundary.md`](../governance/metadata-architecture-ip-boundary.md) |
| Decision record | `DECISIONS.md` #102 |
| Per-surface migration state | `orchestration/metadata-program/LEDGER.md` |
| Executable work units | GitHub issues #1093–#1099 |
