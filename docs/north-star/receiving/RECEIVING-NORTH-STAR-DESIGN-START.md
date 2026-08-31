# Receiving — North Star Design Starting Point

**Status:** DESIGN START  
**Surface:** Inventory → Receiving  
**Primary focus:** Receiving workspace composition, including **Add existing unit**  
**Authority posture:** PRESERVE EXISTING GOVERNED AUTHORITIES  
**Implementation posture:** PRESENTATION / COMPOSITION FIRST  
**Backend rebuild:** NOT AUTHORIZED

---

## 1. Purpose

Design the Receiving experience as a clear operational workspace for warehouse users.

The page must support two different truths without blending them:

1. **Receive against a purchase order**  
   Normal procurement flow: purchase order → receipt → company inventory.

2. **Add an existing company-owned unit without a purchase order**  
   Exceptional custody-entry flow for a serialized unit the company already owns.

The design should make these workflows understandable to an operations user without requiring knowledge of collections, Functions, capability IDs, document IDs, provenance enums, or implementation details.

This document is a **design starting point**, not an instruction to redesign authority.

---

## 2. North Star Rule

Treat this work as a **presentation-layer migration / composition exercise**, not a platform rebuild.

Preserve all existing governed authority unless a separately approved product decision explicitly changes it.

### Do not redesign or replace

- Firestore data models
- Cloud Functions / trusted writers
- Firestore Rules
- capability IDs or activation
- Role grants
- transaction boundaries
- audit behavior
- idempotency behavior
- inventory custody semantics
- purchase-order authority
- receiving authority
- serialized-asset authority
- Equipment installation authority
- provenance enum values
- state machines
- numbering
- domain derivations

If Design needs a fact or action that does not already exist, mark it:

> **AUTHORITY GAP — DO NOT INVENT**

and return it for product / engineering review.

---

## 3. Existing Governed Workflows

### A. Receive against Purchase Order

This is the normal warehouse receiving path.

Business meaning:

> Receive goods the company ordered from a supplier against an existing purchase order.

Design may compose the existing facts and actions, but must not create a second receiving authority.

Expected concepts may include:

- purchase order
- supplier
- expected items
- received quantity
- serialized units where applicable
- receiving location
- receipt status / progress
- exceptions or shortages when governed facts exist

Do not infer facts that the existing authority does not provide.

### B. Add Existing Unit

This is the governed non-PO acquisition path.

Business meaning:

> Bring an already-owned serialized unit into managed company inventory without creating a purchase order or supplier receipt.

This is **not**:

- customer Equipment creation
- Equipment installation
- purchase receiving
- a fake purchase order
- a supplier transaction
- a migration shortcut that changes provenance
- a way to bypass warehouse-location authority

The live authority already exists and has been proven end to end.

### Governed acquisition inputs

- Part
- Serial number
- Company location
- Reason
- Provenance note — optional

### Governed reason vocabulary

Keep the existing closed vocabulary and semantics:

- **Opening balance**
- **Legacy migration**
- **Existing company asset**

Do not add new reasons in Design.

### Governed result

Successful acquisition creates a company-owned serialized asset that is:

- in company inventory
- **AVAILABLE**
- not assigned to a customer
- not represented as a purchase receipt
- not represented as installed Equipment

It can subsequently appear in **Equipment → Available Equipment** and may later use the governed **Install at customer** action.

---

## 4. Product Placement

The non-PO acquisition workflow belongs under:

> **Inventory → Receiving**

It does **not** belong under the Equipment workspace.

Equipment describes units the company services / installs / tracks at customers and available serialized stock.

Receiving is where company custody begins.

Do not reuse **Add Equipment** for acquisition.

---

## 5. Receiving Workspace Design Goal

The page should answer, at a glance:

1. **What am I receiving?**
2. **Why is it entering company inventory?**
3. **Where is it going?**
4. **What governed source supports the transaction?**
5. **What needs my attention?**
6. **What can I safely do next?**

The page should feel like an operational workspace, not a collection of raw forms.

---

## 6. Recommended Information Architecture

Design is free to improve visual composition, but start from this hierarchy.

### Page identity

**Receiving**

Short operational description, if useful:

> Receive purchased inventory and record company-owned units entering managed custody.

Avoid duplicate page titles inside child surfaces.

### Primary workflow area

Two clearly distinguishable entry paths:

#### Receive against purchase order

This should remain the primary / normal workflow.

Possible action language:

> **Receive purchase order**

or use the existing governed action wording if already established.

Supporting copy should explain that this path reconciles receipts against procurement authority.

#### Add existing unit

Secondary / exceptional workflow.

