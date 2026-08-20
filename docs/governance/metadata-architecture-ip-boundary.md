# EOS Governance Boundary — Metadata Architecture / Third-Party IP

**Status:** PROTECTED ARCHITECTURE + IP GOVERNANCE BOUNDARY
**Authority:** Owner ruling, 2026-08-17. Recorded per its own §13.
**Scope:** Continuing governance rule. Not a one-work-package instruction.
**Related:** `../DECISIONS.md` #102 · `../architecture/SYSTEM_AUTHORITIES.md` · `../DelegationCharter.md`

> **For future agents.** "Salesforce-style", "Salesforce-class", and
> "like Salesforce" appear in EOS conversation and planning. None of them is
> permission to clone Salesforce. This document is what those phrases actually
> authorize. Read §3 and §12 before implementing anything described that way.
>
> The Metadata Architecture specification, when it is written, **must** link
> back to this document (§13). This boundary exists before that spec
> deliberately: the constraint precedes the design.

## Purpose

EOS is moving toward a metadata-driven enterprise application architecture.

Salesforce and other enterprise platforms may be studied as examples of mature
metadata-driven systems, but EOS must remain an independently designed and
implemented platform.

The architectural goal is:

    Salesforce-class configurability
    +
    EOS-native operational UX
    +
    EOS-native governed command/capability architecture

This is **NOT** authorization to clone Salesforce.

---

## 1. Independent implementation rule

EOS metadata architecture must be derived from:

- EOS business requirements
- EOS existing architecture
- generally understood enterprise software patterns
- independently designed abstractions
- interoperability requirements where applicable

Do not derive EOS implementation by reproducing Salesforce proprietary
implementation details.

Every major metadata abstraction should be defensible from an EOS requirement,
not merely because Salesforce implements something similarly.

Preferred EOS-native conceptual vocabulary includes, where appropriate:

- `EntityDefinition`
- `FieldDefinition`
- `RelationshipDefinition`
- `PageDefinition`
- `PageRegion`
- `ComponentDefinition`
- `ActionDefinition`
- `ListDefinition` / `ListViewDefinition`
- `VisibilityRule`
- `CapabilityRequirement`
- `ProcessDefinition`
- `WorkflowDefinition`
- `TenantConfiguration`

These names are illustrative, not mandatory. Choose terminology that best fits
the EOS domain.

## 2. Allowed reference use

Claude MAY review public documentation from Salesforce or other enterprise
systems to understand broad architectural patterns such as:

- metadata-driven configuration
- entities and fields
- relationships
- configurable record pages
- page regions and sections
- custom fields
- list views
- filtering and sorting
- record types / contextual layouts as an architectural concept
- configurable actions
- visibility conditions
- admin configuration interfaces
- human-readable business identifiers

These concepts must then be independently translated into EOS architecture.

Public documentation may inform architectural understanding.

It must not become a specification to copy.

## 3. Prohibited copying

DO NOT:

- copy Salesforce source code
- copy Lightning component code
- copy proprietary JavaScript, CSS, Apex, metadata files, or schemas
- scrape or reuse Salesforce UI assets
- reuse Salesforce icons or graphics
- reproduce Salesforce screenshots in the EOS product
- reproduce Salesforce pages pixel-for-pixel
- copy proprietary documentation text
- clone Salesforce API schemas
- mechanically reproduce Salesforce Metadata API structures
- reproduce Salesforce-specific internal identifiers or property structures
- use Salesforce trademarks as EOS product/module/feature names
- create branding or UI likely to imply Salesforce affiliation
- reverse engineer Salesforce services to discover proprietary implementation
- use a Salesforce Developer Org/API as a mechanism to reconstruct competing
  proprietary functionality unless separately authorized

If implementation requires any of the above, **STOP**.

## 4. UX governance

Do not implement a requirement phrased merely as:

    "make it look like Salesforce"

Translate such requests into the actual enterprise UX requirement.

For example:

> **BAD:** Copy the Salesforce Account page.
>
> **GOOD:** Build an EOS record page with:
> - contextual record header
> - configurable highlights
> - structured regions
> - related entities
> - operational activity
> - governed actions
> - metadata-driven visibility

EOS must retain its own:

- visual language
- navigation
- typography
- spacing
- component styling
- icons
- operational cards
- workflow visualization
- attention patterns
- interaction patterns

Common enterprise UI conventions are allowed.

Salesforce visual duplication is not.

## 5. EOS architectural differentiation

Salesforce is primarily a record-centric reference model.

EOS must remain **operation-centric**.

Metadata must support not only fields and record layout but operational
components such as:

- lifecycle state
- readiness
- blockers
- next actions
- approvals
- work queues
- inventory demand
- parts readiness
- technician assignment
- equipment lifecycle
- custody/location
- attention projections
- governed actions
- AI recommendations
- workflow progression

Do not allow the metadata migration to reduce EOS into generic CRUD screens.

## 6. Authorization boundary

Page metadata and visibility **NEVER** constitute authorization.

Metadata may determine:

- whether a component is rendered
- where it appears
- which fields are presented
- which action affordances are shown

Metadata must **NOT** independently grant authority.

Existing EOS governed capability / trusted-command architecture remains the
authorization authority.

Example:

    PageDefinition says:
        show "Dispatch"

    Trusted command says:
        user may or may not dispatch

    The trusted command wins.

Never introduce generic metadata-driven client writes that bypass governed
commands, Functions, Rules, capability evaluation, or established authority.

## 7. Data model vs presentation model

Maintain explicit separation between:

