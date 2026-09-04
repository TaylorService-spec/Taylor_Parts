# Customer 1 — Day-1 scope matrix (PROPOSED)

**Gate:** `C1-SCOPE-01` — Day-1 scope and exclusions. **Status: OPEN.**
**Authority:** Verenward + Taylor. Nothing on this page is accepted scope.

Every classification below is a **proposal by Verenward engineering**, derived from repository
evidence only. A proposal becomes scope when Taylor and Verenward accept it and that acceptance is
recorded in `CUSTOMER_1_LEDGER.json`. Until then `C1-SCOPE-01` stays `OPEN` even if every row is
filled in.

## Classification vocabulary

| Value | Meaning |
|---|---|
| `DAY_1` | Taylor is expected to depend on this family in production from Day 1. |
| `POST_DAY_1` | Real scope, deliberately after Day 1. |
| `PILOT` | Available Day 1 to a named subset, not depended on by the business. |
| `EXCLUDED` | Not in the Customer 1 engagement. Exclusion must be explicit and accepted. |
| `BLOCKED` | Cannot be proposed without a Taylor or Owner fact that is not in the repository. |

## Evidence sources

- Family acceptance state — [`docs/design/north-star-migration-ledger.md`](../../design/north-star-migration-ledger.md)
- Broader capability list — [`docs/roadmaps/business-capability-register.md`](../../roadmaps/business-capability-register.md)
- Gate record — [`CUSTOMER_1_LEDGER.json`](../CUSTOMER_1_LEDGER.json)

The acceptance column is copied from the migration ledger's own `Acceptance` cell. It is design
acceptance on sandbox, **not** production readiness and **not** `C1-PRODUCT-01`.

## North Star family register

| Family | North Star acceptance (source: migration ledger) | Proposed Day-1 class | Basis for the proposal |
|---|---|---|---|
| 1 — Work Order | Closed 2026-08-25 | `DAY_1` | Taylor is a field-service business; a work order is the unit of service work. No repository evidence suggests service can run without it. |
| 2 — Sales Order | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | `DAY_1` | Parts sales and fulfillment already depend on it; the consumption/availability chain proved in `C1-PRODUCT-01` evidence runs through Sales Order availability. |
| 3 — Account (Customer 360) | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | `DAY_1` | Every other Day-1 family resolves a customer. Excluding it would strand the rest. |
| 4 — Opportunity (record) | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | `BLOCKED` | Depends on open blocker `BLK-canary-A-1`: whether the Day-1 commercial flow starts at Opportunity or at Sales Order. |
| 4b — Opportunity collection | `AWAITING_OWNER_VISUAL_ACCEPTANCE` | `BLOCKED` | Same blocker as family 4; the two surfaces are one family and classify together. |
| 5 — Sales Agreement | Closed 2026-08-27 | `BLOCKED` | Depends on `BLK-canary-A-1`: whether Taylor sells under Sales Agreements from Day 1. |
| Dispatch & Scheduling | ACCEPTED (Owner, 2026-08-29) | `DAY_1` | Service work must be assigned and scheduled for family 1 to be operable. |
| 6 — Service Operations | Closed 2026-08-30 | `DAY_1` | The execution surface for accepted service work. |
| 7 — Parts | Closed 2026-08-31 (P1v2) | `DAY_1` | Parts inventory is a named launch-critical gate of its own (`C1-INV-01`). |
| 8 — Equipment | Closed 2026-08-31 | `DAY_1` | Serialized customer equipment is the object service and warranty attach to. |
| 9 — Receiving | Closed 2026-08-31 | `DAY_1` | Without receiving, on-hand inventory cannot be maintained after opening balances. |
| 10 — My Dashboard | ACCEPTED (Owner, 2026-09-03) | `DAY_1` | The general landing surface; training is already `COMPLETE — LIVE VERIFIED`. |
| 11 — Technician Dashboard | ACCEPTED (Owner, 2026-09-04) | `DAY_1` | Technicians are a Day-1 persona and this is their entry surface. |

This table is machine-checked by [`verify-scope-matrix.mjs`](verify-scope-matrix.mjs) in both
directions against the migration ledger: every `## Family N` heading there must have a numbered row
here, and every numbered row here must correspond to such a heading. A newly migrated family fails
the check until it is classified, so the census cannot silently narrow. Dispatch & Scheduling is
carried as a family row without a family number, so it participates in neither direction. The check
also refuses an
`AWAITING_OWNER_VISUAL_ACCEPTANCE` cell for a family whose ledger heading now reads `ACCEPTED` —
that staleness is what this pass corrected for family 11.

## Surfaces outside the family register

