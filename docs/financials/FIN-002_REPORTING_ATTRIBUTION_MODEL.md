# FIN-002 — Reporting Attribution Model

**Status:** IMPLEMENTED (repository authority; nothing deployed, nothing activated)
**Ruling:** DECISIONS #152 (Owner, 2026-08-31) · **Boundary preserved:** DECISIONS #145 —
EOS = governed operational financial subledger; external accounting = future authority of
record (not selected); GL out of scope.
**Canonical authority:** `functions/src/finance/financialAttribution.ts` (the ONE definition)
**Contract tests:** `functions/test/financialAttribution.test.mjs`

## 1. Authority summary

Every reportable operational financial event must be able to answer, at event time:
WHICH COMPANY · WHICH BUSINESS UNIT · WHICH CREDITED/RESPONSIBLE PERSON · WHICH CUSTOMER ·
WHICH SOURCE RECORD · WHEN · WHAT CURRENCY. One module defines the vocabulary and the frozen
snapshot; Sales composes it at the commercial chain's creation/commitment points; the dormant
finance core composes it at issuance; Service composes it in F4. Dimensions that are
semantically invalid for an event are honest nulls — never forced, never inferred.

Semantic separations enforced (each with a pinning test): OWNERSHIP ≠ SALES CREDIT ·
createdBy ≠ credit · current Customer owner ≠ historical credit · technician ≠ salesperson ·
company ≠ business unit · business unit ≠ UI route · source lineage ≠ ownership · current
mutable state ≠ historical event attribution.

## 2. Canonical dimensions

`FinancialAttributionSnapshot` = { operatingCompanyId·null, businessUnitId·null,
creditedSalespersonId·null, responsibleEmployeeId·null, customerId, sourceType,
sourceRecordId, eventAtMillis, currency } — frozen (`Object.freeze`), built only by
`buildFinancialAttributionSnapshot()`, which requires customer/source/event-time/currency and
validates every optional dimension. Storage favors explicit top-level fields on commercial
records (repository convention); the snapshot OBJECT is stored where an event is composed
whole (invoice `attribution`). The invariant is the single definition, not the shape.

## 3. Company authority

- Governed ids come from the EXISTING `operating_companies` authority (`taylor`/`ventana`)
  via `resolveCommercialCompanyScope` (R-14): explicit → inherited → null. No second model.
- NEVER inferred from location/warehouse names, "North", manufacturer, customer name, route,
  salesperson, or Taylor/Ventana text labels (test-pinned).
