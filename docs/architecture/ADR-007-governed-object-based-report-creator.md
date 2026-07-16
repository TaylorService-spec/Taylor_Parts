# ADR-007 — Governed Object-Based Report Creator Architecture

Status: Proposed (Draft — pending Architecture/Security Review for Issue #325)
Phase: Governed Report Creator — Architecture (governance chain: Assessment → **ADR** → Specification → Implementation Plan → foundation → staged per-wave activation, each a separate Owner gate)
Depends on:

- `docs/assessments/governed-object-based-report-creator.md` (the merged #325 Assessment — current-state inventory and the field-level-authorization finding this ADR decides around)
- Issue #325 (tracking), Issue #226 / ADR-005 (Enterprise Access authorization model — **cited, never modified here**; Inventory owns that engine/security lane), Issue #15 (production Cloud Functions deployment — gating), Issue #140 (tenant/company Scope — **inert; authority, not resolved here**)

**Design-stage only. Docs-only. Merging this ADR authorizes NO implementation.** It records a proposed architecture *decision*; it builds no Function, Rule, index, collection, schema, permission-engine change, route, UI, deployment, export, or production query. Each later stage (Specification → Implementation Plan → foundation → per-wave activation) is its own separately-authorized Owner gate. Issue #325 stays OPEN.

Relationship to prior ADRs: **purely additive.** ADR-007 does not supersede or modify ADR-001–006. It **consumes** ADR-005's authorization model (Role / Permission / Scope / Condition / Audit Event) as a dependency and proposes a field-level *read* extension to it that ADR-005's own lane (Inventory / Issue #226) must design and own — this ADR specifies the shape of that dependency, not its implementation.

Repository-path convention: `firestore.rules`, `functions/…`, and `docs/…` are repo-root-relative; `src/…` is relative to `field-ops-app-vite/`.

---

## 1. Context

The merged #325 Assessment established that a report creator does not exist today (all eight Reporting sub-areas render `PlaceholderPage`), no export capability exists, and — decisively — **there is no field-level read authorization anywhere in the platform**. The #226 permission model is record-grained (`account.record.read` grants the whole document); the only field-scoped capability, `account.governedField.write`, is a *write* control; and **Firestore Rules are per-document all-or-nothing on read and cannot return a document with fields removed**.

The Owner has authorized (Issue #325 decision comment, main @ `d9bbc8a`) an architecture for a Salesforce-like governed report creator spanning **every existing governed business object**, built as **one reusable engine and one governed field-catalog**, with activation staged in reviewed waves for security/verification/performance — not because later objects are out of product scope. The binding constraints: server-side authorization of every selectable/filterable/groupable/sortable/aggregated/shared/scheduled/exported field; unauthorized fields never returned by the backend; permissions re-evaluated on every run/share/schedule/export; saved definitions confer no access; predefined governed relationships, no arbitrary joins; sensitive domains disabled until dedicated security review; Enterprise Access immutable audit for every report action; CSV-first export with bounded limits; tenant Scope inert until #140; Invoice deferred until its domain exists.

This ADR records the architecture that satisfies those constraints and does not require re-building per wave.

## 2. Decision

Adopt a **trusted field-projecting report architecture**: a single, shared, server-authoritative report execution service that reads governed collections with elevated privilege and returns only the fields and rows the *runner* is authorized to see, driven by a static repository-owned metadata catalog and the ADR-005 authorization engine. The following sub-decisions are binding on the Specification and all later stages.

### 2.1 Trusted field projection is the only architecture that can meet the field-level guarantee (D1)

**Report reads are server-mediated by a trusted execution service; there is no client-direct report read path.** The service (a Cloud Function in the Issue #15 lane) resolves the caller's identity, loads the requested object's documents, and **projects each document down to the fields the caller's effective field-level read capabilities allow** before returning anything. A field the caller may not read is **absent from the response payload**, not blanked and not returned-then-hidden.

Two alternatives are **rejected explicitly**:

- **Client-direct Firestore read + UI field-hiding — REJECTED as a data-exposure defect.** Firestore Rules cannot project fields (Assessment §3), so any client-direct read returns whole documents; hiding fields in the UI leaves the privileged data in the delivered payload. This violates the Owner's "unauthorized fields must never be returned by the backend" and is the single largest risk this ADR exists to prevent.
- **Per-field Firestore Security Rules — REJECTED as impossible.** Rules gate document reads, not field reads; there is no rule form that returns a partial document.

The service is **one engine for all objects and all waves**. A wave activates catalog entries and capabilities; it does not add a new engine, query path, or projection mechanism.

### 2.2 The governed metadata catalog is the single source of truth (D2)

Three **static, version-controlled, repository-owned** catalogs — never client-editable, never derived from raw live Firestore schema — drive the whole engine:

- **Object catalog:** each reportable business object by a **stable object identifier** (e.g. `customer`, `equipment`, `workOrder`), mapped to its backing collection, with the object-level read capability required to report on it at all, its activation wave, and its sensitivity posture.
- **Field catalog:** each field by a **stable field identifier** (never a page/component name, never a raw arbitrary Firestore path), carrying its human label, data type, description, the operators it supports (filter/sort/group/aggregate), its **sensitivity classification**, and the **capability required to select, filter, sort, group, aggregate, display, share, schedule, or export it**. A field with no declared read capability is not reportable.
- **Relationship catalog:** each allowed traversal predefined and governed (e.g. `equipment → location`, `workOrder → equipment`), with the direction, cardinality, and the capability governing the traversal.

Because the catalog is the only surface the engine will query against, it is also the guardrail that keeps this a **governed object/field report tool and not a generic query engine over raw Firestore schema** — which the Owner and #325 explicitly forbid.

### 2.3 Field-level read authorization extends ADR-005; this ADR specifies its shape, not its code (D3)

The engine authorizes each field by calling the ADR-005 decision engine (`resolveEffectivePermission(ResolveInput): ResolveResult`, `src/access/resolveEffectivePermission.ts`) for the **field's declared read capability**, in the runner's live Scope, at run time. This requires a **field-level read capability granularity** layered on the existing `resource + action` model — for example a `report.<object>.field.<fieldId>.read` capability class, or a field-set on an object read permission (the exact form is an Owner/#226 decision, §4).

**This ADR does not implement that extension and does not modify #226 code.** ADR-005's authorization engine and catalog are Inventory's lane (Issue #226); this ADR declares the *dependency and its contract* (field-granular read decisions, evaluated server-side, honoring `currentAccessVersion` for freshness) and defers the engine change to that lane. **The ADR must not, and does not, weaken field-level protection or alter ADR-005** — a hard stop of this stage.

### 2.4 Every run, share, schedule, and export re-evaluates permissions; saved definitions confer no access (D4)

A **saved report definition is pure metadata** — an object id, a set of field ids, operators, filters, grouping/sort, and presentation — carrying **no data, no results, and none of its author's privileges**. Execution (interactive, scheduled, shared-open, or export) **re-resolves the runner's current permissions and Scope every time**, and compares against `currentAccessVersion` so a revoked or version-bumped grant cannot be replayed from a stale definition.

Definitions must **tolerate fields becoming unavailable**: if a field a definition names is one the current runner may not read (revoked capability, re-classified sensitivity, or a field removed from the catalog), that field is **dropped from the result and the omission surfaced to the runner** — never returned, and never a hard failure of the whole report. This makes a saved or shared definition safe to open by a lower-privileged user without becoming a privilege-escalation path.

### 2.5 Relationships are predefined, governed, and bounded to one hop at first activation (D5)

Related-object columns come only from the **relationship catalog** (§2.2). **No arbitrary joins.** The first activation wave permits **bounded one-hop** traversals only (e.g. Equipment's Location name); deeper traversal is a later, separately-reviewed capability. A traversal never widens field visibility beyond what the traversed object's own field capabilities allow — the projected columns from a related object are authorized by *that object's* field capabilities, evaluated for the same runner.

### 2.6 Sensitive fields are denied by default and activated only through dedicated security review (D6)

Every field carries a sensitivity classification. **Financial, cost, margin, employee, audit, and other highly sensitive fields are denied by default** and become reportable only when (a) their explicit capabilities are defined and granted and (b) a **dedicated security review** for that sensitive domain passes. This is why the activation waves place sensitive domains (waves 4–5) after the low-sensitivity core (waves 1–3): the engine is built once, but a domain's fields stay dark until its own review clears them.

### 2.7 Report actions are audited through the Enterprise Access immutable Audit Event service (D7)

Report **creation, sharing, scheduling, execution, and export** each emit an immutable Audit Event through the Enterprise Access audit writer (`functions/src/access/auditEventWriter.ts`, `recordStandaloneAuditEvent` / `stageAuditEvent`) — the platform's only audit-*write* path. Report auditing therefore shares that path's Issue #15 deployment gate (Assessment §4.5); the domain operational timeline (`domain/eventModel.js`) persists nothing and is not used for audit.

### 2.8 CSV-first export with bounded execution, row, runtime, and export limits (D8)

**CSV is the first and only export format at first activation.** Export is a **separately-governed capability** distinct from viewing (a runner may view but not export), re-authorized at export time under the same field projection. All execution is **bounded**: maximum result rows, maximum runtime, maximum aggregation cardinality, and export size/row caps — specified in the Specification — so a report cannot become an unbounded scan or an exfiltration channel.

### 2.9 Staged activation is a catalog/capability operation, not a re-architecture (D9)

The six activation waves (Customer/Contact/Location/Equipment → Jobs/WorkOrders/Technicians/ServiceHistory → Inventory/Reorders/POs/Warehouse → Employees/Administration → sensitive Financial/cost/margin/audit fields → Invoice-when-it-exists) each **add object/field/relationship catalog entries and activate capabilities**, gated by their own review. The execution engine, projection, authorization contract, saved-definition model, audit, and export controls are **built once** and unchanged across waves. **Invoice remains catalog-deferred until an Invoice domain model exists**; the static Inventory Part catalog (`src/data/partsCatalog.ts`) is recorded as a **deferred or separately-governed source**, never presented as a live governed collection.

## 3. Reasoning

- **The field-level guarantee is a backend property or it is nothing.** The Assessment proved Rules cannot project fields; therefore the only place "unauthorized fields are never returned" can be enforced is a trusted server that reads privileged and returns projected. Every rejected alternative fails precisely because it leaves privileged data in the payload.
- **One catalog + one engine is what makes "every object, staged in waves" affordable.** If each wave built its own query path, the field-level authorization and audit guarantees would be re-implemented (and re-reviewed, and re-broken) N times. A single metadata-driven engine means a wave is a review of *data* (which fields, which sensitivity, which capabilities) over a *fixed, already-reviewed mechanism*.
- **Re-evaluation-at-run is the only safe saved-definition contract.** A definition that embedded results or author privileges would be an escalation path the moment it is shared or scheduled. Making definitions inert metadata that re-resolve the runner's live access — and gracefully drop now-unreadable fields — is what lets sharing and scheduling exist without a leak.
- **Sensitive-by-default + per-domain review lets breadth and caution coexist.** The Owner wants all objects architected now but activated carefully. Denying sensitive fields until their own review passes is what reconciles "design for everything" with "expose nothing prematurely."
- **This ADR stays inside its lane.** It cites ADR-005's engine and audit writer and declares a field-level read contract *for that lane to implement*; it changes none of Inventory's code, no Rules, no Functions, no #140 tenant model.

## 4. Consequences

- **Enables** a single Specification to catalog all existing objects/fields/relationships and define the field-level read authorization, query/validation, saved reports, sharing/scheduling, export, audit, limits, states, and staged activation — over one architecture.
- **Creates a hard dependency on the Issue #15 Functions lane** (Inventory-owned): the execution/projection/export service is a trusted Function and cannot be activated until #15 is deployed and verified. The report creator is **unavailable-not-unsafe** until then — visibly gated, never a client-direct fallback (the platform's established #15 pattern).
- **Creates a dependency on a field-level read extension to #226** (Inventory-owned): the object/field catalog can be authored now (Specification), but enforcement waits on the engine extension. The Specification must define the capability shape so the two lanes can align.
- **Tenant Scope stays inert (#140).** Cross-tenant report isolation/sharing is out of scope until #140 defines `tenant`; the engine must treat `tenant` as reserved and never widen access on it — matching the existing `access.ts` contract.
- **No production or implementation consequence today.** This is a decision record; nothing ships.

### Open decisions carried to the Specification / Owner (§ "irreducible decisions")

1. The exact **field-level read capability form** (`report.<object>.field.<id>.read` vs a field-set on an object read permission) — coordinate with the #226 lane.
2. Concrete **execution/row/runtime/export limit values**.
3. Whether **scheduling** is in the first activation at all, or design-only until a later wave (the Owner said "design support … but stage activation conservatively").
4. Sharing model specifics (private-only first? governed share to named principals/roles?).

## 5. Governance & scope honored

Documentation only. This ADR changes and authorizes nothing: no application code, `functions/`, Firestore Rules, indexes, permission-engine code, claims, deployment manifest, global project-status document, or production data; it deploys nothing and queries no production. It cites Issue #226 / ADR-005 interfaces without modifying Inventory's active work, does not resolve Issue #140, does not weaken field-level protection, and selects no production deployment action — the hard stops of this stage. The Specification, Implementation Plan, per-wave activations, and each dedicated security review remain separate, later, separately-authorized gates. **Issue #325 stays OPEN.**
