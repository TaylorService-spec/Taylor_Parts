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
| `paymentTerms` | enum `COD`\|`NET_30`\|`NET_60`\|`NET_90`\|`CUSTOM` | absent | enum-only; `CUSTOM` ⇒ `customPaymentTermsId` required | **Governed** | View admin/dispatcher · Edit admin — **enforced via Rules / trusted write, not UI hiding** | Commercial Profile |
| `customPaymentTermsId` | ref → `payment_terms_definitions/{id}` (governed set) | null | required iff `paymentTerms==CUSTOM`; must resolve; **never free text** | Governed | as above | Commercial Profile (shows resolved terms name) |
| `defaultCurrency` | ISO 4217 code string | absent | valid ISO 4217 | Informational | View admin/dispatcher · Edit admin | Commercial Profile |
| `purchaseOrderRequired` | boolean | `false` | boolean | Informational | View/Edit admin/dispatcher | Commercial Profile |
| `billingContact` | `{ contactId }` → `contacts/{id}` | null | `contactId` must belong to this Account | Informational | View/Edit admin/dispatcher | Commercial Profile (resolved contact name) |
| `taxStatus` | enum `UNKNOWN`\|`TAXABLE`\|`EXEMPT`\|`RESELLER` | absent, treated as **`UNKNOWN`** — **never silently `TAXABLE`** | enum; `EXEMPT`/`RESELLER` may carry `taxExemptionRef` (future) | Governed | View admin/dispatcher · Edit admin (Rules/trusted write) | Commercial Profile |
| `accountOwner` | Person Assignment snapshot `{ assignedToEmployeeId, assignedToUserId, assignedToDisplayName, assignedByEmployeeId, assignedByUserId, assignedAt }` | null | `userId`/`employeeId` must resolve; **never a raw UID entry** | Informational (ownership) | View admin/dispatcher · Edit admin/dispatcher | Account Summary (owner line) |
| `parentAccount` | `{ accountId }` → `accounts/{id}` | null | must exist; **no cycles**; depth ≤ `MAX_HIERARCHY_DEPTH` | Governed/structural | View admin/dispatcher · Edit admin | Commercial Profile (resolved parent name) |
| `invoiceDeliveryMethod` | enum `EMAIL`\|`PORTAL`\|`MAIL`\|`EDI` | absent | enum | Informational | View/Edit admin/dispatcher | Commercial Profile |
| `pricingTier` | `{ pricingTierId }` → governed tier set | null | must resolve | Governed | View admin/dispatcher · Edit admin | Commercial Profile (resolved tier name) |
| `creditStatus` | enum `REVIEW_REQUIRED`\|`GOOD_STANDING`\|`ON_HOLD` | absent, treated as **unavailable / review-required** — **never silently `GOOD_STANDING`** | enum; only ever set by the authorized governance writer, with source + `asOf` + audit lineage (see Credit) | **Governed, restricted** | View/Edit **credit-authorized only** (see Credit) | Commercial Profile → Credit subsection |
| `creditLimit` | monetary `{ amountMinor, currency: ISO4217, scale }` **+ lineage `{ source, asOf, setBy }`** (Framework §10/§17) | null — **unavailable**, never a fabricated value | decimal/minor-unit, never binary float, currency required; **present only with source + `asOf` + authorization + audit lineage** | **Governed, restricted** | View/Edit **credit-authorized only** | Commercial Profile → Credit subsection |

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

- **`paymentTerms` on the Account is only the DEFAULT applied to NEW invoices at issue time** — never a live driver of already-issued invoices.
- **Due-date basis per term:** `NET_30`/`NET_60`/`NET_90` are net-days from the **invoice issue date** (`dueDate = invoiceIssueDate + netDays`). **`COD` is due against the authoritative delivery / fulfillment event** (the fulfillment/completion the provider records), **not** automatically `invoiceDate + 0` — its due date is that event's date.
- **Invoices snapshot the terms applied at issue.** An issued invoice records the **terms code, net-days, basis event, and computed due date** used at that moment — an immutable snapshot (Framework §12/§15).
- **No retroactive change.** A later change to the Account's `paymentTerms` applies only to invoices issued **after** the change; it **must never retroactively alter the due date of an already-issued invoice**.
- **`CUSTOM`** references a **governed** `payment_terms_definitions/{id}` record (net-days / basis / optional early-pay discount) — a controlled, validated definition, **never free-text terms on the Account**. Curating custom-term definitions is its own governed action (owner + validation), flagged as an authorization decision.
- **Payment terms affect the receivables / cash-collection family ONLY** — they set invoice due dates and therefore projected-collection timing. They **do not change Open Pipeline, Booked Value, Committed Backlog, or any "sales" figure.**

## Financial Forecast Horizons