- Flow: Opportunity (entry point, unchanged) → **Agreement now carries
  `operatingCompanyId`**, inherited server-side from the source Opportunity read in the create
  transaction (`salesAgreementCallables.ts`) — the client cannot supply "inherited" values
  (Omit'd from the request type). Not draft-editable: the deal's company was set at chain entry.
  → **Sales Order: both conversion paths now pass
  `inheritedOperatingCompanyId: agreement.operatingCompanyId ?? opp.operatingCompanyId ?? null`**
  (`closeOpportunityAsWon.ts`, `createSalesOrderFromOpportunity.ts`) — closing the FIN-001
  defect where both paths passed nothing and every converted order got null.
- Snapshot semantics: copied at creation, frozen at ACCEPTED / order creation. A customer's
  later company change rewrites nothing historical (test-pinned).

## 4. Business-unit authority

- Canonical vocabulary `BUSINESS_UNITS` = SERVICE · EQUIPMENT_SALES · PARTS · INSTALLATION.
  IDs are authority; labels are presentation; future governed units are added here only.
- **Line-level on commercial orders** — one order may mix equipment + parts + installation and
  is never flattened to one false order-level unit (mixed-order test).
- `deriveLineBusinessUnit(kind, explicit)`: EQUIPMENT_MODEL→EQUIPMENT_SALES, PART→PARTS
  (explicit must match — mismatch refused; overrides/splits are FIN-009 policy);
  **SERVICE requires explicit SERVICE or INSTALLATION** — creation contract option A: an
  ordinary new reportable line cannot enter with silent ambiguity (`BUSINESS_UNIT_REQUIRED`).
  Enforced identically in Agreement and Sales Order line validators (one authority, two call
  sites, no laxer path).
- `deriveSalesOrderLinesFromAgreement` carries each line's unit with its committed price;
  pre-FIN-002 agreement lines omit the key and the order's validator re-derives or refuses.
- Never derived from a route (test-pinned: route strings are refused as unit ids).

## 5. Salesperson-credit authority

- `creditedSalespersonId` — distinct field on Opportunity, Sales Agreement, Sales Order.
  Never reuses `ownerEmployeeId`, never derived from `createdBy`.
- Default chain (`resolveCreditedSalesperson`, 3 parameters — no actor parameter exists):
  explicit → inherited from governed upstream → the commercial owner at chain entry.
  Assistant test: createdBy=assistant, credit=owner A.
- Explicit pre-commitment reassignment rides EXISTING governed commercial write authority:
  Opportunity ordinary edit (`EDITABLE_OPPORTUNITY_FIELDS`) and Agreement bounded DRAFT edit
  (cannot be cleared, only reassigned). No new write capability was created (§18 honored).
- Moving the OWNER does not move credit (test-pinned). Post-commitment credit change =
  FIN-007 governed attribution adjustment (not built here).

## 6. Responsible-employee authority

`responsibleEmployeeId` exists in the canonical snapshot for events where operational
responsibility (e.g. a technician) is the valid person dimension. It is NOT stamped on
commercial records (the salesperson dimensions live there) and no Service revenue-credit
policy is invented: for Service facts, `creditedSalespersonId` may legitimately be null.

## 7. Customer authority

Canonical id remains `accountId` on stored commercial records (no parallel vocabulary). The
ONE translation boundary is the snapshot builder: `customerId` in the canonical snapshot is
populated from the record's governed `accountId` at compose time (see invoice attribution).
Commercial records preserve the customer directly (immutable on Agreement/Order).

## 8. Source lineage

`FINANCIAL_SOURCE_TYPES` = SALES_AGREEMENT · SALES_ORDER · SALES_ORDER_LINE · WORK_ORDER ·
INVOICE · PAYMENT · ADJUSTMENT · REFUND — only record types that exist (no
WORK_ORDER_CHARGE until F4 creates one). Existing lineage preserved and composed: Invoice →
`salesOrderId` (cross-checked at issuance) + line-level `salesOrderLineId`; Sales Order →
`sourceAgreementId` + `sourceOpportunityId`; Agreement → `sourceOpportunityId`; Payment
application → invoice (existing). The invoice's snapshot stamps
sourceType=SALES_ORDER/sourceRecordId at issuance.

## 9. Event-time authority

Distinguished meanings (none is a universal period date): `createdAt` (record creation) ·
`acceptedAtMillis` (Agreement acceptance, server-stamped — pre-existing) · **`bookedAtMillis`
(NEW, Sales Order)** · `issuedAtMillis` (invoice, dormant) · payment/adjustment event times
(dormant) · service-performed time (F4). `createdAt` is not used as a financial period basis.

**BOOKED decision (recorded):** Agreement acceptance commits commercial terms, so an order
derived from an accepted Agreement books at `acceptedAtMillis`; a direct creation books at
server creation time. `bookedAtMillis` is **ctx-supplied (server) only** — a caller-supplied
clock is structurally ignored (test-pinned). No retroactive bookedAt is invented for existing
records (census §16). No revenue recognition, no accounting periods (FIN-008).

## 10. Currency authority

Explicit on every snapshot (builder-required). Commercial records keep the server-set "USD"
(existing governed default); issued events store currency with the event. No FX, no
revaluation of historical events (out of FIN-002 scope by contract).

## 11. Immutable snapshot point

Agreement **ACCEPTED** freezes company/customer/credit/line-units/currency/acceptance-time
with the committed terms (draft editing structurally refused post-DRAFT; ordinary updates
cannot reach accepted attribution). **Sales Order creation** freezes the order's copy (no
update command touches these fields; `buildTransitionPatch` writes state only). **Invoice
ISSUED** (dormant) freezes the composed snapshot object. Pure tests prove: source-record
changes after commitment rewrite nothing; ordinary update paths cannot mutate frozen
attribution; corrections belong to FIN-007.

## 12. Sales mapping

| Record | company | credit | BU | customer | lineage | event time | currency |
|---|---|---|---|---|---|---|---|
| Opportunity | `operatingCompanyId` (entry, R-14) | `creditedSalespersonId` (default=owner; editable pre-close) | — (pre-commitment) | `accountId` (editable pre-close) | root | createdAt only | — (expectedValue stays uncurrencied forecast) |
| Agreement | inherited @create, frozen | inherited/explicit; DRAFT-reassignable; frozen @ACCEPTED | per line (required for SERVICE) | server-derived, immutable | `sourceOpportunityId` | `acceptedAtMillis` | USD server-set |
| Sales Order | agreement→opp fallback @create, frozen | agreement→opp fallback, frozen | per line, carried with price | immutable | `sourceAgreementId`/`sourceOpportunityId` | `bookedAtMillis` + createdAt | USD server-set |

