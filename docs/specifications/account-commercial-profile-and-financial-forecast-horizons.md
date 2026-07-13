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
| `defaultCurrency` | ISO 4217 code string | absent | valid ISO 4217 | Informational | View/Edit admin/dispatcher (**the permission current `accounts` Rules already enforce**) | Commercial Profile |
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
- **The audit log is itself a governed, trusted-write component.** Audit-event creation goes through a defined **trusted/audited writer** (server-side / Admin SDK) with its **own schema and Rules gate** — an unrestricted client write cannot provide safe, permanent, unforgeable audit history. The audit log is therefore delivered in the governed phase (Phase 2), **not** Phase 1's no-Rules scope.

## Payment-term semantics

- **`paymentTerms` on the Account is only the DEFAULT applied to NEW invoices at issue time** — never a live driver of already-issued invoices.
- **Due-date basis per term:** `NET_30`/`NET_60`/`NET_90` are net-days from the **invoice issue date** (`dueDate = invoiceIssueDate + netDays`), computable at issue.
- **`COD` due date resolves against the authoritative delivery / fulfillment event — never automatically `invoiceDate + 0`:**
  - if a delivery/fulfillment already exists when the invoice is issued, **snapshot that delivery date as the due date** (immutable at issue);
  - if the invoice is issued **before** delivery, the due date is **pending** until the authoritative delivery event occurs, then becomes **immutable**;
  - therefore **not every COD invoice has a computed due date at issue** — a pre-delivery COD invoice is legitimately due-date-pending, and forecasts must treat it as such (not as due "now").
- **Invoices snapshot the terms applied at issue.** An issued invoice records the **terms code, net-days, basis event, and computed due date** used at that moment — an immutable snapshot (Framework §12/§15).
- **No retroactive change.** A later change to the Account's `paymentTerms` applies only to invoices issued **after** the change; it **must never retroactively alter the due date of an already-issued invoice**.
- **`CUSTOM`** references a **governed** `payment_terms_definitions/{id}` record (net-days / basis / optional early-pay discount) — a controlled, validated definition, **never free-text terms on the Account**. Curating custom-term definitions is its own governed action (owner + validation), flagged as an authorization decision.
- **Payment terms affect the receivables / cash-collection family ONLY** — they set invoice due dates and therefore projected-collection timing. They **do not change Open Pipeline, Booked Value, Committed Backlog, or any "sales" figure.**

## Financial Forecast Horizons

**Two separate families, each rendered under its own labeled sub-section; never combined into one unlabeled total.** Both are provider-gated: with no financial provider connected, each surface renders the Framework five-state contract at `unconfigured` → exact copy **"Sales data source not connected"**, never `$0` or a fabricated figure.

### Family 1 — Receivables / cash-collection horizons
- **Distinct, separately-labeled figures — never conflated:** **Cash Collected** = *actual* cash already received and applied (a historical fact, Framework §3), **never a forecast**; **Outstanding Receivables** = the *current* invoiced-but-uncollected balance (a present fact).
- **The Current/30/60/90 horizons are `Receivables Due`** — outstanding receivables **grouped by due date**. A due date shows when an amount is *contractually due*; it does **not** prove collection will occur, so this is an aging view, **not** a collection forecast, and is **not** labeled `Projected Collections`.
- **`Projected Collections` is reserved** for a separately-governed **collection-probability model** (with explicit assumptions, lineage, and completeness) that **does not exist in this initiative**. Until such a model exists, only `Receivables Due` (a due-date aging), actual `Cash Collected`, and current `Outstanding Receivables` are shown — each its own labeled figure, never merged, never relabeled as a collection forecast.
- **Date basis:** each invoice's **snapshotted due date** (from its issue-time payment terms, above; a due-date-pending COD invoice is bucketed as pending, not "due now"); the report declares this basis (Framework §12).
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
- **Never merge families:** a receivables view and a pipeline view are different questions, reported separately with canonical labels (Cash Collected, Outstanding Receivables, Receivables Due, Open Pipeline, Committed Backlog) — never a bare "forecast"/"Sales"/"Pending" label, and never a due-date aging relabeled as a collection forecast.
- **Provider states (§17):** `unconfigured`/`error`/`stale`/`partial`/`complete`; today only `unconfigured` is reachable; the surface reuses the merged Financial Summary five-state view discipline.
- **Visibility (§19):** forecast figures are gated (see Credit/authorization); who may view/export each figure is stated before any real figure ships.