**Two separate families, each rendered under its own labeled sub-section; never combined into one unlabeled total.** Both are provider-gated: with no financial provider connected, each surface renders the Framework five-state contract at `unconfigured` → exact copy **"Sales data source not connected"**, never `$0` or a fabricated figure.

### Family 1 — Receivables / cash-collection horizons
- **Three distinct, separately-labeled figures — never conflated:** **Cash Collected** = *actual* cash already received and applied (a historical fact, Framework §3), **never a forecast**; **Outstanding Receivables** = the *current* invoiced-but-uncollected balance (a present fact); **Projected Collections** = the **forecast** of expected future receipts, bucketed by due date. **The Current/30/60/90 horizons are `Projected Collections`** — forecast terminology, not "Cash Collected".
- **Metric basis:** the horizons project **Projected Collections** from Outstanding Receivables by due date; actual **Cash Collected** and current **Outstanding Receivables** are shown as their own labeled figures alongside, never folded into the projection.
- **Date basis:** each invoice's **snapshotted due date** (from its issue-time payment terms, above); the report declares this basis (Framework §12).
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

- **Cycle & depth integrity require a trusted transactional write path (required):** setting `parentAccount` must go through a **trusted, transactional writer** (a Firestore `runTransaction()` / Admin-side write) that, **inside the transaction, re-reads the full prospective ancestor chain** and **atomically rejects** the write if the Account itself appears in that chain (cycle / self-parent) or if the resulting depth would exceed `MAX_HIERARCHY_DEPTH` (default 5).
- **Client validation and ordinary Rules alone are NOT sufficient — and must not be claimed to be.** A client-side pre-check races under concurrency (two individually-valid writes can together form a cycle), and Firestore Rules cannot walk an arbitrary-depth ancestor chain in one evaluation. The in-transaction re-read is the load-bearing guarantee; `parentAccount` is therefore a governed, trusted-write field, not a plain client write.
- **Inheritance (decision):** in v1 the Commercial Profile is **per-Account only — no automatic inheritance** down the hierarchy. A child does **not** inherit a parent's payment terms, tax status, pricing tier, or credit. Inheritance/roll-up is explicitly **future scope**, not built here.

## Credit — authoritative source, status/limit, hold behavior, authorization