| Layer | Question it answers |
|---|---|
| Entity metadata | What business object exists? |
| Field metadata | What data exists? |
| Relationship metadata | How entities relate? |
| Page metadata | How information is composed? |
| List metadata | How collections are displayed / query-shaped? |
| Action metadata | What operations are exposed? |
| Capability metadata | Who may perform them? |
| Workflow metadata | What transitions/processes are valid? |
| Tenant metadata | What may a customer configure? |

Do not collapse these into one large page-schema object.

## 8. Metadata runtime rule

Prefer a registry/runtime architecture:

    metadata definition
        ↓
    validation
        ↓
    capability/visibility evaluation
        ↓
    component registry
        ↓
    EOS renderer/runtime

Avoid metadata that contains arbitrary executable client code.

Configuration should reference governed components/actions rather than allowing
tenant-authored JavaScript or unrestricted execution.

## 9. Enterprise scale rule

Metadata-driven screens must not imply client-side dataset ownership.

Lists and related-record surfaces should be compatible with enterprise volume:

- cursor pagination
- bounded reads
- stable sorting
- server-shaped queries
- URL-persisted filters where appropriate
- indexed query paths
- no "load the collection and filter locally" architecture

External/full-text search infrastructure is not required merely because the
metadata system exists. Add it when search requirements / data volume justify
it.

## 10. Design provenance

For material metadata architecture decisions, record WHY EOS needs the
abstraction.

Preferred decision trace:

    EOS business requirement
        ↓
    architecture requirement
        ↓
    EOS design decision
        ↓
    independent implementation

Avoid:

    Salesforce feature
        ↓
    EOS equivalent

Documentation may note that an approach follows established enterprise
metadata-driven patterns, but should describe EOS's requirement and design
rather than treating another vendor as the normative specification.

## 11. Third-party terminology

Generic industry terminology may be used where it is genuinely generic.

When terminology is strongly vendor-specific or creates unnecessary coupling,
prefer EOS-native terminology.

Do not rename concepts merely for cosmetic differentiation if the term is a
normal industry term.

The objective is architectural independence, not a thesaurus exercise.

## 12. Governance stop conditions

Claude may autonomously:

- design EOS metadata models
- build metadata registries
- create metadata-driven components
- migrate EOS pages to the architecture
- introduce page/list/entity abstractions
- add tests
- document architecture
- refactor EOS-owned code

Claude **MUST STOP AND ESCALATE** before:

- **A.** copying or adapting third-party proprietary source code;
- **B.** importing third-party proprietary assets;
- **C.** deliberately duplicating a vendor UI pixel-for-pixel;
- **D.** recreating a vendor-specific proprietary API/schema primarily for
  compatibility without an approved interoperability requirement;
- **E.** using reverse-engineered implementation information;
- **F.** introducing a dependency on Salesforce APIs/services for EOS core
  metadata operation;
- **G.** changing the EOS authorization/governance model to accommodate
  metadata;
- **H.** allowing metadata to bypass trusted governed commands;
- **I.** creating unrestricted executable tenant metadata;
- **J.** making a legal/IP interpretation necessary to proceed where the answer
  is genuinely uncertain.

When stopping, provide:

1. exact proposed action;
2. why it crosses this boundary;
3. files/components affected;
4. safer independent alternative, if one exists;
5. decision required from Owner.

Do not cross the boundary merely because the implementation would be easier.

## 13. Repository governance

Record this boundary durably in the repository's authoritative architecture /
governance documentation.

Also reference it from the Metadata Architecture specification so future agents
cannot interpret "Salesforce-style" as permission to clone Salesforce.

This is a continuing governance rule, not a one-work-package instruction.

Existing repository governance remains in force.

If repository conventions specify a canonical location for protected
architecture decisions, use that location rather than creating a competing
governance system.

> **Recorded here as:** this document (`docs/governance/`, the canonical home
> for continuing governance rules), indexed by `docs/DECISIONS.md` #102 and by
> the Product Authority table in
> `docs/architecture/SYSTEM_AUTHORITIES.md`. No competing governance system was
> created. The Metadata Architecture specification now exists at
> `docs/specifications/metadata-architecture.md` and carries the back-reference this
> section requires, as its own stated acceptance condition — so the requirement is
> discharged by an artifact rather than left as a promise.

## 14. Initial architecture direction

Before broadly redesigning EOS pages, establish the minimum reusable metadata
foundation.

Initial target should distinguish at least:

- `EntityDefinition`
- `FieldDefinition`
- `RelationshipDefinition`
- `PageDefinition`
- `PageRegion`
- `ComponentDefinition`
- `ListViewDefinition`
- `ActionDefinition`
- `VisibilityRule` / `CapabilityRequirement`

Do not attempt to build the complete future no-code platform in v1.

Build enough metadata/runtime infrastructure to prove the architecture through
real EOS consumers.

Recommended early consumers:

| Consumer | What it proves |
|---|---|
| Accounts list | list metadata, filtering, sorting, pagination |
| Account record | record-page composition |
| Contacts | first-class related entity architecture |

Then validate the same framework against a non-CRM operational domain such as
**Work Orders**.

The Work Order validation is important: if the architecture only works well for
CRM records, it is not yet an EOS metadata architecture.

## 15. Definition of success

The desired result is **NOT**:

    "EOS looks like Salesforce."

The desired result is:

    "EOS has an independently implemented, enterprise-grade metadata runtime
     capable of Salesforce-class configurability while preserving EOS's
     operational model, governed authority, visual identity, and AI-native
     architecture."

Treat that sentence as the governing design test.
