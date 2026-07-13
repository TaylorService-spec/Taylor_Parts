---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-07-13
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/account-commercial-profile-and-financial-forecast-horizons.md, docs/architecture/enterprise-business-metrics-framework.md, docs/BusinessEntityModel.md, docs/PROJECT_ARCHITECTURE.md]
implements: [docs/assessments/account-commercial-profile-and-financial-forecast-horizons.md]
supersedes: []
superseded_by: []
related_pr: null
related_issue: 175
target_release: TBD
---

# Sprint Specification: Account Commercial Profile and Financial Forecast Horizons

**Status: DRAFT.** Not yet reviewed. Derived from the merged, Architecture-Approved Assessment `docs/assessments/account-commercial-profile-and-financial-forecast-horizons.md` (PR #174) and reconciled against the Accepted Enterprise Business Metrics Framework (`docs/architecture/enterprise-business-metrics-framework.md`). Tracking issue: #175.

**This Specification authorizes no implementation.** It defines *what* to build and *what every future build must satisfy*. It does not authorize application code, Firestore Rules/schema/index changes, a financial-provider integration, deployment, migration, production-data access, or any `ROADMAP.md`/global-document edit. Each remains its own separate gate under `docs/ai/workflow.md`; an Implementation Plan is a separate, later authorization. Internal code says "Account"; UI says "Customer" (established convention).

## Executive summary

Adds an **Account Commercial Profile** (payment terms, currency, PO-required, billing contact, tax status, account owner, parent account, invoice delivery method, governed credit status/limit, pricing tier) and defines two provider-gated **Financial Forecast Horizon** families (receivables/cash-collection and pipeline/order). It formalizes the Owner-adopted **name-only human presentation** rule (stable internal IDs, current-name resolution, historical name snapshots). No financial provider exists, so every monetary/forecast surface renders the Framework `unconfigured` state ("Sales data source not connected"), never a fabricated figure.

## Scope

In scope (this Specification defines; a later Implementation Plan sequences):
1. The Commercial Profile fields (Section "Data model").
2. Identity resolution / name-only presentation (Section "Identity").
3. Payment-term semantics incl. governed custom terms.
4. The two forecast-horizon families and their provider-neutral surface.
5. Parent-hierarchy cycle/depth/inheritance rules.
6. Credit status/limit + credit-hold behavior and authorization boundaries.
7. Explicit Firestore Rules / index / provider impacts, and phased acceptance criteria.

Out of scope: connecting a financial provider (external or governed local ledger); computing any real forecast/credit figure; Implementation Plan; code; deployment; production data; Inventory; global-document edits.

## Data model — Commercial Profile fields

All fields are **additive and optional** on the `Account`. "Governed" fields carry authorization/validation weight; "Informational" fields do not gate anything. **Credit fields are stored separately** (see "Rules impact") because Firestore Rules gate document reads, not fields.

| Field | Type | Default | Validation | Class | View / Edit | UI placement |
|---|---|---|---|---|---|---|
| `paymentTerms` | enum `COD`\|`NET_30`\|`NET_60`\|`NET_90`\|`CUSTOM` | absent | enum-only; `CUSTOM` ⇒ `customPaymentTermsId` required | Governed | View admin/dispatcher · Edit admin | Commercial Profile |
| `customPaymentTermsId` | ref → `payment_terms_definitions/{id}` (governed set) | null | required iff `paymentTerms==CUSTOM`; must resolve; **never free text** | Governed | as above | Commercial Profile (shows resolved terms name) |
| `defaultCurrency` | ISO 4217 code string | absent | valid ISO 4217 | Informational | View admin/dispatcher · Edit admin | Commercial Profile |
| `purchaseOrderRequired` | boolean | `false` | boolean | Informational | View/Edit admin/dispatcher | Commercial Profile |
| `billingContact` | `{ contactId }` → `contacts/{id}` | null | `contactId` must belong to this Account | Informational | View/Edit admin/dispatcher | Commercial Profile (resolved contact name) |
| `taxStatus` | enum `TAXABLE`\|`EXEMPT`\|`RESELLER` | `TAXABLE` | enum; `EXEMPT`/`RESELLER` may carry `taxExemptionRef` (future) | Governed | View admin/dispatcher · Edit admin | Commercial Profile |
| `accountOwner` | Person Assignment snapshot `{ assignedToEmployeeId, assignedToUserId, assignedToDisplayName, assignedByEmployeeId, assignedByUserId, assignedAt }` | null | `userId`/`employeeId` must resolve; **never a raw UID entry** | Informational (ownership) | View admin/dispatcher · Edit admin/dispatcher | Account Summary (owner line) |
| `parentAccount` | `{ accountId }` → `accounts/{id}` | null | must exist; **no cycles**; depth ≤ `MAX_HIERARCHY_DEPTH` | Governed/structural | View admin/dispatcher · Edit admin | Commercial Profile (resolved parent name) |
| `invoiceDeliveryMethod` | enum `EMAIL`\|`PORTAL`\|`MAIL`\|`EDI` | absent | enum | Informational | View/Edit admin/dispatcher | Commercial Profile |
| `pricingTier` | `{ pricingTierId }` → governed tier set | null | must resolve | Governed | View admin/dispatcher · Edit admin | Commercial Profile (resolved tier name) |
| `creditStatus` | enum `GOOD_STANDING`\|`REVIEW`\|`ON_HOLD` | `GOOD_STANDING` | enum | **Governed, restricted** | View/Edit **credit-authorized only** (see Credit) | Commercial Profile → Credit subsection |
| `creditLimit` | monetary `{ amountMinor: integer, currency: ISO4217, scale: integer }` (Framework §10) | null | decimal/minor-unit; **never binary float**; currency required | **Governed, restricted** | View/Edit **credit-authorized only** | Commercial Profile → Credit subsection |

`MAX_HIERARCHY_DEPTH` is a named constant (proposed default **5**) — final value is an implementation-plan detail, but the depth cap itself is required.

## Identity — name-only human presentation (Owner-adopted rule)

Implements the Owner-adopted identity rule from the Assessment for every ID-bearing field (`accountOwner`, `billingContact`, `parentAccount`, `pricingTier`, `customPaymentTermsId`).

- **Persistence stores stable internal IDs only** (`contactId`/`accountId`/`userId`+`employeeId`/`pricingTierId`/`customPaymentTermsId`). IDs are the join/authorization key.
- **Current views re-resolve the CURRENT display name from the ID** via a resolver hook (reuse the established pattern: `hooks/useEmployeeDirectory.js`'s `resolveActorDisplayName()` for `accountOwner`; Contact/Account/tier lookups for the others). A rename of the referenced entity shows on next view.
- **No stale cached name is ever the authority.** `accountOwner` carries a snapshot `assignedToDisplayName` (per the Person Assignment Standard), but current views **re-resolve** the current name and use the stored snapshot **only** as the *historical* value in audit events (below) — never as the current-view source of truth.
- **UI fields, approvals, audit views, and ordinary exports show the resolved NAME, never the raw ID.**
- **Unresolved reference ⇒ `"Unknown …"`** (`"Unknown owner"`, `"Unknown contact"`, `"Unknown account"`, `"Unknown pricing tier"`, `"Unknown payment terms"`) — never the raw ID, never a fabricated placeholder.
- **Historical / audit events snapshot the display name used at event time AND retain the internal ID.** When any Commercial Profile field changes, the audit event records: actor ID + actor display-name snapshot, subject ID + subject display-name snapshot, timestamp, prior/new value. The snapshot is immutable (Framework §15 / permanent-record posture) even if the referenced entity is later renamed or removed.

## Payment-term semantics

- Each canonical term maps to an invoice **net-days** offset used only to compute an **invoice due date** (`dueDate = invoiceDate + netDays`): `COD` = 0 (due on delivery), `NET_30` = 30, `NET_60` = 60, `NET_90` = 90.
- **`CUSTOM`** references a **governed** `payment_terms_definitions/{id}` record (net-days, and optionally early-pay discount terms) — a controlled, validated definition, **never free-text terms on the Account**. Creating/curating custom-term definitions is its own governed action (owner + validation), flagged as an authorization decision.
- **Payment terms affect the receivables / cash-collection forecast family ONLY** — they change invoice due dates and projected cash-collection timing. They **do not change Open Pipeline, Booked Value, Committed Backlog, or any "sales" figure.**

## Financial Forecast Horizons

**Two separate families, each rendered under its own labeled sub-section; never combined into one unlabeled total.** Both are provider-gated: with no financial provider connected, each surface renders the Framework five-state contract at `unconfigured` → exact copy **"Sales data source not connected"**, never `$0` or a fabricated figure.

### Family 1 — Receivables / cash-collection horizons
- **Metric basis:** projected **Cash Collected** and **Outstanding Receivables** timing (Framework §3).
- **Date basis:** invoice **due date** (`invoiceDate + payment-term net-days`); the report declares this basis (Framework §12).
- **Cumulative boundaries** (each includes the prior): **Current** = due on/before today (due-now + overdue); **through-30** = due ≤ today+30; **through-60** = ≤ today+60; **through-90** = ≤ today+90.
- **Exclusions:** cancelled/voided invoices; credited amounts reduce per Framework §8; **tax is excluded from any revenue-labeled figure** (§5/§9) though it may be part of the amount owed — the report states which components it includes.
- **Currency & rounding:** each figure carries its currency (§10); normalized to the Account `defaultCurrency` for a combined view **only with recorded FX lineage** (§10); decimal/minor-unit; explicit per-currency scale/rounding; original amounts retained.
- **Lineage:** source Invoice/Payment IDs + versions + `asOf` (§3/§6).

### Family 2 — Pipeline / order horizons
- **Metric basis:** **Open Pipeline** (weighted by opportunity close probability) and **Committed Backlog** (Framework §3).
- **Date basis:** `expectedCloseDate` (pipeline) / expected fulfillment date (backlog) — **not** invoice due date.
- **Probability rules:** Open Pipeline is weighted by each opportunity's close probability; the weighting rule is declared and consistent; cancelled/lost/disqualified opportunities excluded (§3/§7).
- **Cumulative boundaries:** same Current/30/60/90 structure, by *this family's* date basis.
- **Currency/rounding/lineage:** as Family 1, sourced from Sales Order/Opportunity.

### Shared rules
- **Never merge families:** a receivables projection and a pipeline projection are different questions, reported separately with canonical labels (Outstanding Receivables, Cash Collected, Open Pipeline, Committed Backlog) — never a bare "forecast"/"Sales"/"Pending" label.
- **Provider states (§17):** `unconfigured`/`error`/`stale`/`partial`/`complete`; today only `unconfigured` is reachable; the surface reuses the merged Financial Summary five-state view discipline.
- **Visibility (§19):** forecast figures are gated (see Credit/authorization); who may view/export each figure is stated before any real figure ships.

## Parent hierarchy — cycle, depth, inheritance

- **Cycle prevention (required):** setting `parentAccount` walks the prospective ancestor chain; if the Account itself appears, the write is **rejected** (no self-parenting, no cycles). Validated at the write path and (for governed enforcement) considered for Rules.
- **Depth cap (required):** the resulting chain depth must be ≤ `MAX_HIERARCHY_DEPTH` (default 5); deeper is rejected.
- **Inheritance (decision):** in v1 the Commercial Profile is **per-Account only — no automatic inheritance** down the hierarchy. A child does **not** inherit a parent's payment terms, tax status, pricing tier, or credit. Inheritance/roll-up is explicitly **future scope**, not built here.

## Credit — status/limit, hold behavior, authorization

- **Separate storage (required):** `creditStatus`/`creditLimit` live in a **separate access-controlled document** (e.g. `accounts/{id}/private/commercial`), **not** on the main `accounts` document — because Firestore Rules gate *document* reads, not fields, and credit visibility must be restricted more tightly than general Account read. This is the load-bearing architectural decision for credit visibility.
- **Authorization boundaries (Framework §19):** view/edit of the credit document is restricted to **credit-authorized principals**. Today the only available security roles are `admin`/`dispatcher`/`technician`; v1 restricts credit to **admin only**, and flags a **finer-grained finance/credit role** as a required governance decision before wider rollout. Dispatcher and technician cannot read the credit document.
- **`ON_HOLD` behavior:** surfaced prominently on the Account (a clear warning banner). **Hard enforcement** (blocking new commercial commitments — e.g. Work Order/order creation) is defined as the intent but is **deferred**: the commitment-creation path (`createWorkOrder`) is Cloud-Function-gated and not deployed, so v1 **surfaces** the hold and defers blocking to the layer that creates a commercial commitment, once that path is live. The spec records the enforcement point; it does not implement it.
- **`creditLimit` monetary representation:** Framework §10 in full (currency, decimal/minor-unit, scale/rounding) — never a bare number, never binary float.

## UI placement

- **Account Summary:** `accountOwner` (resolved current name, "Unknown owner" if unresolved) as an owner line.
- **New "Commercial Profile" section** on the Account page (a readable section, consistent with the sectioned layout): payment terms (resolved custom-terms name when `CUSTOM`), default currency, PO-required, billing contact (resolved name), tax status, parent account (resolved name), invoice delivery method, pricing tier (resolved name). A **Credit subsection** renders only for credit-authorized viewers.
- **Financial Forecast Horizons** render within/adjacent to the existing provider-neutral **Financial Summary** surface, as two separately-labeled family sub-sections; today both show `unconfigured`.
- **Empty/loading/error/unresolved states:** every ID field shows loading, then the resolved name, "Unknown …" (unresolved), or is omitted if unset; forecast/credit follow the five-state provider contract (never `$0`).

## Firestore Rules / index / provider impacts (explicit)

- **Rules — informational additive fields:** none needed (the `accounts` rule has no field-level validation today; same posture that admitted `relationshipTypes`).
- **Rules — governed non-financial fields** (`paymentTerms`/`taxStatus`/`pricingTier`/`parentAccount`, and the custom-terms/pricing-tier governed collections): **may require Rules-level validation/authorization** (enumerated values, edit-authorization, cycle guard). This is a **Tier 2** change (`firestore.rules`) requiring its own Architecture Review + Owner authorization.
- **Rules — credit document:** the separate `accounts/{id}/private/commercial` (or equivalent) document **requires its own Rules** restricting read/write to credit-authorized principals — **Tier 2**, separate authorization.
- **Indexes:** any filtered/list view ("accounts by owner / by parent / by credit status / by payment terms") needs its own composite index, delivered as an **index-only PR** with separate Merge + Deployment authorization + `[READY]` verification (the PR #167 pattern). None is created by this Specification.
- **Provider:** all forecast figures and any real credit exposure require a **financial provider** (Framework §17); none exists, so surfaces render `unconfigured`. Connecting a provider is a **separate future initiative** with its own gates.

## Phased acceptance criteria

Each phase is its own Implementation Plan + PR(s) + gates; nothing here authorizes a phase.

- **Phase 1 — informational profile + identity (no Rules change):** `defaultCurrency`, `purchaseOrderRequired`, `invoiceDeliveryMethod`, `billingContact`, `accountOwner`, and non-`CUSTOM` `paymentTerms`; the Commercial Profile section; full identity resolution (current-name resolution, "Unknown …", audit snapshots). Acceptance: fields additive, no existing Account breaks, every ID renders a resolved name/"Unknown", no raw ID anywhere, no financial figure.
- **Phase 2 — governed non-financial (Tier 2 Rules):** `taxStatus`, `pricingTier`, `parentAccount` (cycle + depth), `CUSTOM` payment terms via the governed definitions collection. Acceptance: enumerated/governed values validated; cycle/depth rejected; edit-authorization enforced; Rules change reviewed + deployed + verified.
- **Phase 3 — credit (Tier 2 Rules, restricted doc):** credit document + its Rules; credit view/edit restricted to credit-authorized; `ON_HOLD` surfaced; §19 visibility/masking/export answered. Acceptance: dispatcher/technician cannot read credit; `creditLimit` currency-correct; hold banner shows; no hard-block claimed beyond what's implemented.
- **Phase 4 — forecast-horizon surface (provider-neutral):** the two labeled family sub-sections rendering the five-state contract, `unconfigured` only, never `$0`; both families' definitions (metric/date/boundary/exclusion/currency/lineage) encoded but not computed. Acceptance: exact `unconfigured` copy; no figure; families never merged.
- **Phase 5 — provider integration (separate future initiative):** connect a financial provider → real receivables/pipeline forecast + credit figures under the full Framework §10/§17/§19 contract. Not part of this initiative's build sequence.

## Testing strategy

- **Pure logic (Node assertion tests, the repo's convention):** payment-term → net-days/due-date mapping; forecast cumulative-boundary bucketing per family; parent-cycle and depth detection; identity resolution (current name vs "Unknown" vs historical snapshot); the forecast/credit five-state render views (extending `financialSummaryView`).
- **Browser (driver):** Commercial Profile section renders resolved names (never raw IDs), "Unknown …" fallbacks, the `unconfigured` forecast families, credit-subsection visibility gating, accessibility, and responsive layout.
- No React test renderer is added; the `verify-*` driver + standalone-Node pattern is reused.

## Open questions (for Specification review)

1. The finer-grained finance/credit role (vs admin-only in v1) — when and how introduced.
2. `MAX_HIERARCHY_DEPTH` exact value and whether depth is enforced in Rules or only the write path.
3. Governed `payment_terms_definitions` / pricing-tier collection shapes and their own authorization (each likely its own small governed collection + Rules).
4. Exact receivables-horizon component policy (which invoice components count toward each bucket — Framework §3 deployment policy).

## Approval

**Draft — pending ChatGPT Specification Final Review and Owner authorization.** No architecture approval, merge authorization, or implementation authorization is claimed. Authorizes no application code, Rules/schema/index change, provider integration, deployment, production-data action, Implementation Plan, or global-document edit.