## 13. Service mapping (vocabulary only — no Service billing invented)

Work Orders: `customerId` PRESENT (create-only); technician = assignment/responsibility, not
credit; `creditedSalespersonId` legitimately null (no governed Service revenue-credit policy
exists — none invented); business unit via `deriveWorkOrderBusinessUnit(WorkOrderType)`:
INSTALL→INSTALLATION, SERVICE_CALL/PM/WARRANTY/INSPECTION→SERVICE, unknown→null (fail-closed);
company attribution remains MISSING on WOs (D-13 design, unstamped — F4/FIN-009 scope);
`salesOrderId` lineage exists for SO-originated WOs.

## 14. Finance-core mapping (dormant; nothing activated)

`InvoiceRecord.attribution` = canonical snapshot composed from the GOVERNED Sales Order
snapshot the issuance transaction already reads (company, credit, customer=accountId,
SALES_ORDER lineage, issuance time, currency); invoice **lines** carry `businessUnitId` from
the matched SO line — never from the client payload; header unit deliberately null (mixed
orders bill mixed units). Pre-FIN-002 orders yield honest nulls, never fabricated values.
All finance capabilities remain `active:false`; collections remain deny-all; undeployed.

## 15. Historical behavior

HISTORICAL STAYS HISTORICAL. Frozen commercial/financial attribution is corrected only by a
future FIN-007 governed adjustment event. Ownership handoffs, customer moves, company
corrections, and credit changes affect FUTURE records; tests pin that committed snapshots
survive all of them. Pre-commit reassignment is audited through the existing command audit
events (opportunity edit records old/new `creditedSalespersonId` in its change list; the
agreement draft-edit audit rides the existing update event). The audit schema needed no
change; deeper before/after policy for post-commit corrections is recorded as a FIN-007
dependency.

## 16. Existing-record census and backfill posture

Basis: repository analysis + the FIN-001/ownership census (2026-08-30: 0 of 1,323 ownable
records carry any operating-company fact; commercial collections exist only as sandbox/
certification synthetic data — production carries none; live reads were not performed here).

| Field | Existing records | Classification |
|---|---|---|
| operatingCompanyId (Opp/Agr/SO) | none stamped anywhere | **MISSING_SOURCE** (no governed historical source names a company; do NOT infer) |
| creditedSalespersonId | absent | **DERIVABLE_FROM_GOVERNED_SOURCE** — each record's own stored `ownerEmployeeId` is the owner-at-creation (no handoff has ever run; handoff command inert), which is exactly the #152 default |
| line businessUnitId | absent | **DERIVABLE** for EQUIPMENT_MODEL/PART lines (kind); **UNSAFE_TO_INFER** for SERVICE lines (must remain absent until explicitly classified) |
| bookedAtMillis | absent | **DERIVABLE** for agreement-derived orders (source agreement `acceptedAtMillis`); **MISSING_SOURCE** for any direct-created order |
| currency | present (server-set USD) | **ALREADY_VALID** |
| customerId/lineage | present | **ALREADY_VALID** |

**Backfill: NOT EXECUTED.** Plan (requires its own explicit authorization; dry-run + census +
idempotence + sandbox proof first, per program rules): stamp credit from stored
`ownerEmployeeId`; stamp derivable line units from kind; stamp bookedAt from source-agreement
acceptance; leave company and SERVICE-line units absent. Never from current Customer owner,
createdBy, location names, or today's salesperson.

## 17. Remaining gaps

- Company attribution on NEW chains requires the Opportunity to carry a company; Opportunity
  creation still accepts null (R-14 posture, unchanged). Activation policy for requiring it is
  a product decision recorded for FIN-004/F12 surfaces, not forced here.
- Sales Order read projections deliberately do NOT yet expose company/credit/BU/bookedAt —
  exposure is a visibility decision (FIN-004 decides who may see which attribution).
- Post-commitment attribution corrections → FIN-007 (adjustment events + audit before/after).
- Service billing facts and WO company stamping → F4/FIN-009.
- `isNationalAccount` naming question (vs `salesChannel`) remains open (carried from FIN-001).

## 18. FIN-003..FIN-010 implications

FIN-003 measures actuals along these dimensions (goal scopeType can now name company/BU/
person). FIN-004 scopes visibility BY these dimensions (SELF/TEAM need credit; company scope
needs the company stamp). FIN-005 forecasts attribute the same way. FIN-006 cost events
compose the same snapshot. FIN-007 owns post-commit corrections. FIN-008 consumes
bookedAt/issuedAt as period bases. FIN-009 splits line-level attribution further
(allocations must sum to source). FIN-010 traces via sourceType/sourceRecordId lineage.