These are shipped or specified EOS areas that the North Star migration ledger does not carry as a
numbered family. They are listed because `C1-SCOPE-01` closes on *every* EOS family, and silently
omitting them would make the gate close on a narrower census than it claims.

| Area | Repository evidence | Proposed Day-1 class | Basis |
|---|---|---|---|
| Purchasing (purchase orders, price entry) | `C1-PRODUCT-01` evidence (PR #1762 cost activation); `docs/training/PURCHASING_RECORD_PURCHASE_ORDER.md` | `DAY_1` | Receiving and parts costing both depend on a governed purchase commitment. |
| Financials / AR (20 North Star pages) | `docs/financials/FINANCIALS_IMPLEMENTATION_RUN_LEDGER.md`; `docs/north-star/financials/` | `BLOCKED` | Depends on open blocker `BLK-run-20260904-065957-A-2`: whether an existing accounting system remains the authority for money. |
| Reporting | `C1-SECURITY-01` evidence (PRs #1768, #1779) | `BLOCKED` | Depends on open blocker `BLK-canary-A-2`. |
| Administration / access management | Gate `C1-ADMIN-01` | `DAY_1` | `C1-ADMIN-01` is independently launch-critical; Taylor cannot depend on EOS without ordinary self-service administration. |

## Business capability register census

The two sections above cover the North Star migration ledger. The repository's other candidate
register is [`docs/roadmaps/business-capability-register.md`](../../roadmaps/business-capability-register.md),
which is capability-shaped rather than page-shaped. Every one of its entries is classified below, so
the census is complete under **either** reading of "every EOS family" and the governance question
about which register is authoritative no longer blocks coverage — only wording.

One repository fact drives most of these proposals: the register records what EOS *will likely need*
and is explicitly **not** an implementation backlog. Seventeen of its eighteen entries are
`IDENTIFIED` — recognized, not built. Taylor cannot depend on Day 1 on a capability that has no
implementation, so the honest proposal for an `IDENTIFIED` entry is `POST_DAY_1`. Where the entry
also has a Day-1 *slice* that is already shipped and classified above, the slice is named; the
capability itself still defers.

| Register entry | Register maturity | Proposed Day-1 class | Basis |
|---|---|---|---|
| CAP-1 — Service Contracts / Preventive Maintenance | `IDENTIFIED` | `POST_DAY_1` | Contract/PM authority is greenfield. Reactive Work Orders (family 1) run service Day 1 without it. |
| CAP-2 — Warranty / Service Entitlement | `IDENTIFIED` | `POST_DAY_1` | Entitlement authority is greenfield; a `warranty` nav item exists as a label only. |
| CAP-3 — Installed Base / Customer Equipment Lifecycle | `IDENTIFIED` | `POST_DAY_1` | Day-1 slice is family 8 — Equipment (the serialized-asset authority and its timeline read foundation). The longitudinal sale→install→retirement chain is not built. |
| CAP-4 — Returns / RMA / Credits / Reverse Commerce | `IDENTIFIED` | `POST_DAY_1` | Reverse/credit authority is greenfield; its own roadmap trigger places it after Sales Order fulfillment authority exists. |
| CAP-5 — Purchasing Economics + Vendor Performance | `IDENTIFIED` | `POST_DAY_1` | Day-1 slice is the Purchasing row above (governed PO and price entry). Cost/performance analytics is greenfield. |
| CAP-6 — Accounts Receivable / Collections | `IDENTIFIED` | `BLOCKED` | Same blocker as the Financials / AR row above (`BLK-run-20260904-065957-A-2`). Classifying this separately would answer that blocker by the back door. |
| CAP-7 — Sales Credit / Commissions | `IDENTIFIED` | `POST_DAY_1` | Commission authority is greenfield and depends on CAP-6. If Taylor requires Day-1 commission calculation, that is new scope, not a reclassification of existing capability. |
| CAP-8 — Technician Skills / Certifications / Work Eligibility | `IDENTIFIED` | `POST_DAY_1` | Dispatch & Scheduling is proposed Day 1 on availability-based assignment; skills-based eligibility is greenfield above it. |
| CAP-9 — Capacity + Customer Promise | `IDENTIFIED` | `POST_DAY_1` | Promise authority is greenfield and the register explicitly forbids building a generalized promise engine now. |
| CAP-10 — Exception Ownership / Operational Accountability | `IDENTIFIED` | `POST_DAY_1` | Per-domain ATTENTION derivations exist and ship inside the Day-1 families; the cross-domain ownership authority above them is greenfield. |
| CAP-11 — Operational Commitment (watch item) | `IDENTIFIED` (watch) | `EXCLUDED` | The register marks it **DO NOT DESIGN OR IMPLEMENT**; it exists to prevent premature abstraction. Excluding it explicitly is what the register already says. |
| CAP-12 — Temporary Equipment Placement / Custody | `IDENTIFIED` | `POST_DAY_1` | The business relationship is ratified but the persistence shape is unresolved pending formal Assessment; there is no authority to depend on. |
| CAP-13 — Technician Labor + Cost Accounting | `IDENTIFIED` | `POST_DAY_1` | The labor-cost-rate authority is greenfield. Work Order lifecycle events (Day 1, family 1) capture the evidence this capability would later consume. Related to `BLK-run-20260904-065957-A-2`. |
| CAP-14 — Multi-Equipment Fulfillment / Coordinated Field Execution | `IDENTIFIED` | `POST_DAY_1` | The register records that Taylor today writes one Work Order per machine. That is cumbersome, not blocking; family 1 supports it Day 1. |
| CAP-15 — Commercial Coverage & Territory Management | `IDENTIFIED` | `POST_DAY_1` | Territory and Coverage Assignment are both greenfield; the register's own runway protection is to keep using `ownerEmployeeId` + Channel. |
| CAP-16 — Tenant Metadata Configuration & Governed Self-Service | `IDENTIFIED` | `POST_DAY_1` | Architecture recorded, four workstreams scheduled, **none built**. See finding F-1 — `C1-ADMIN-01` must be satisfiable without it. |
| CAP-17 — EOS Contextual Assistant | `PLANNED` | `EXCLUDED` | Phases A/B are repository-only with no production AI and no conversational writes. No authorization exists for Taylor production data to reach an AI provider, so it cannot be a Day-1 dependency. |
| CAP-18 — Multi-Currency + FX Governance | `IDENTIFIED` | `EXCLUDED` | `salesAgreementCommands.ts` and `salesOrderCommands.ts` hardcode `currency: "USD"` and accept no parameter that could produce anything else. No Day-1 transaction can be non-USD. |

This table is machine-checked by [`verify-scope-matrix.mjs`](verify-scope-matrix.mjs): every `### N.`
entry in the capability register must have a `CAP-N` row here. A new register entry fails the check
until it is classified.

### Findings from the census

- **F-1 — `C1-ADMIN-01` and CAP-16 must not be conflated.** Administration / access management is
  proposed `DAY_1` above because Taylor needs ordinary self-service administration. CAP-16 — the
  tenant metadata configuration platform that would let an administrator add a field or build a
  report without engineering — is unbuilt and proposed `POST_DAY_1`. `C1-ADMIN-01` therefore has to
  close on a *bounded* Day-1 administration set that is achievable without CAP-16. Which actions are
  in that set is Lane C's gate, not this matrix's.
- **F-2 — three explicit exclusions now exist.** CAP-11, CAP-17 and CAP-18 are the first rows
  proposed `EXCLUDED`. `C1-SCOPE-01` closes only when exclusions are *accepted*, so these three are
  the minimum exclusion set Taylor and Verenward must sign, not a formality.
- **F-3 — no row is proposed `PILOT`.** Nothing in the repository designates a named subset of
  Taylor users who would exercise a capability the business does not depend on. If Taylor wants a
  pilot posture for any row, that is a business decision that would add rows here.

## What this page does not do

- It does not move `C1-SCOPE-01`. The gate closes on Taylor and Verenward acceptance, not on the
  existence of this matrix.
- It does not declare Owner visual acceptance for any family. The acceptance column is copied from
  the migration ledger, which is the only place that state is set.
- It does not resolve the six blocked rows (families 4, 4b, 5, Financials / AR, Reporting, CAP-6).
  Those are Taylor and Owner business decisions and are recorded as blockers rather than guessed.
- It does not assert that a `DAY_1` proposal is *ready*. Readiness is `C1-PRODUCT-01`; the per-family
  gate reconciliation against these proposals lives in
  [`../acceptance/DAY_1_GATE_RECONCILIATION.md`](../acceptance/DAY_1_GATE_RECONCILIATION.md).

## Open question this matrix surfaces

The census boundary itself is undecided. `C1-SCOPE-01` says "every EOS family", and the repository
holds two candidate registers: the North Star migration ledger (13 family rows) and the business
capability register (18 entries, capability-shaped, not page-shaped). Which one is authoritative for
the gate's close condition is a governance decision, not an engineering one, and it stays recorded as
a blocker.

What has changed is that the answer no longer gates coverage: this matrix now classifies the union —
13 family rows, 4 surfaces outside the family register, and all 18 capability register entries. Under
either reading, and under both, every row is classified. The residual governance question is which
set the gate's *close statement* should name, not whether anything is missing.