Suggested language:

> **Add existing unit**

Supporting copy:

> Record a serialized unit the company already owns when there is no purchase order or supplier receipt.

Do not make the exceptional path look equivalent to ordinary procurement if the hierarchy can communicate that distinction.

---

## 7. Add Existing Unit — Form Grammar

Design this as a deliberate governed transaction, not a row of controls.

Recommended order:

### Part

Label:

> **Part**

User-facing control should show a recognizable part identity.

Do not present raw document IDs as the primary label.

Only eligible serial-tracked parts should be selectable if that is the governed behavior.

### Serial number

Label:

> **Serial number**

Required.

Make the requirement obvious without showing an error before the user has interacted with the field.

### Company location

Label:

> **Company location**

This must use the existing governed warehouse / receiving location authority.

Do not permit arbitrary text entry for a warehouse identity.

Do not guess or default a location after a failed read.

### Reason

Label:

> **Reason**

Render the three governed choices clearly, preferably vertically.

#### Opening balance

> Already in company custody when this system began tracking inventory.

#### Legacy migration

> Carried into managed inventory from a prior system or governed migration process.

#### Existing company asset

> A unit the company already owns that was not previously recorded in managed inventory.

These descriptions are presentation copy. They must not change the underlying reason values or provenance semantics.

### Provenance note

Label:

> **Provenance note**

Mark as optional.

Supporting copy may explain:

> Add supporting context for why this unit is entering inventory without a purchase order.

A note does not replace the required Reason.

---

## 8. Two-Stage Consequential Action

Do not commit merely because the last required field became valid.

Use two stages:

### Stage 1 — Compose

Action:

> **Review acquisition**

This stage performs no write.

### Stage 2 — Confirm

Read back the governed facts:

- Part
- Serial number
- Company location
- Reason
- Provenance note, if provided

Consequence copy should be explicit, for example:

> This creates a company-owned serialized asset in AVAILABLE inventory without a purchase order or supplier receipt. It does not assign the unit to a customer.

Primary action:

> **Confirm acquisition**

Secondary action:

> **Back**

Do not hide the consequential meaning behind generic **Save** language.

---

## 9. Location Truth Model

The location picker must display one truthful state at a time.

### Loading

- picker disabled
- message such as:
  > Loading company locations…

### Ready

- governed active locations available
- picker enabled
- no failure message

### Empty

- picker disabled
- truthful message:
  > No eligible company locations are available.

### Denied

- picker disabled
- authorization-specific message
- do not imply retry will help if the user lacks authority

### Error / Unavailable

- picker disabled
- message:
  > Company locations could not be loaded.
- Retry may be shown only if supported by the existing read seam

### Critical invariant

Never simultaneously show:

- a selected / default company location

and

- text claiming locations could not be read.

If the governed location set becomes unavailable, stale selection must not be presented as validated truth.

---

## 10. Validation Grammar

Required:

- Part
- Serial number
- Company location
- Reason

Optional:

- Provenance note

### Design rules

- Do not open the form with a wall of red errors.
- Show a field-level message after interaction or when progression requires it.
- Do not repeat the same validation sentence in multiple places.
- If a primary action is unavailable, the user should be able to understand what remains incomplete.
- Avoid using a disabled button as the only explanation.

A concise summary such as:

> Still needed: company location and reason.

is acceptable when it does not duplicate field-level copy.

---

## 11. Success State

After a successful write, the workflow should stop looking armed.

Recommended success language:

> **Added to company inventory**

Supporting state may truthfully communicate that the unit is now recorded.

Do not imply:

- a purchase order was created
- a supplier receipt exists
- the unit was installed
- the unit belongs to a customer

The existing command remains the authority for idempotent replay.

Do not add a client-side duplicate-write mechanism.

---

## 12. Receiving Page Composition Principles

### Use

- North Star workspace container / page measure
- existing surface tokens
- clear section hierarchy
- consistent vertical rhythm
- labels above controls
- full usable control widths
- human-readable identities
- intentional empty / loading / denied / error states
- responsive desktop and handheld composition
- existing accessible focus and target-size rules

### Avoid

- nested page shells
- duplicate H1/H2 page identity
- raw internal IDs as user labels
- cool-grey one-off surfaces that drift from the warm-stone system
- hard-coded palette values where tokens exist
- dense inline form rows for consequential transactions
- generic error copy that collapses EMPTY / DENIED / ERROR
- engineering terminology such as callable, collection, Firestore, capability ID, document ID, enum, or transport in user-facing UI

---

## 13. Relationship to Equipment

Keep the object boundaries clear.

### Receiving

Owns:

