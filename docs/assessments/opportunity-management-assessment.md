# Opportunity Management — Assessment (Sales commercial entry point)

Status: **ASSESSMENT — ACCEPTED; the four §9 decisions are RATIFIED (Owner, 2026-08-07).** Design-first, no
implementation in this artifact. Opportunity persistence is **greenfield**; per the
governance chain (Assessment → architecture/lifecycle → Specification → Implementation Plan → implementation)
this is the first artifact. It exists because the frontend must reflect the **commercial process**, not the
repository's operational mechanics — and because creating a new governed authority + its Firestore Rules is a
protected boundary that must be designed and ratified before it is built.

Objective: establish **Opportunity** as the first Sales operating capability — the commercial entry point that
consumes canonical Account/Contact/Location/Part/Equipment context and, only when Won, hands off to a
downstream Sales Order → fulfilment chain. Opportunity is **pre-commitment**: it creates no warehouse demand,
no inventory movement, no Work Order, no invoice.

## 1. Where Opportunity sits (the governed commercial model)
```
Customer/Prospect → OPPORTUNITY → Qualify → Product/Solution → Quote → Decision → WON
   → Sales Order → Inventory Assignment → { Warehouse prep | Service Work Order } → … → Billing → Collection → Commission
```
This assessment scopes **only Opportunity** (+ the seams to Account context and to the future Sales Order).
Quote, Sales Order, fulfilment, billing, commission are later cycles with their own governed design.

## 2. Canonical authorities to REUSE (no parallel models — Sales assessment confirmed)
| Concept | Canonical source | Opportunity uses it as |
|---|---|---|
| Customer/Account | `accounts` (accounts.js) | a **reference** (`accountId`); the relationship authority. Account ≠ Opportunity. |
| Contact | `contacts` | reference (`contactId?`) |
| Location | `locations` | reference (`locationId?`) |
| Product/Part | `parts` (partId==SKU, ADR-008) | a solution **line** references `partId` — the PRODUCT, not a serialized asset |
| Equipment model | `equipment_models` (ADR-006/010) | a solution line references `equipmentModelId` — the MODEL, not a serial |
Opportunity must **not** create a second Customer/Contact/Location/Part/Equipment model, and must **not**
overload `accounts` with pipeline state (an Account has 0..N Opportunities over time).

## 3. Proposed Opportunity authority (GREENFIELD — for ratification)
A new governed `opportunities` collection. Proposed shape (pre-commitment; product-level, not serialized):
```
opportunities/{opportunityId}
  accountId            → accounts (required)
  contactId?           → contacts
  locationId?          → locations
  salesChannel         → NATIONAL_ACCOUNTS | RETAIL        (Taylor's two commercial entry points)
  ownerEmployeeId      → the salesperson, a CANONICAL EMPLOYEE reference (NOT free text, NOT a Firebase UID
                         as business identity; display name resolved from Employee authority; NOT a grant)
  need                 → what the customer is trying to buy/solve (short text)
  lines[]              → { kind: EQUIPMENT_MODEL|PART|SERVICE, ref: equipmentModelId|partId|serviceKey, qty }
                         (commercial PRODUCT selection; NEVER a serialized asset — that is Sales-Order-time)
  expectedValue?       → estimated commercial value (see cost/pricing boundary §5)
  stage                → the lifecycle state (§4)
  outcome?             → WON | LOST (set only at DECISION)
  expectedCloseAt?     → timing
  nextAction?          → one clear commercial next step
  createdAt / updatedAt / owner-audit fields
  (activities: a linked/append log — separate sub-design in Cycle 3)
```
**Hard invariant:** an Opportunity existing (even Won) creates NO warehouse demand, inventory movement, Work
Order, or invoice. Those are Sales-Order-and-downstream concerns.

