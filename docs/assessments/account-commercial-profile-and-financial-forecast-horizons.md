---
artifact_type: assessment
gate: Repository Assessment
status: Draft
date: 2026-07-13
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/customer-account-business-model.md, docs/specifications/customer-account-business-model.md, docs/architecture/enterprise-business-metrics-framework.md, docs/BusinessEntityModel.md, docs/PROJECT_ARCHITECTURE.md]
implements: []
supersedes: []
superseded_by: []
related_pr: null
related_issue: 158
target_release: Post-Release 2.1 (Inventory → Procurement chain)
---

# Assessment Report: Account Commercial Profile and Financial Forecast Horizons

**Status: DRAFT.** Not yet reviewed. Expands the previously-scoped "Customer Financial Forecast Horizons" assessment into the broader **Account Commercial Profile and Financial Forecast Horizons**, building on the merged, live Customer/Account Business Model work (Assessment PR #161, Specification/Implementation Plan PR #166, implemented via PR #167/#169/#170/#172) and reconciled against the Accepted Enterprise Business Metrics Framework (`docs/architecture/enterprise-business-metrics-framework.md`).

**This is a documentation-only Assessment and authorizes nothing.** It does not implement any field, edit `ROADMAP.md` or any other global document, change Firestore Rules/schema/indexes, connect or read financial data, access production data, or touch Inventory. Every such action remains its own separate gate under `docs/ai/workflow.md`. This document defines *what the profile is and what a future build must satisfy*; a Specification (if the Owner authorizes one after Architecture Review) is a separate step.

## Scope of this assessment

Investigated, read-only:
- The current `Account` shape (`field-ops-app-vite/src/domain/accounts.js`) and the fields the merged Customer work already added (`relationshipTypes`, PR #169).
- `docs/architecture/enterprise-business-metrics-framework.md` (financial terminology, monetary representation, provider contract, forecast/date basis, authorization).
- The merged `docs/assessments/customer-account-business-model.md` + `docs/specifications/customer-account-business-model.md` (the provider-neutral Financial Summary surface and its five-state contract).
- `docs/PROJECT_ARCHITECTURE.md`'s Person Assignment Platform Service Standard and `docs/BusinessEntityModel.md` Section 8a (identity separation, assignment snapshot), plus the display-name resolution precedent already shipped for Reorder Request assignees (PR #105/#107/#118).

Explicitly **not** addressed here: any application code, Firestore Rules/schema/index change, provider integration, migration, deployment, production-data action, `ROADMAP.md`/global-document edit, or Inventory work.

## Current repository state

- **`Account` today:** `{ id, name, billingAddress?, status?, relationshipTypes?, notes?, tags?, customerNumber?, erpId?, accountingId?, legacyId?, createdAt, updatedAt }`. None of the commercial-profile fields below exist. The four external identifiers are integration pass-through only (nothing reads them).
- **No commercial-profile field exists** — no payment terms, currency, PO-required, billing contact, tax status, account owner, parent account, invoice delivery method, credit, or pricing tier anywhere in the repo.
- **No forecast entity or field exists**, and **no financial provider is connected** — per Framework Section 20 the platform is `unconfigured`; the merged Financial Summary surface (PR #172) already renders exactly "Sales data source not connected" and no financial data. Forecast horizons inherit that state.
- **Related existing entities** the profile references: `Contact` (`contacts/{id}`, Account-linked) for `billingContact`; the Person Assignment Platform Service Standard (`employees`/`users`) for `accountOwner`; and `Account` itself for `parentAccount` (a self-reference / hierarchy).

## Proposed Account Commercial Profile fields (assessment — none implemented)

Each field is **additive, optional** on `accounts`. Several are **governance-bearing** (authorization/validation weight) and are flagged as such — those are not plain additive fields and must not ship without their own governance decisions.

| Field | Proposed shape | Identity / resolution | Framework / governance notes |
|---|---|---|---|
| `paymentTerms` | Enum: `COD` \| `NET_30` \| `NET_60` \| `NET_90` \| `CUSTOM` | — | **Governed.** A `CUSTOM` value must reference a **governed custom-terms definition**, never free text — custom terms need a governance owner, an enumerated/validated representation, and their own authorization. Commercial-commitment metadata, not a monetary amount (creates no revenue). |
| `defaultCurrency` | ISO 4217 code (Framework Section 10) | — | Sets the Account's default currency for any future monetary document. A code only — carries no amount. Every monetary field elsewhere must carry its own currency; this is a default, not an authority. |
| `purchaseOrderRequired` | Boolean | — | Process metadata: whether a customer PO is required before work/billing. Informational to workflow, no monetary value. |
| `billingContact` | Reference to a `contacts/{id}` on this Account | **Resolved to the contact's display name** (Identity rule below). Unresolved → "Unknown contact". | Must be a Contact belonging to this Account. |
| `taxStatus` | Governed enum (e.g. `TAXABLE` \| `EXEMPT` \| `RESELLER`) | — | **Governed.** An exemption may require a certificate reference (future). Tax treatment is Framework Section 9 territory (tax is never folded into revenue metrics); the status is a compliance-bearing control. |
| `accountOwner` | A person reference via the **Person Assignment Platform Service Standard** (`assignedToEmployeeId`/`assignedToUserId`/`assignedToDisplayName` snapshot), never a raw UID | **Resolved to the owner's display name.** Unresolved → "Unknown owner". | Reuses the existing standard (PROJECT_ARCHITECTURE / BusinessEntityModel 8a); does not introduce a new person-reference pattern. |
| `parentAccount` | Reference to another `accounts/{id}` | **Resolved to the parent Account's name.** Unresolved → "Unknown account". | **Governed/structural.** Account hierarchy — needs cycle prevention and a decision on depth and whether the commercial profile inherits down the hierarchy (open questions below). |
| `invoiceDeliveryMethod` | Enum (e.g. `EMAIL` \| `PORTAL` \| `MAIL` \| `EDI`) | — | Billing-process metadata; no monetary value. |
| Credit: `creditStatus` + `creditLimit` | `creditStatus` governed enum (e.g. `GOOD_STANDING` \| `ON_HOLD` \| `REVIEW`); `creditLimit` a **monetary value** (Framework Section 10: currency-aware, decimal/minor-unit, explicit scale/rounding — never binary float) | — | **Governed, authorization-bearing.** A credit limit/status is a control, not a revenue metric. Who may set it and who may view it are Framework Section 19 questions; on-hold enforcement semantics are undefined here. The limit value is governance/provider-sourced, never fabricated. |
| Pricing tier: `pricingTier` | Reference to a governed pricing-tier set | **Resolved to the tier's display name** | **Governed.** The Account carries only the *tier assignment* — pricing authority itself lives in a future commercial domain (Quote / Sales Order), not on the Account. No prices are stored here. |

**Cross-cutting:** all of the above are additive and optional; none is implemented by this Assessment. The monetary element (`creditLimit`) is subject to Framework Section 10 in full. The governed fields (`paymentTerms`/`taxStatus`/credit/`pricingTier`/`parentAccount`) each raise an authorization/validation decision that is a **Tier 2** matter (potential `firestore.rules` involvement) requiring separate Architecture Review and Owner authorization — flagged, not decided here.

## Financial Forecast Horizons (Current / 30 / 60 / 90-day, cumulative)

- **Definition (structure only):** four **cumulative** horizons — **Current**, **through-30**, **through-60**, **through-90** days — where each horizon includes the prior (Current ⊆ 30 ⊆ 60 ⊆ 90). An aging/forecast view over the Account's receivables and/or committed pipeline.
- **Governed as financial (Framework Sections 1/3/14/17):** a forecast horizon is a **financial figure** and requires an **authoritative source** — the provider entities (Invoice/Payment for receivables aging; Sales Order/Opportunity for committed/pipeline forecast) that **do not exist today** (Section 20). Therefore this Assessment defines the horizons' **structure and semantics only**; **no value is computable now**, and none may be fabricated.
- **Provider-neutral, five-state contract:** like the merged Financial Summary surface, a forecast-horizons surface renders the Framework's five-state provider contract (`complete`/`partial`/`stale`/`error`/`unconfigured`). Today it is `unconfigured` → "Sales data source not connected"; **never a fabricated `$0` or forecast number**.
- **Canonical basis (Framework Section 21):** each horizon must declare its **metric basis** (e.g. Outstanding Receivables aging by due date; Committed Backlog by expected fulfillment date; Open Pipeline weighted by expected close), **date basis** (Section 12), **currency/scale/rounding** (Section 10), inclusion/exclusion, and lineage. Never a bare "forecast" number, never a bare "Sales"/"Pending" label.
- **Cumulative-boundary semantics** (exact bucket edges, and which date field drives them) are an **open decision** dependent on the future financial provider's date fields — not fixed here.
- **Explicitly:** no forecast computation, no provider connection, no production-data access — definition/structure only.

## Identity resolution rule (cross-cutting, platform-level)

Formalizes the Owner-specified rule, generalizing what the platform already does for person references (Person Assignment Platform Service Standard) and for Reorder Request assignee display (PR #105/#107/#118). **This is the standing pattern made explicit for every ID-bearing reference on the Commercial Profile** (`accountOwner`, `billingContact`, `parentAccount`, `pricingTier`), not new architecture.

1. **Backend/persistence uses stable internal IDs** for joins, referential integrity, and authorization (`accountOwner`→`userId`/`employeeId`, `billingContact`→`contactId`, `parentAccount`→`accountId`). IDs are the source of truth for machine processes.
2. **Every human-reviewable process resolves and includes the display name** alongside (never instead of) the ID it carries internally.
3. **UI fields, approvals, audit views, and ordinary exports show the resolved NAME, never the raw ID.**
4. **Unresolved references display "Unknown …"** (e.g. "Unknown owner", "Unknown contact", "Unknown account") — **never the raw ID**, and never a fabricated placeholder value.
5. **Historical/audit events retain the internal ID AND snapshot the display name used at the time** — an immutable record of the name as it read when the event occurred, even if the entity is later renamed or removed. This matches the assignment-snapshot pattern (BusinessEntityModel 8a: `assignedToDisplayName`) and the platform's permanent-record posture (no destructive rewrite of history).

This rule binds all ID-bearing fields introduced by any future Commercial Profile specification.

## Schema / Rules / index / authorization impact (assessed, not implemented)

- **Additive fields on `accounts`, no migration** — absent until set; nothing reads them until built. The `accounts` rule has no field-level validation today (same posture that let `relationshipTypes` be added without a Rules change), so *merely allowing* the informational fields needs no Rules change.
- **Governed fields may warrant Rules-level validation/authorization** — `paymentTerms`/`taxStatus`/`creditStatus`/`creditLimit`/`pricingTier`/`parentAccount` carry authorization/compliance weight; deciding who may set/view them (and validating enumerated/governed values) is a **Tier 2** decision (`firestore.rules`), requiring separate Architecture Review and Owner authorization. Not decided here.
- **Financial visibility (Framework Section 19):** `creditLimit`, the forecast horizons, and any monetary figure require explicit per-metric visibility/masking/export rules **before any real figure ships**. Not decided here.
- **Indexes:** a future filtered view ("accounts by owner / by parent / by credit status") would need its own composite index *at that time* — none now, and index work is its own separate PR + deployment gate (the pattern PR #167 established).
- **No provider integration** — credit and forecast values are governance/provider-sourced, never fabricated; the surfaces render the five-state contract until a provider exists.

## Framework Required Decision Checklist (Section 21) — for the financial elements

For every future financial figure (`creditLimit`, each forecast horizon), the eventual Specification must state: exact metric; owning domain; authoritative collection/aggregate; included/excluded statuses; date field + `asOf`; tax and discount treatment; currency/scale/rounding; cancellation/credit/refund handling; partial-fulfillment behavior; stored vs derived + full lineage; provider state contract (Section 17); per-metric visibility/masking (Section 19); and audit evidence. **All monetary elements are unavailable today** (no provider) and must follow Sections 10/17/19 when a provider is eventually connected — a separate future initiative.

## Open questions / decisions for Architecture Review

1. **Custom payment terms:** governance owner, validation, and representation (enumerated/governed, not free text).
2. **Credit status/limit:** who sets it, who sees it (Section 19), monetary representation (Section 10), and `ON_HOLD` enforcement semantics (does it block order/work creation, and where).
3. **`parentAccount` hierarchy:** maximum depth, cycle prevention, and whether the commercial profile (terms, tax, pricing) inherits down the hierarchy or is per-Account only.
4. **Pricing tier:** its relationship to the future Quote/Sales Order pricing authority (the Account carries assignment only; prices live in the commercial domain).
5. **Forecast horizons:** exact cumulative bucket boundaries, the driving date field, and each horizon's canonical metric basis — all dependent on the future financial provider.
6. **Field classification:** which Commercial Profile fields are Tier 2 (Rules/authorization) vs additive-only.
7. **`accountOwner` shape:** full six-field Person Assignment snapshot vs a lighter reference (still resolved to a display name per the Identity rule).

## Risks

- **Financial mislabeling:** forecast horizons and credit values must never render a fabricated figure or `$0`; provider-neutral five-state contract and canonical vocabulary only (the discipline already shipped in the Financial Summary surface).
- **Governance creep:** credit, tax, and payment terms carry authorization/compliance weight — shipping them as plain additive fields without their governance decisions would be a defect.
- **Identity leakage:** any raw ID surfacing in a UI field, approval, audit view, or ordinary export violates the Identity rule — "Unknown …" fallback and snapshotted historical names are mandatory.
- **Scope:** this Assessment defines/assesses only; connecting a real financial provider and building any field are separate future initiatives, each with its own gates.

## Disposition

**Documentation-only Assessment (Draft).** Authorizes no field implementation, Firestore Rules/schema/index change, provider integration, deployment, production-data access, or global-document edit. Next gate: ChatGPT Architecture Review; a Specification, if authorized afterward, is a separate step. Issue #158 remains the tracking issue.