- **Authoritative source / governance writer (resolves the "governed vs never-fabricated" tension):** `creditStatus`/`creditLimit` are a **governed local credit authority** — the platform is the authoritative source **only when explicitly configured as such** (Framework §17's governed-local-ledger mode), and the **sole writer is an authorized credit-governance principal acting through a trusted, audited write path** (Admin-side / Cloud Function), never an arbitrary client edit. A governed authority's recorded, lineage-bearing decision is **not** a fabricated value; a UI or plain client write inventing a number **is** forbidden.
- **No real credit value without full lineage:** every present `creditStatus`/`creditLimit` MUST carry **`source`** (the governed-local credit authority, or a future external provider), **`asOf`**, **`setBy`** (the authorizing principal), and an **audit event** (Framework §15). Absent that, credit is **unavailable / review-required** — never a silent `GOOD_STANDING` and never a bare number.
- **Phase-3 posture (pick one explicitly; either satisfies the Framework):** (a) **governed local credit authority** — build the trusted, audited governance write path above and record credit locally with full lineage; or (b) **keep real credit values unavailable** (the review-required / `unconfigured` state) until the separate financial-provider phase supplies them. Neither posture permits an unsourced value.
- **Separate storage (required):** `creditStatus`/`creditLimit` live in a **separate access-controlled document** (e.g. `accounts/{id}/private/commercial`), **not** on the main `accounts` document — Firestore Rules gate *document* reads, not fields, and credit visibility must be restricted more tightly than general Account read. Load-bearing for §19 visibility.
- **Authorization boundaries (Framework §19):** read/write of the credit document is restricted to **credit-authorized principals**. Today's only security roles are `admin`/`dispatcher`/`technician`; v1 restricts credit to **admin only** and flags a **finer-grained finance/credit role** as a required governance decision before wider rollout. Dispatcher/technician cannot read the credit document; the write path is trusted/audited, not a plain client write.
- **`ON_HOLD` behavior:** surfaced prominently (a clear warning banner). **Hard enforcement** (blocking new commercial commitments — e.g. Work Order/order creation) is the stated intent but **deferred**: the commitment-creation path (`createWorkOrder`) is Cloud-Function-gated and not deployed, so v1 **surfaces** the hold and records the enforcement point at the commitment layer, to be enforced once that path is live. The spec records the enforcement point; it does not implement it.
- **`creditLimit` monetary representation:** Framework §10 in full (currency, decimal/minor-unit, explicit scale/rounding) — never a bare number, never binary float.

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

- **Phase 1 — informational profile + identity (no Rules change):** `defaultCurrency`, `purchaseOrderRequired`, `invoiceDeliveryMethod`, `billingContact`, `accountOwner`; the Commercial Profile section; full identity resolution (current-name resolution, "Unknown …", audit snapshots). **No `paymentTerms` here — it is governed (Phase 2).** Acceptance: fields additive, no existing Account breaks, every ID renders a resolved name/"Unknown", no raw ID anywhere, no financial figure, absent `taxStatus` reads as `UNKNOWN` (never `TAXABLE`).
- **Phase 2 — governed fields (Tier 2 Rules / trusted write):** **ALL `paymentTerms`** (COD / Net 30 / 60 / 90 **and** `CUSTOM`), `taxStatus`, `pricingTier`, `parentAccount`. Governed, admin-edit-only — **enforced via Firestore Rules / a trusted write path, never UI hiding**. `parentAccount` cycle/depth via the **trusted transactional writer** (atomic ancestor re-read). `CUSTOM` terms via the governed `payment_terms_definitions` collection (its own shape + Rules). Acceptance: enumerated/governed values validated; a **non-admin edit is rejected at the Rules/trusted-write layer (not merely hidden)**; cycle/self-parent/over-depth rejected **atomically under concurrency**; Rules change reviewed + deployed + verified.
- **Phase 3 — credit (Tier 2 Rules, restricted doc, governed authority):** the separate access-controlled credit document + its Rules; read/write restricted to credit-authorized; **either the governed local credit-authority write path (trusted, audited, lineage-bearing) OR credit kept unavailable/review-required — no unsourced value**; `ON_HOLD` surfaced. Acceptance: dispatcher/technician cannot read the credit document; absent `creditStatus` reads as review-required (never `GOOD_STANDING`); any present `creditLimit` carries `source` + `asOf` + `setBy` + audit and is currency-correct (§10); hold banner shows; no hard-block claimed beyond what's implemented.
- **Phase 4 — forecast-horizon surface (provider-neutral):** the two labeled family sub-sections rendering the five-state contract, `unconfigured` only, never `$0`; **Family 1 labels the forecast `Projected Collections`, distinct from actual `Cash Collected` and current `Outstanding Receivables`**; both families' definitions (metric/date/boundary/exclusion/currency/lineage) encoded but not computed. Acceptance: exact `unconfigured` copy; no figure; families never merged; the forecast is never labeled "Cash Collected".
- **Phase 5 — provider integration (separate future initiative):** connect a financial provider → real receivables/pipeline forecast + credit figures under the full Framework §10/§17/§19 contract. Not part of this initiative's build sequence.

## Testing strategy

- **Pure logic (Node assertion tests, the repo's convention):**
  - **Safe defaults:** absent `taxStatus` resolves to `UNKNOWN` (never `TAXABLE`); absent credit resolves to review-required/unavailable (never `GOOD_STANDING`).
  - **Payment terms:** net-days → due-date for Net-N; **COD due date derives from the delivery/fulfillment event, not `invoiceDate + 0`**; an issued invoice's snapshotted due date is **unchanged by a later Account-term change** (no retroactive change).
  - **Forecast vocabulary:** `Projected Collections` (forecast) is distinct from actual `Cash Collected` and current `Outstanding Receivables` and never conflated; the two families are never merged.
  - **Parent hierarchy:** cycle/self-parent/over-depth detection, including a **concurrent-write scenario** proving the in-transaction ancestor re-read rejects a cycle that two individually-valid writes would form.
  - **Credit:** no credit value is presentable without `source` + `asOf` + `setBy` + audit lineage.
  - **Identity resolution:** current name vs "Unknown" vs historical snapshot; the forecast/credit five-state render views (extending `financialSummaryView`).
- **Browser (driver):** Commercial Profile renders resolved names (never raw IDs) with "Unknown …" fallbacks; `taxStatus`/credit safe-default display; the `unconfigured` forecast families with `Projected Collections` labeling; credit-document visibility gating (dispatcher cannot read); and a **non-admin governed-field edit rejected at the Rules/trusted-write layer, not merely hidden**; accessibility; responsive.
- **Rules-level authorization** (governed edits, credit-document read restriction) is verified with the emulator Rules-test pattern (`functions/test/*.test.js`), not only the browser driver. No React test renderer is added; the `verify-*` driver + standalone-Node pattern is reused.

## Open questions (for Specification review)

1. The finer-grained finance/credit role (vs admin-only in v1) — when and how introduced.
2. `MAX_HIERARCHY_DEPTH` exact value and whether depth is enforced in Rules or only the write path.
3. Governed `payment_terms_definitions` / pricing-tier collection shapes and their own authorization (each likely its own small governed collection + Rules).
4. Exact receivables-horizon component policy (which invoice components count toward each bucket — Framework §3 deployment policy).

## Approval

**Draft — pending ChatGPT Specification Final Review and Owner authorization.** No architecture approval, merge authorization, or implementation authorization is claimed. Authorizes no application code, Rules/schema/index change, provider integration, deployment, production-data action, Implementation Plan, or global-document edit.