## Parent hierarchy — cycle, depth, inheritance

- **Cycle & depth integrity require a privileged server-side transactional writer (required):** setting `parentAccount` must go through a **trusted transactional writer — a privileged server-side / Admin SDK transaction** (a Cloud Function or Admin-SDK script, the same trust class as `createWorkOrder`/`transitionWorkOrder` and `functions/scripts/provisionEmployeeAccess.js`). Inside that server-side transaction it **re-reads the full prospective ancestor chain** and **atomically rejects** the write if the Account itself appears in that chain (cycle / self-parent) or if the resulting depth would exceed `MAX_HIERARCHY_DEPTH` (default 5).
- **Neither a client `runTransaction()` nor ordinary Rules is the authority — and neither may be claimed to be.** A **client-SDK `runTransaction()` is not itself trusted** (a modified client can skip or forge the check), so it cannot be the authority for hierarchy integrity; only a privileged server-side/Admin transaction can. A client-side pre-check also races under concurrency (two individually-valid writes can together form a cycle), and Firestore Rules cannot walk an arbitrary-depth ancestor chain in one evaluation. `parentAccount` is therefore a governed, server-side-trusted-write field.
- **Dependency flag:** Cloud Functions are not currently deployed (Blaze-plan blocker, issue #15). This governed server-side write path is a **real prerequisite** for `parentAccount`; the Implementation Plan must sequence it (a deployed Cloud Function or an Admin-SDK operational path), not assume a client write suffices.
- **Inheritance (decision):** in v1 the Commercial Profile is **per-Account only — no automatic inheritance** down the hierarchy. A child does **not** inherit a parent's payment terms, tax status, pricing tier, or credit. Inheritance/roll-up is explicitly **future scope**, not built here.

## Credit — authoritative source, status/limit, hold behavior, authorization

- **Decision — authoritative source is out of scope; real credit stays UNAVAILABLE in this initiative:** real `creditStatus`/`creditLimit` values come **only** from a **separately-authorized governed credit-authority or external financial-provider initiative**. **This initiative builds NO credit writer** (not even a governed local one) and connects no provider. It therefore **keeps `creditStatus`/`creditLimit` unavailable / review-required** throughout; the structure, separate-document storage, read-restriction Rules, and `ON_HOLD` surfacing are defined, but **no credit value is ever written or displayed as real here**.
- **No real credit value without full lineage (and none appears in this initiative):** any future real value MUST carry **`source`** (a governed credit authority or external provider), **`asOf`**, **`setBy`** (the authorizing principal), and an **audit event** (Framework §15) — written by that separate initiative's trusted, audited writer. A UI or plain client write inventing a number is forbidden. Absent a sourced value, credit reads **unavailable / review-required** — never a silent `GOOD_STANDING`, never a bare number.
- **Separate storage (required):** `creditStatus`/`creditLimit` live in a **separate access-controlled document** (e.g. `accounts/{id}/private/commercial`), **not** on the main `accounts` document — Firestore Rules gate *document* reads, not fields, and credit visibility must be restricted more tightly than general Account read. Load-bearing for §19 visibility.
- **Authorization boundaries (Framework §19):** **read** of the credit document is restricted to **credit-authorized principals** — today's only security roles are `admin`/`dispatcher`/`technician`, so v1 restricts credit read to **admin only** and flags a **finer-grained finance/credit role** as a required governance decision before wider rollout. Dispatcher/technician cannot read the credit document. **No credit write path is built in this initiative** — writing credit is deferred to the separate credit-authority/provider initiative, which must use a trusted/audited server-side writer, never a plain client write.
- **`ON_HOLD` behavior:** surfaced prominently (a clear warning banner). **Hard enforcement** (blocking new commercial commitments — e.g. Work Order/order creation) is the stated intent but **deferred**: the commitment-creation path (`createWorkOrder`) is Cloud-Function-gated and not deployed, so v1 **surfaces** the hold and records the enforcement point at the commitment layer, to be enforced once that path is live. The spec records the enforcement point; it does not implement it.
- **`creditLimit` monetary representation:** Framework §10 in full (currency, decimal/minor-unit, explicit scale/rounding) — never a bare number, never binary float.

## UI placement

- **Account Summary:** `accountOwner` (resolved current name, "Unknown owner" if unresolved) as an owner line.
- **New "Commercial Profile" section** on the Account page (a readable section, consistent with the sectioned layout): payment terms (resolved custom-terms name when `CUSTOM`), default currency, PO-required, billing contact (resolved name), tax status, parent account (resolved name), invoice delivery method, pricing tier (resolved name). A **Credit subsection** renders only for credit-authorized viewers.
- **Financial Forecast Horizons** render within/adjacent to the existing provider-neutral **Financial Summary** surface, as two separately-labeled family sub-sections; today both show `unconfigured`.
- **Empty/loading/error/unresolved states:** every ID field shows loading, then the resolved name, "Unknown …" (unresolved), or is omitted if unset; forecast/credit follow the five-state provider contract (never `$0`).

## Firestore Rules / index / provider impacts (explicit)

- **Rules — informational additive fields:** none needed (the `accounts` rule has no field-level validation today; same posture that admitted `relationshipTypes`).
- **Rules — governed fields (MANDATORY, not optional):** the governed fields (`paymentTerms`/`taxStatus`/`pricingTier`/`parentAccount`), the custom-terms/pricing-tier governed collections, and the **commercial-profile audit log** **require Rules-level validation/authorization** — enumerated-value validation, admin-edit authorization, restricting audit-log writes to the trusted writer, and (for `parentAccount`) routing through the privileged server-side transactional writer. **UI hiding enforces none of it.** This is a **Tier 2** change (`firestore.rules`) requiring its own Architecture Review + Owner authorization; the governed fields and audit log are **not shippable without it**.
- **Rules — credit document:** the separate `accounts/{id}/private/commercial` (or equivalent) document **requires its own Rules** restricting read/write to credit-authorized principals — **Tier 2**, separate authorization.
- **Indexes:** any filtered/list view ("accounts by owner / by parent / by credit status / by payment terms") needs its own composite index, delivered as an **index-only PR** with separate Merge + Deployment authorization + `[READY]` verification (the PR #167 pattern). None is created by this Specification.
- **Provider:** all forecast figures and any real credit exposure require a **financial provider** (Framework §17); none exists, so surfaces render `unconfigured`. Connecting a provider is a **separate future initiative** with its own gates.

## Phased acceptance criteria

Each phase is its own Implementation Plan + PR(s) + gates; nothing here authorizes a phase.

- **Phase 1 — informational profile + identity display (no Rules change):** `defaultCurrency`, `purchaseOrderRequired`, `invoiceDeliveryMethod`, `billingContact`, `accountOwner`; the Commercial Profile section; identity **resolution for display** (current-name resolution, "Unknown …"). All Phase-1 fields use **only the permission current `accounts` Rules already enforce (admin/dispatcher write)** — no admin-only field, and **no audit log** here (both are governed — Phase 2). **No `paymentTerms` here — it is governed (Phase 2).** Acceptance: fields additive, no existing Account breaks, every ID renders a resolved name/"Unknown", no raw ID anywhere, no financial figure, absent `taxStatus` reads as `UNKNOWN` (never `TAXABLE`), and **no Phase-1 field claims an authorization current Rules don't enforce**.
- **Phase 2 — governed fields + audit log (Tier 2 Rules / server-side trusted write — MANDATORY):** **ALL `paymentTerms`** (COD / Net 30 / 60 / 90 **and** `CUSTOM`), `taxStatus`, `pricingTier`, `parentAccount`, and the **commercial-profile audit log**. Governed, admin-edit-only — **enforced via Firestore Rules / a trusted write path, never UI hiding**. `parentAccount` cycle/depth via the **privileged server-side/Admin transactional writer** (atomic ancestor re-read; a client `runTransaction()` is not the authority). The audit log is written **only** by the trusted/audited writer (its own schema + Rules); a client cannot forge or alter audit entries. `CUSTOM` terms via the governed `payment_terms_definitions` collection (its own shape + Rules). Acceptance: enumerated/governed values validated; a **non-admin edit is rejected at the Rules/trusted-write layer (not merely hidden)**; cycle/self-parent/over-depth rejected **atomically under concurrency by the server-side writer**; audit entries writable only by the trusted writer; Rules change reviewed + deployed + verified.
- **Phase 3 — credit container, unavailable-only (Tier 2 Rules, restricted doc):** the separate access-controlled credit document + its **read-restriction Rules** + `ON_HOLD` surfacing. **This initiative builds NO credit writer** — `creditStatus`/`creditLimit` stay **unavailable / review-required**; a real credit authority or external provider is a **separate authorized initiative**. Acceptance: dispatcher/technician cannot read the credit document; absent/`review-required` `creditStatus` never reads as `GOOD_STANDING`; **no real `creditLimit`/`creditStatus` value is written or displayed** in this initiative; the `ON_HOLD` surfacing renders correctly for a value that a *future* trusted writer would set (with `source` + `asOf` + `setBy` + audit); no hard-block claimed beyond what's implemented.
- **Phase 4 — forecast-horizon surface (provider-neutral):** the two labeled family sub-sections rendering the five-state contract, `unconfigured` only, never `$0`; **Family 1 labels the due-date aging `Receivables Due`, distinct from actual `Cash Collected` and current `Outstanding Receivables`; `Projected Collections` is reserved for a future governed collection-probability model, not built here**; both families' definitions (metric/date/boundary/exclusion/currency/lineage) encoded but not computed. Acceptance: exact `unconfigured` copy; no figure; families never merged; the due-date aging is labeled `Receivables Due`, never `Cash Collected` or `Projected Collections`.
- **Phase 5 — provider integration (separate future initiative):** connect a financial provider → real receivables/pipeline forecast + credit figures under the full Framework §10/§17/§19 contract. Not part of this initiative's build sequence.

## Testing strategy

- **Pure logic (Node assertion tests, the repo's convention):**
  - **Safe defaults:** absent `taxStatus` resolves to `UNKNOWN` (never `TAXABLE`); absent credit resolves to review-required/unavailable (never `GOOD_STANDING`).
  - **Payment terms:** net-days → due-date for Net-N; **COD due date derives from the delivery/fulfillment event** — snapshotted at issue if delivery already exists, else **pending** until the delivery event then immutable (**never `invoiceDate + 0`, and not every COD invoice has a due date at issue**); an issued invoice's snapshotted due date is **unchanged by a later Account-term change** (no retroactive change).
  - **Forecast vocabulary:** the due-date aging is labeled **`Receivables Due`** (not `Projected Collections`, which is reserved for a future governed model), distinct from actual `Cash Collected` and current `Outstanding Receivables`, never conflated; a due-date-pending COD invoice is bucketed as pending; the two families are never merged.
  - **Parent hierarchy:** cycle/self-parent/over-depth detection by the **privileged server-side/Admin transactional writer**, including a **concurrent-write scenario** proving the in-transaction ancestor re-read rejects a cycle that two individually-valid writes would form; a client-SDK write is not accepted as the authority.
  - **Credit:** no credit value is presentable without `source` + `asOf` + `setBy` + audit lineage, and **no credit value is written or displayed in this initiative** (always unavailable/review-required); audit entries are writable only by the trusted writer.
  - **Permissions:** every Phase-1 field is editable exactly by the principals current `accounts` Rules enforce (admin/dispatcher), with **no field asserting an authorization Rules don't back**; governed-field and audit-log writes by a non-authorized principal are rejected at the Rules/trusted-write layer.
  - **Identity resolution:** current name vs "Unknown" vs historical snapshot; the forecast/credit five-state render views (extending `financialSummaryView`).
- **Browser (driver):** Commercial Profile renders resolved names (never raw IDs) with "Unknown …" fallbacks; `taxStatus`/credit safe-default display; the `unconfigured` forecast families with `Receivables Due` labeling (never `Projected Collections`); credit-document visibility gating (dispatcher cannot read); and a **non-admin governed-field edit rejected at the Rules/trusted-write layer, not merely hidden**; accessibility; responsive.
- **Rules-level authorization** (governed edits, credit-document read restriction) is verified with the emulator Rules-test pattern (`functions/test/*.test.js`), not only the browser driver. No React test renderer is added; the `verify-*` driver + standalone-Node pattern is reused.

## Open questions (for Specification review)

1. The finer-grained finance/credit role (vs admin-only in v1) — when and how introduced.
2. `MAX_HIERARCHY_DEPTH` exact value and whether depth is enforced in Rules or only the write path.
3. Governed `payment_terms_definitions` / pricing-tier collection shapes and their own authorization (each likely its own small governed collection + Rules).
4. Exact receivables-horizon component policy (which invoice components count toward each bucket — Framework §3 deployment policy).

## Approval

**Draft — pending ChatGPT Specification Final Review and Owner authorization.** No architecture approval, merge authorization, or implementation authorization is claimed. Authorizes no application code, Rules/schema/index change, provider integration, deployment, production-data action, Implementation Plan, or global-document edit.