## 4. Lifecycle — one small shared lifecycle (RATIFIED)
```
IDENTIFIED → QUALIFYING → SOLUTION → QUOTING → CUSTOMER_REVIEW → DECISION → (WON | LOST)
```
IDENTIFIED = a real potential sale identified · QUALIFYING = is the need/customer/timing/opportunity
legitimate to pursue · SOLUTION = which equipment/parts/services satisfy the need · QUOTING = a commercial
offer is being prepared/revised · CUSTOMER_REVIEW = the proposal is with the customer · DECISION = the
customer is at the commitment point · WON = committed to buy · LOST = did not proceed.
ONE base lifecycle for **both** National Accounts and Retail (channel is context, not a second sales system —
do not fork the schema by channel). `outcome` (WON | LOST) is kept logically distinct from active stage
progression. WON means "customer committed to buy" — NOT prepared/scheduled/delivered/invoiced/paid. Do NOT
add FOLLOW_UP / WAITING / STALLED / HOT / COLD / APPROVAL_PENDING stages — those conditions are represented
through attention / nextAction / activity / approval state / dates, not by bloating the core lifecycle.

## 5. Quote & pricing boundary
Quote/Estimate attaches **inside** the Opportunity commercial workflow (Cycle 4), carrying equipment/parts/
service/qty/price/discount/tax/freight/terms/expiration. **The repository has NO mature pricing/discount/tax
authority today** (Sales assessment: `parts` has no authoritative price; commercial-profile is metadata, not a
price engine). **Do NOT fabricate pricing authority client-side.** The Opportunity model above is designed so
Quote can attach naturally later (lines already reference canonical products); `expectedValue` is a sales
estimate, not a computed price.

## 6. Persona & authority (ADR-012: persona ≠ authority)
Sales personas — Sales Representative, Account Manager, Sales Manager (National Accounts / Retail) — are
**operating identities**, never auto-converted to security roles. `salesManager` exists inert
(governedBusinessRoles) holding only `account.record.*`. The Opportunity **owner/channel** are business fields
on the record, not grants. **Who may create/edit an Opportunity** is a capability the Persona/Permissions
architecture governs; a first cut is office-facing (admin/dispatcher-class) until sales-persona capabilities
exist. Sales retains **visibility** across the downstream commitment (Sales Order → prep → dispatch → invoice →
paid → commission) **without becoming authority** for warehouse/dispatch/accounting.

## 7. Won → Sales Order seam (design intent; not this cycle)
A WON Opportunity **converts into** a governed **Sales Order** (its own later authority: opportunityId,
accountId, contactId, locationId, salesperson, channel, ordered lines, qty, agreed price, terms, delivery/
install requirements) — snapshotting the agreed commercial terms without re-keying. Physical serialized
inventory is assigned at Sales-Order/fulfilment time, not at Opportunity. **`createWorkOrder` is a future
downstream seam behind Sales-Order service fulfilment — NOT an Opportunity/Account action.** Repository
mechanics (a callable existing) do not dictate where the UX action belongs.

## 8. Smallest coherent Sales operating experience (Cycle 2/3 frontend — on the Wave-0 primitives)
Read-first where authority is greenfield; consumes canonical Account/Contact context.
- **Sales Operating Workspace** (WorkspaceShell): salesperson/channel **context** → **attention** (missing
  info / no next action / quote expiring / customer inactivity / approval) → **work area** = opportunity
  pipeline/work queue → **next actions** / continue-working. Not a metric-card CRM dashboard.
- **Opportunity list / pipeline** (Collection/Queue type): owned opportunities, stage, value, next action,
  attention — a Dense-Table/queue, not card grid.
- **Opportunity Detail foundation** (Entity Detail type): **Context Band** (customer · contact · location ·
  salesperson · channel) → commercial state (stage · expected close · value) → customer need → solution
  (equipment/parts/services) → **attention** → activity/timeline → **one next action**. Avoid equal-weight
  card farms — hierarchy + progressive disclosure + Context Band + Status Pill + Action Rail.