- entry into company custody
- purchase-order receipt
- non-PO acquisition of already-owned serialized units

### Available Equipment

Shows:

- company-owned serialized stock that is available for later assignment / installation

### Customer Equipment

Shows:

- installed customer-serviceable units

### Add Equipment

Creates:

- an already-installed customer Equipment record

It does **not** add company inventory.

Do not merge these workflows in the Receiving redesign.

---

## 14. Design Freedom

Design may improve:

- hierarchy
- page rhythm
- workflow grouping
- tabs / subnavigation where appropriate
- card / section composition
- helper copy
- spacing
- control arrangement
- responsive behavior
- action placement
- confirmation presentation
- success presentation
- empty / error presentation
- operational readability

Design may propose a better Receiving page than the current implementation.

However, every proposal must remain truthful to the governed actions and facts described above.

---

## 15. Design Questions That May Be Explored

Design may decide:

- whether PO receiving and Add existing unit appear as primary actions, tabs, sections, or a secondary workflow entry
- how the active receiving queue / history should be composed from existing facts
- where filters belong
- whether the non-PO flow should open inline, in a side sheet, or in a modal
- how confirmation should visually distinguish a high-trust non-PO acquisition
- how desktop and handheld receiving differ while preserving the same authority

If a design concept requires data or actions that do not exist, record the gap rather than fabricating the capability.

---

## 16. Explicit Non-Goals

This design pass is not authorization to:

- build new Functions
- add new callables
- change Firestore Rules
- create new capabilities
- activate capabilities
- modify Role grants
- change provenance semantics
- change acquisition reason values
- modify serialized asset lifecycle
- alter PO receiving authority
- alter installation authority
- create customer Equipment during acquisition
- change inventory ownership semantics
- introduce new company / operating-company inference
- add schema fields
- backfill data
- redesign audit events
- change idempotency
- create procurement records for non-PO acquisitions

---

## 17. Governance Checkpoint Before Implementation

Before implementation begins, produce a short composition map:

| Design element | Existing fact / action | Authority source | Design status |
|---|---|---|---|
| Receive purchase order | Existing Receiving action | Existing governed Receiving authority | COMPOSE |
| Add existing unit | Existing acquisition action | `acquireSerializedAsset` trusted writer | COMPOSE |
| Part identity | Existing governed part projection | Existing read authority | COMPOSE |
| Company location | Existing receiving warehouse-location authority | Existing governed read | COMPOSE |
| Acquisition reason | Existing closed reason vocabulary | Existing command contract | COMPOSE |
| Provenance note | Existing optional command input | Existing command contract | COMPOSE |
| Any new requested fact | None | None | AUTHORITY GAP |

Implementation does not begin on an **AUTHORITY GAP** without a separate ruling.

---

## 18. Implementation Sequence

Once the design is accepted:

1. **Design lock**
2. **Composition map against existing authorities**
3. Implement presentation using existing facts/actions
4. Add focused Receiving-family tests
5. Run existing governance / conformance gates
6. PR review
7. Merge
8. **Hosting refresh only** unless the diff genuinely changes backend authority
9. Quick Gate against the exact deployed SHA
10. Owner visual acceptance
11. Close the Receiving presentation tranche

Do not redeploy Functions merely because Receiving UI changed.

---

## 19. Acceptance Criteria

The Receiving redesign is ready for Owner review when:

- page identity is singular and clear
- normal PO receiving is obvious
- Add existing unit is discoverable but clearly exceptional
- Part / Serial / Location / Reason / Note read as one governed form
- location states are truthful and mutually exclusive
- no raw IDs are promoted as labels
- Review and Confirm are separate
- consequence is clear before the write
- success state clearly communicates company inventory entry
- no fake procurement/customer semantics appear
- desktop composition is coherent
- handheld composition is usable
- existing authority tests remain green
- no backend authority changed without an explicit ruling

---

## 20. Current Proven State

The following is already proven in sandbox and should be treated as existing authority, not redesigned from scratch:

- non-PO serialized acquisition command exists
- callable is deployed
- client acquisition path exists under Receiving
- real sandbox acquisition succeeded
- idempotent replay succeeded
- acquired unit appeared in Available Equipment
- resulting unit was `AVAILABLE`
- unit had no customer assignment
- warehouse location was preserved
- Equipment Family 8 is independently closed / Owner accepted

The Receiving design can now focus on making those governed workflows understandable, efficient, and visually coherent.

---

# Design Handoff

**Start here:** redesign the Receiving page around the two governed custody-entry workflows while preserving every authority boundary above.

When in doubt:

> **Compose existing authority. Do not invent authority.**
