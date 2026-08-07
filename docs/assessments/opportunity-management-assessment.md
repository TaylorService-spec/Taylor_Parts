# Opportunity Management — Assessment (Sales commercial entry point)

Status: **ASSESSMENT — design-first, no implementation.** Opportunity persistence is **greenfield**; per the
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
  ownerRef             → the salesperson (operating identity — see §6; NOT a security role)
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

## 4. Lifecycle — small, Taylor-specific (HYPOTHESIS to validate against the business)
```
NEW/IDENTIFIED → QUALIFICATION → PRODUCT_SOLUTION → QUOTING → CUSTOMER_REVIEW → DECISION → (WON | LOST)
```
Do NOT copy Salesforce's ten stages. Keep it small. **The exact state set + semantics require Taylor Parts
business truth** (this is a genuine unresolved decision — see §9). `outcome` (WON/LOST) is distinct from
`stage`; WON means "customer committed to buy" — it does NOT mean prepared/scheduled/delivered/invoiced/paid.

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

## 9. Material decisions for Owner (return here — genuinely unresolved / protected)
1. **Opportunity write path + Rules (PROTECTED).** New `opportunities` collection needs a governed write path
   — (a) client-direct-with-rules (like `accounts`) or (b) a trusted command (like the catalog commands) —
   and a `firestore.rules` addition (Tier-2, hash-anchored, operator-deployed). Which write path?
2. **Lifecycle state set + semantics** — the §4 hypothesis needs Taylor Parts business truth (real stage names/
   gates for National Accounts vs Retail). Confirm/adjust before it becomes schema.
3. **Salesperson/channel identity model** — `accountOwner` is free text today; Opportunity needs an owner
   reference + channel. Is owner an `employees`/`users` link or a business label for now? (Territory/scope is
   a separate greenfield per ADR-012 G-2.)
4. **Build-before-deploy path** — may the greenfield Opportunity frontend be developed and validated **read-
   first over seeded sandbox opportunity fixtures** (using the Stream-C fixture pipeline) while the production
   authority (collection + Rules) awaits its own protected deploy? (Recommended — keeps Cycle 2/3 moving.)

## 10. Recommended Cycle-2 sequence
Assessment (this) → **architecture/lifecycle decision** (ADR-scope: opportunities authority + write path + the
Won→Sales-Order seam) → **Specification** (fields, states, validation, Rules contract, capability) →
Implementation Plan → implementation (repo-only domain/UI first; the Rules/authority deploy is a separate
protected gate). Frontend (Sales workspace + Opportunity detail on Wave-0 primitives) proceeds against seeded
fixtures once the model is specified — no new authority shipped to production without its own gate.