## 9. Decisions — RATIFIED (Owner, 2026-08-07)
1. **Write authority = TRUSTED COMMAND.** Client writes to `opportunities` **DENY**; business-intent commands
   own writes (a small family — createOpportunity / updateOpportunity / advanceOpportunityStage /
   closeOpportunityWon / closeOpportunityLost — expressible in one coherent command service, not necessarily
   five Cloud Functions; never a `updateOpportunityDocument(fields)` public contract). Client **read** authority
   is its own governed design — do NOT widen reads for convenience. The eventual `firestore.rules` delta stays
   Tier-2 / hash-anchored / operator-deployed (a separate operational gate); the **architecture is approved
   here** — no further "go" is needed to build the trusted-command design.
2. **Lifecycle = the single shared set in §4** (IDENTIFIED → QUALIFYING → SOLUTION → QUOTING →
   CUSTOMER_REVIEW → DECISION → WON | LOST), one base lifecycle for both channels. **Ratified.**
3. **Owner = `ownerEmployeeId`** — a canonical Employee reference (not free text, not a Firebase UID as
   business identity). `salesChannel` (NATIONAL_ACCOUNTS | RETAIL) is business context, not a grant or a
   schema fork. **Ratified.**
4. **Build-before-deploy = APPROVED.** Cycle 2/3 domain + frontend proceed before the Opportunity authority is
   deployed. Because Opportunity is greenfield, use **SYNTHETIC governed Opportunity scenario fixtures** (they
   reference the realistic sandbox Accounts/Contacts/Locations/Parts/Equipment once those exist). A MINIMAL
   injected read-model seam (`OpportunitySource` → projections → frontend) hides whether the source is
   synthetic-today or governed-later; do not expose fixture plumbing in business components, and do not build a
   large repository framework or a second production authority.

## 10. Recommended Cycle-2 sequence
Assessment (this) → **architecture/lifecycle decision** (ADR-scope: opportunities authority + write path + the
Won→Sales-Order seam) → **Specification** (fields, states, validation, Rules contract, capability) →
Implementation Plan → implementation (repo-only domain/UI first; the Rules/authority deploy is a separate
protected gate). Frontend (Sales workspace + Opportunity detail on Wave-0 primitives) proceeds against seeded
fixtures once the model is specified — no new authority shipped to production without its own gate.

## 11. EOS commercial process invariants (durable — compression-integrity guard)
These are ratified invariants for the whole Sales → fulfilment programme; keep them visible so long-session
compression cannot drift the process. Any future work that violates one is DRIFT and must be rejected.

- **Product/Design = one build stream** (owns product architecture, frontend design, implementation, shared
  primitives). **UX = independent evaluator** (persona missions/scenarios/journeys/IA discovery/verdicts).
  Product/Design running the canonical persona-scenario programme = **ROLE DRIFT — reject.**
- **Sales entry = Opportunity.** **Account = relationship authority, not a pipeline transaction** (0..N
  opportunities per account; no pipeline state on Account). `Account → Work Order` as the normal Sales flow =
  **PROCESS DRIFT — reject.**
- **Opportunity is pre-commitment** and identifies **product/model/part, never a serialized asset.**
  `Opportunity → serialized inventory assignment` = **SEQUENCING DRIFT — reject.** Serialized assignment
  happens after WON → Sales Order → fulfilment.
- **WON = customer commitment, not fulfilment.** `WON = delivered/paid` = **AUTHORITY DRIFT — reject.**
- Canonical authorities own their state: **Sales Order** = committed commercial order; **Work Order** =
  downstream service execution; **Inventory** = physical stock; **Warehouse** = pick/prep; **Accounting** =
  billing/receivable/collection; **Commission** = separate governed financial policy. Sales retains
  cross-domain **visibility** (project downstream states) but **never persists** a parallel
  `salesOrder.warehouseStatus / .workOrderStatus / .invoiceStatus` — prefer a cross-domain
  commercial-fulfilment projection over the canonical authorities.
- **ADR-012 controlling:** persona ≠ authority; operational responsibility ≠ grant; effective access is
  derived. Opportunity ownership is business responsibility, not security authority.
