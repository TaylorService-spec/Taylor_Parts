# D-1: Delivery and customer-acknowledgment spec (EOS)

**Status:** SPEC. Docs only. No code, no migration, no capability, no grant, no activation, no deploy.
**Issued:** 2026-10-20 (America/Phoenix). **Base:** `main` `b3d09dc3`.
**Plan row:** lane D-1 of the B5 acceptance matrix (`evidence/B5-ACCEPTANCE-MATRIX.md`): stage 8 "delivery object / delivery work order" (MISSING), stage 9 "customer acknowledgment / signature" (MISSING), commercial scenarios A, C and F.
**Reads:** the S1a stock-reservation spec (PR #2167, `docs/architecture/s1a-stock-reservation-spec.md` on branch `res/s1a-stock-reservation-spec`, not yet on `main`), because delivery consumes reservations.
**Machine-readable companion:** [`d1-delivery-grant-parity.json`](d1-delivery-grant-parity.json) (Firebase-parity holders, derived read-only).
**In flight, not read:** F-1 (invoicing), Q-1 (quotes), W-1 (warranty). No document from those lanes existed on `main` or in an open PR when this was written. Every link to them below is stated as an interface to confirm, not as a fact about their design.
Every material choice is a numbered **OWNER DECISION** (section 10), with options and a recommendation.

---

## 1. Summary

| Question | Answer |
|---|---|
| Does EOS have any delivery concept? | **No.** There is no delivery table, Work Order type, command, route or screen. The Firebase estate had none either: its serialized-asset state `DELIVERED` and its comment "CUSTOMER delivery is a separate, not-yet-authorized future capability" (`permissionCatalog.ts:1365`) were never given a writer. |
| Does EOS have any customer signature or acknowledgment? | **No.** No table, column, command or screen stores a customer signature, a signer name or a "received by" fact. The only binary custody in EOS is `eos_ops.inbound_work_attachments`, which belongs to inbound email. |
| What does a retail equipment sale do today? | Sales Order -> an `INSTALL` Work Order -> the technician installs a serial from stock (`equipment.install`) -> completion writes fulfillment evidence -> the billing package is prepared in the same transaction. Delivery is invisible: it is part of the install visit. |
| Is a delivery a new object or a Work Order? | Both, with different jobs (OD-1): a **Work Order** is the visit (who, when, where, dispatch, offline, completion); a **delivery record** is what was handed over. Recommended. |
| Where does the customer's acknowledgment live? | On the **Work Order**, as an append-only record with an outcome, a signer, a capture method and a binding to what the signer saw (OD-7, OD-8). It is not a Sales Order field and not a delivery status. |
| Can the recommended design work offline on a phone? | Yes, as a sixth technician intent that must sync before completion (OD-12). It needs no new transport. |
| Does it need a grant? | **Not if the Owner takes OD-15 A.** Firebase held no delivery or acknowledgment key, so there is no parity set for a new key. A new key would be a non-parity grant and is a STOP. Reusing existing keys needs no grant. |
| Can PR 2 be built now? | **No.** Even the smallest slice (an acknowledgment record on an existing completion) depends on OD-7 to OD-15. Section 9. |

---

## 2. What was read

| Subject | Where | Fact that matters |
|---|---|---|
| Work Order types and statuses | `functions/migrations/1761004800000_work-order-object-authority.sql:50-55` | `ops_work_order_type` is exactly `SERVICE_CALL, PM, INSTALL, WARRANTY, INSPECTION`. Eleven statuses, `CREATED` to `CLOSED`/`CANCELLED`. |
| Lifecycle and completion | `eosOps/workOrderLifecycle.ts`, `eosOps/workOrderScheduling.ts:476-` | `complete` is a command edge. In the same transaction it writes Commercial fulfillment evidence and, when the Sales Order is then ELIGIBLE in full, prepares the billing package (`:503`). Nothing in it asks for a customer fact. |
| Execution facts | `eosOps/workOrderExecution.ts`, migration `1764300000000` | Append-only `work_order_execution_records` (`PART_USAGE`, `NOTE`), idempotent by key, capability `workOrder.execution.record` + `RECORD_ASSIGNMENT`. Labor reuses the same key (`1764330000000` header). |
| Serialized install | `eosOps/workOrderEquipmentInstall.ts`, `eosOps/equipmentCustody.ts` | One transaction: ledger -1 at the source, custody -> `EQUIPMENT`, Equipment minted, `equipment_events INSTALLED`. The Equipment attributes passed are `{ name, notes }` only (`workOrderEquipmentInstall.ts:389`): **`installed_on` and `warranty_expires_on` are never set by an install.** |
| Custody vocabulary | `1757980800000:68,132`; `1757808000000:80`; `1764122400000:17` | Custody locations are `WAREHOUSE, BIN, MOBILE, EQUIPMENT`. "CUSTOMER is deliberately NOT a location type." Serial status is `AVAILABLE, RESERVED, INSTALLED, CONSUMED, SCRAPPED, IN_TRANSIT`. A unit that left Taylor but is not yet Equipment has no representation. |
| Commercial fulfillment | `eosCommercial/fulfillment/salesOrderFulfillmentAuthority.ts:135-` | An `EQUIPMENT_MODEL` line is fulfilled **only** by `equipment_events INSTALLED` of that model on the linked Work Order. A `PART` line is fulfilled by recorded `PART_USAGE`. A delivery cannot fulfil an equipment line. |
| Billing package | `eosFinance/billingPackage.ts` | Prepared server-side at completion; exception vocabulary has no acknowledgment concept. Precedent: DECISIONS #201 says delivery, installation, completion and "customer acceptance" never entitle financed funding. |
| Fulfillment intent | `1759449600000:67,125` | `agreement_fulfillment_intent` `DELIVER, INSTALL, BOTH` is on the **Sales Agreement** only. `sales_orders` has no intent column, and a direct order has no agreement. |
| Sales Order to service | `eosOps/serviceFromSalesOrderBoundary.ts` | Pure seed. PART lines are refused (`ALLOCATION_AUTHORITY_UNAVAILABLE`) until S1c. A Work Order is linked to Sales Order lines through `work_order_sales_order_lines`. |
| Pick and stage | `1764126000000` header; `1758672000000:379-` | A pick is a descriptive `bin_placements` row with `picked_for_work_order_id` (moves no stock). A `transfer_orders` row moves **one Part** between two locations and carries no demand link. There is no Sales Order pick. |
| Service-provider scope | `eosCommercial/fulfillment/serviceProviderAuthorization.ts:5` | `serviceScopeForWorkOrderType` maps `INSTALL -> INSTALLATION` and **every other type -> SERVICE**. A new type added without touching it would silently be classed SERVICE. |
| Offline queue | `field-ops-app-vite/src/offline/technicianIntent.js:34-60`, `technicianIntentCapture.js`, `modules/mobile/FieldMode.jsx:150` | A closed list of five intents (note, labor, parts, install, complete); only Complete is queueable among lifecycle edges; install is a REQUIRED dependency of completion; intent ids derive from (type, work order, capture key); an offline capture states a device clock claim separately (`deviceReportedAtMillis`). Storage is IndexedDB with a localStorage fallback and an explicit quota refusal; it is not application-encrypted (`localIntentStore.js:35`). |
| Request size | `eosOps/eosOpsHttp.ts:1271` | `MAX_BODY_BYTES = 1_000_000`. |
| Binary custody precedent | `1764350000000:135-156` | `inbound_work_attachments`: `BYTEA`, 25 MiB cap, SHA-256 shape check, append-only trigger. Evidence-by-reference precedent: `financing_approval_evidence` (DECISIONS #201). |
| Prior Owner direction on signatures | `docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md` section 4.0a (HISTORICAL DESIGN INPUT, not authority) | Owner 2026-07-31: signature is a three-rung ladder (on-device e-signature; print, wet-sign, photograph; outside process), **in-field and in-person only, no send-for-signature** (Q36, RESOLVED), bound to what was signed, terminal and immutable. Q33 (storage) and Q35 (retention and evidentiary weight) were never answered. Restated here as OD-9 and OD-14 because that document is not current authority. |
| Title at delivery | DECISIONS #99 (D-2); `functions/src/fulfillment/inventoryControlLifecycle.ts:86-91` | Owner ruling: Taylor-to-customer title passes at **successful delivery/acceptance**, never at installation-complete or sale-close. Only a Firebase-era pure function and a client mirror exist; EOS has no title axis. |
| Firebase delivery / signature / proof-of-delivery | `functions/src` (grep) | None. Only `installSerializedAssetCommand.ts` lists `DELIVERED` as an installable state with no writer. |

**Defects and gaps found while reading** (each is resolved in section 3 to 8 or in an OD):

1. **No delivery anywhere.** The business wants it (B5 scenario A: reservation -> delivery -> installation) and the platform vocabulary already half-knows it: `business_unit INSTALLATION` "covers delivery + installation (an INSTALL Work Order)" (`1764510000000:294`).
2. **No acknowledgment anywhere.** A completed job leaves no customer-side evidence.
3. **An install does not record when it happened.** `installed_on` stays NULL (above). Warranty start has no date to start from.
4. **A delivery-only equipment sale can never be billed.** Equipment lines are fulfilled by installation only, billing eligibility needs fulfillment in full, so a `DELIVER`-intent sale never reaches ELIGIBLE.
5. **Billing is triggered by completion with no customer fact.** Not a defect today; it becomes a policy choice the moment an acknowledgment exists (OD-6).
6. **Custody has no "left Taylor, not installed" state.** ADR-010 section 3 designed delivery through a Transfer to a customer Location; EOS declined a CUSTOMER location.
7. **Picking has no demand link.** A transfer cannot say which sale or visit it loads.
8. **The Work Order type vocabulary is wide.** About twenty non-test files name it (grep of `INSPECTION`), including the `serviceScopeForWorkOrderType` default above.
9. **The Sales Order has no fulfillment intent**, so "deliver only" is knowable only through the Agreement.
10. **The offline list is closed at five** by design, and the 1 MB request cap rules out an unprocessed phone photograph.
11. **Customers are not platform principals.** Any signer is a person named on the day, not an account.

---

## 3. Delivery object versus delivery Work Order

Two things are being called "delivery":

- **The visit.** Someone is scheduled, dispatched, travels, arrives, hands the goods over, leaves. Everything here already exists for a Work Order: the dispatch board, availability, assignment, offline completion, labor, company isolation.
- **The handover.** These items, these serials, this quantity, from this stock, to this site, on this day, accepted or not. Nothing here exists.

Making the handover a second schedulable thing would create a second scheduling authority beside the Dispatch domain. Making the visit the only thing leaves the handover with nowhere to live except a free-text note.

**Recommended (OD-1 B):** a delivery is a Work Order (the visit) that owns one **delivery record** (the handover: header and lines). The customer acknowledgment attaches to the Work Order (section 6), so one design serves delivery visits, install visits and, later, service tickets.

```
Sales Order lines --(work_order_sales_order_lines)--> Work Order [type DELIVERY | INSTALL]
                                                          |-- delivery record: header + lines (what was handed over)
                                                          |-- execution records (parts used, notes, labor)       [exists]
                                                          |-- customer acknowledgment (append-only)               [new]
                                                          '-- equipment_events INSTALLED (install visits only)    [exists]
```

**Scope of v1 (OD-1):** sale deliveries (Sales Order -> customer site) only. Rental delivery and pickup (they already ride an `INSTALL` Work Order with `rentalAgreementId`), parts counter / will-call pickup (no Work Order exists for it), and customer returns are **out** until ruled. The acknowledgment primitive is deliberately Work-Order-level so rental can reuse it unchanged.

**Type vocabulary (OD-2).** Adding `DELIVERY` to `ops_work_order_type` is the clean answer for a delivery-only visit, because `INSTALL` carries install semantics: the install closeout, the "equipment does not exist yet" creation rule, `serviceScopeForWorkOrderType`. It costs a migration and about twenty touch points. The one that fails silently is `serviceScopeForWorkOrderType`, which would classify a `DELIVERY` Work Order as SERVICE for the cross-company authorization of FBR-F2; it must map `DELIVERY -> INSTALLATION` in the same change. A delivery combined with install in one visit stays an `INSTALL` Work Order (it already is today).

---

## 4. Picking

**What exists:** a descriptive pick (`bin_placements.picked_for_work_order_id`, moves nothing), a warehouse -> truck transfer (moves stock; one Part per transfer; serial units supported, `IN_TRANSIT` then `MOBILE`), and from S1a a reservation claimed by a Work Order at dispatch (S1a OD-5, OD-10: the Sales Order claim is handed over to the Work Order at its dispatch).

**What is missing:** a link from the stock that was loaded to the visit that loads it, and a Sales Order pick.

**Recommended (OD-4 A):** no pick-list object.

1. **The delivery Work Order is the demand document.** The Sales Order lines it is linked to become its parts plan (the S1c create-service seed). S1a's hand-over makes the Work Order, not the Sales Order, the claimant by dispatch.
2. **A pick is the existing movements, made traceable.** The warehouse picks (optionally recording the bin pick) and transfers each Part to the delivery truck. One additive nullable column on `transfer_orders` (the delivery Work Order id) makes each load traceable to its visit. Equipment lines are picked by naming the **serial** in the transfer; the transfer's own serial check (`requireSerialsAt`: each unit must be in custody at the origin in the expected status) means two visits cannot load one unit.
3. **"Picked" is derived, never stored.** A delivery Work Order is fully picked when each planned line has a `COMPLETED` transfer to the dispatching truck for its quantity or serials. A shortfall is shown as attention at dispatch; it does not block dispatch (the same posture as S1a OD-5 A).
4. **Reservation remains S1.** Picking reserves nothing; a unit is claimed to one visit by the transfer. Serial reservation before the pick stays out (S1a OD-8).

Alternatives (OD-4): B a pick-list object with its own states (more control, a second status machine); C no link at all (cheapest, leaves "what is on this truck for this customer" unanswerable).

---

## 5. Delivery lifecycle

**The Work Order carries the lifecycle.** Its eleven statuses and the existing edges are unchanged. A delivery adds **facts**, not states (OD-5 A):

| Moment | Existing edge | Delivery fact |
|---|---|---|
| Demand | Sales Order CONFIRMED; reserve (S1a) | Delivery Work Order created from Sales Order lines (`workOrder.create` with `salesOrderId` + `salesOrderLines`, which exists). |
| Pick and load | `READY_TO_DISPATCH` / `SCHEDULED` | Transfers to the truck, linked to the Work Order (section 4). |
| Dispatch | `DISPATCHED` | S1a hands the claim to the Work Order. |
| Travel, arrive | `ACCEPTED`, `EN_ROUTE`, `ARRIVED` | None (these are location reports and are not queueable offline, by existing design). |
| Handover | `WORK_IN_PROGRESS` | **Delivery record written**: one line per Sales Order line delivered, with quantity shipped, serials, and the truck it came from. Outcome `DELIVERED_IN_FULL`, `DELIVERED_PARTIAL` (with a reason) or `NOT_DELIVERED` (with a reason). |
| Customer acknowledgment | `WORK_IN_PROGRESS` | Section 6. |
| Complete | `COMPLETED` | Existing completion. Fulfillment evidence and billing consequences are unchanged in v1 (OD-6). |
| Close / cancel | `CLOSED` / `CANCELLED` | Unchanged. A cancel of a loaded visit leaves stock on the truck; returning it is an ordinary truck -> warehouse transfer. Nothing is reversed automatically. |

**Partial delivery and backorder.** Backorder on a line is `ordered_qty - sum(quantity shipped over its delivery lines)`. A further delivery is a new Work Order created by a dispatcher. No Work Order is created automatically.

**Serialized units (OD-3).** A unit can be handed over inside an `INSTALL` visit because install already moves custody to `EQUIPMENT`. A **delivery-only** visit for a serialized unit has nowhere honest to put the unit afterward: the unit has left Taylor stock but is not installed Equipment, and EOS has no customer location. Options:

- **A (recommended for v1).** Delivery-only visits cover quantity (PART) lines. A serialized unit is delivered only as part of an `INSTALL` visit. The `DELIVER`-intent equipment sale (customer or third party installs) waits for B.
- **B.** Add a `DELIVERED` serial state and a customer-site custody reference, as ADR-010 section 3 designed. This changes the serialized-custody authority (a protected inventory surface) and the biconditional `serialized_custody_installed_is_equipment`.
- **C.** Mint Equipment at delivery. Rejected: it conflates delivery with installation and contradicts ADR-010 section 3 (Equipment is the product of installation) and the lifecycle document ("delivered is not installed").

---

## 6. Customer acknowledgment

### 6.1 What it is

An **append-only record on a Work Order** stating what the customer's representative said about what that visit did. It is evidence, not a state transition and not a payment trigger. One record covers one visit (OD-7 A); its `kind` says what the visit did: `DELIVERY`, `INSTALLATION`, `DELIVERY_AND_INSTALLATION`, or (later) `SERVICE`. Two signatures on one visit are not required; two visits have two records.

### 6.2 Fields (proposed; no migration written)

| Field | Rule |
|---|---|
| work order, tenant, operating company | The Work Order's. When a seller-authorized cross-company service provider performs the visit, the seller's company is stated beside it, as fulfillment does (`service_operating_company_key`). |
| `kind` | As above. |
| `outcome` | `ACCEPTED`, `ACCEPTED_WITH_EXCEPTIONS`, `REFUSED`, `NOT_OBTAINED` (OD-8). |
| exceptions | Per line: the delivery line, an exception kind (`SHORT`, `DAMAGED`, `WRONG_ITEM`, `OTHER`), the affected quantity, a note of at most 500 characters. Required for `ACCEPTED_WITH_EXCEPTIONS`; absent otherwise. |
| signer | Name (required for ACCEPTED and ACCEPTED_WITH_EXCEPTIONS, 2 to 120 characters), title or role (optional), optional CRM contact id that must belong to the Work Order's Account. A typed name is evidence of who the technician says signed. It is **not** identity verification. |
| capture method | `DEVICE_SIGNATURE` (rung 1), `PAPER_PHOTO` (rung 2), or none. Recorded, never inferred. |
| signature artifact | Rung 1: a PNG of the signature. Cap proposed at 64 KiB. Stored with its SHA-256. |
| what was shown | A statement version and the SHA-256 of the canonical content shown: the statement text, the delivery lines (items, serials, quantities) and the exceptions. |
| times | `recorded_at` is the **server clock**. A device clock claim (`deviceReportedAtMillis`) is kept as a separate field, never substituted, and never used for warranty or billing. |
| actor | The recording Principal (the assigned Employee). |
| idempotency, supersession | Idempotency key per Work Order, request fingerprint; `supersedes_id` for a correction (OD-13). |

### 6.3 Binding to what was signed

A signature stored loose against a record is close to worthless if the record can change afterward. Therefore:

- The client sends the hash of the content the signer saw. The server **recomputes** that hash from the recorded delivery lines and exceptions at the moment it records the acknowledgment. A mismatch is refused as `CONTENT_CHANGED` and nothing is bound silently.
- Offline, the same rule applies at sync. If the lines changed between capture and sync the intent goes to NEEDS_ATTENTION for a person; it is never re-bound automatically.
- The statement text is versioned and keyed by operating company and kind, so a Taylor and a Ventana visit show their own wording (OD-10). The wording is Owner and counsel text; Appendix A is a neutral draft for them to replace.

### 6.4 Outcomes and evidence (OD-8)

| Outcome | Meaning | Required evidence | Effect |
|---|---|---|---|
| `ACCEPTED` | Representative accepts everything delivered or done | Signer name and signature artifact (rung 1 or 2) | Evidence for title and for warranty start inputs (OD-16, OD-17) |
| `ACCEPTED_WITH_EXCEPTIONS` | Accepts, noting shortage, damage or error line by line | Same, plus at least one exception | Exceptions are visible on the Work Order. The exception does not itself reduce shipped quantity or move stock. |
| `REFUSED` | Representative refuses the delivery or the work | A reason (code and note). Signer name if given. A signature is optional. | Nothing is reversed automatically. Goods stay on the truck and the dispatcher decides. |
| `NOT_OBTAINED` | No acknowledgment could be captured | A reason code: `CUSTOMER_ABSENT`, `SIGNER_UNAVAILABLE`, `REFUSED_TO_SIGN`, `PAPER_OUTSIDE_SYSTEM`, `DEVICE_FAILURE`, `OTHER` with a note | Never reads as acceptance. |

**There is no unsigned acceptance.** `ACCEPTED` without a signature artifact is unrepresentable; a customer who accepts verbally and will not sign is `NOT_OBTAINED / REFUSED_TO_SIGN`. Rung 3 (a form filled outside the system) is `NOT_OBTAINED / PAPER_OUTSIDE_SYSTEM`; the platform does not pretend to hold what it does not hold.

### 6.5 Capture (OD-9)

- **Rung 1, on the phone.** The signer draws on a canvas on the technician's phone, in person. The client renders a bounded PNG (for example 600 by 200) and sends it. Small enough for the 1 MB request cap and for the offline store.
- **Rung 2, paper and photograph.** The photograph of a signed page is typically several MB. The platform has no object store; the precedent is bytes in PostgreSQL. A rung 2 build downsizes on the device to a bounded JPEG (for example 800 KB) and stores it in the same table with its hash. Recommended as the second build, not the first.
- **In person only.** No emailed request, no remote approver, no third-party e-sign (Owner, 2026-07-31, restated as part of OD-9).
- **Storage form (OD-9).** PNG bytes in PostgreSQL with SHA-256 (the `inbound_work_attachments` precedent) is recommended over a hash-and-reference-only record (the `financing_approval_evidence` precedent), because a reference to a signature nobody holds cannot show the signature in a dispute.
- **Device storage.** The offline store is not application-encrypted. A 64 KiB signature image sits on the phone until it syncs; this is stated, and a build must remove the image from the device once the intent syncs.

### 6.6 Offline (OD-12)

The acknowledgment is a **sixth technician intent**, `ACKNOWLEDGMENT_RECORD`.

- It joins the closed list on purpose; nothing generic is queued.
- Its identity is derived from (type, work order, capture key), as for the other five, and that id is the idempotency key, so a retry replays.
- Precedence sits between install (40) and complete (90). The delivery record and any install it describes must sync before it, and it must sync before completion when OD-11 requires it, so it is a REQUIRED dependency of completion exactly as install is.
- An offline capture states the device clock claim separately from the server time.
- Connectivity at customer sites is poor and the customer is standing there. An online-only acknowledgment would turn a dead zone into a job that cannot be completed.

---

## 7. Links to other capabilities

| Link | Design |
|---|---|
| **Installation (`installed_on`)** | An install visit records the acknowledgment with kind `INSTALLATION` or `DELIVERY_AND_INSTALLATION`. The install itself still does not set `installed_on` (gap 3). Setting it is W-1's slice ("`installed_on` at install"), from the server-recorded install event, in the operating company's business time. D-1 changes nothing in the install command. |
| **Warranty start (W-1)** | D-1 supplies dated facts: the install event time and the acknowledgment time, both server clock. **Which one starts the warranty is W-1's decision** (OD-17). A device clock claim never starts a warranty. |
| **Invoicing and billing (F-1)** | v1 changes nothing in fulfillment or billing: an equipment line is still fulfilled by installation, a part line by usage (OD-6, gap 4). The acknowledgment is **evidence F-1 may read**; it does not gate, hold or release a billing package unless the Owner rules otherwise. Precedent: DECISIONS #201, customer acceptance never entitles. Gap 4 (a delivery-only equipment sale never billing) is closed only with OD-3 B. |
| **Reservation (S1a)** | The delivery Work Order is the claimant after the S1a hand-over (S1a OD-10 A). Its PART lines reserve at its dispatch, and its completion consumes actuals. Serial units are not reserved before the pick (S1a OD-8). |
| **Title (D-2)** | The acknowledgment is the **evidence input** for the ratified "successful delivery/acceptance" rule. EOS has no title axis and D-1 does not build one (INV-4: operational controls do not establish ownership). OD-16 asks which outcomes count. |
| **Inventory control (two conditions)** | Unchanged. Delivery and acknowledgment end none of it (installation complete AND sale closed). |
| **Operating company** | The record inherits the Work Order's company and is read under the same company isolation. The statement and ticket wording is selected by company, not at print time. Taylor-performs-for-Ventana visits state both companies. |
| **Rental** | Out of v1; reuses the primitive unchanged when taken. |

---

## 8. Grants (A7-style)

### 8.1 Firebase-parity holders, derived

Derived read-only from `functions/src/access/{permissionCatalog,compatibilityRoles,governedBusinessRoles}.ts` at `b3d09dc3` (scratch copy, nothing written to a role, grant, database or fixture). Full machine-readable form: `d1-delivery-grant-parity.json`.

| Finding | Detail |
|---|---|
| **Firebase had no delivery, signature, acknowledgment or proof-of-delivery key.** | No catalog id contains `deliver`, `signat`, `acknowledg` or `proof`. `permissionCatalog.ts:1365` states customer delivery was "not registered". The **parity set for any new key is empty.** |
| Any grant to a new key | **Non-parity. STOP.** It needs an explicit Owner ruling on holders before any migration (OD-15 B). |
| Keys the recommended design reuses | `workOrder.create` (Firebase: admin, dispatcher, fieldManager, generalManager, officeManager, operationsManager, owner, partsAssociate, partsManager, shopAssociate, shopManager); `workOrder.transition` (the technician runtime edges; held by technician and ten others); `salesOrder.service` once S1c registers it (admin, dispatcher, owner: see the S1a companion); EOS-native `workOrder.execution.record`, `workOrder.lifecycle.dispatch`, `workOrder.lifecycle.complete` (no Firebase counterpart; holders are Administration data). **No holder changes.** |
| Conditioned Firebase grants | None for the keys above (`scopesByPermission` / `conditionsByPermission` empty). |
| EOS holders | Administration data in `eos_policy.role_capabilities`. **Not read here**: the brief forbids touching an environment, and the repository baseline is not the live table. The companion records `eosHolders: null` with that reason. |

### 8.2 Parity design (OD-15 A)

- Creating a delivery Work Order uses the existing `workOrder.create` with `salesOrderId` and `salesOrderLines`.
- The assigned Employee records the delivery record and the acknowledgment under `workOrder.execution.record` + `RECORD_ASSIGNMENT`, as labor already does. This **extends what that key's description says it covers** (parts used and notes). That is an authorization-model statement for the Owner, not a mechanical choice, and is recorded as OD-15.
- Completion stays `workOrder.lifecycle.complete`.
- **Result: no new key, no grant row, no migration of `role_capabilities`.**

### 8.3 Reads

The acknowledgment is read through the existing Work Order detail authority, inside company isolation. The signature image bytes are a separate read under the same authority and never travel in a list (OD-14). A narrower key for the image would be a new key and therefore a STOP.

---

## 9. Is PR 2 buildable? No.

The brief builds PR 2 only if this spec shows one governed answer for a self-contained slice, for example "a customer-acknowledgment record on an existing technician completion, with no new grant". That slice was tested against this spec:

| Piece of the slice | Blocked by |
|---|---|
| The record's shape and outcomes | OD-7 (one per visit, kinds), OD-8 (outcome and evidence rules) |
| What is stored, and how big | OD-9 (PNG bytes in PostgreSQL versus reference only; rung 2 timing) |
| What the signer is shown | OD-10 (wording is Owner and counsel text; the binding hash depends on it) |
| Whether completion needs it | OD-11 (changes the most-used technician edge, and the offline dependency graph) |
| The offline intent | OD-12 (a sixth member of a deliberately closed list) |
| Correction after completion | OD-13 (a correction capability would be a new key) |
| Who may record and read | OD-15 (extends a key's meaning; a narrower key is a non-parity grant), OD-14 |
| The migration | New table plus an append-only trigger. Needs the shape above, so it cannot be written first. Migration files are written by the controller from a `.txt` handoff; none is produced here. |

No part of the slice is a mechanical consequence of settled rulings. Writing it now would choose for the Owner. **PR 2 was not built.**

**Proposed build order after the Owner rules** (each ends in a PR, none is started):

1. **D1a. Acknowledgment on `INSTALL` and `SERVICE_CALL` completion.** Table, command (`ACKNOWLEDGMENT_RECORD`), offline intent, rung 1 only, read. Needs OD-7 to OD-15. No custody change.
2. **D1b. `DELIVERY` Work Order type and delivery record, quantity (PART) lines.** Needs OD-1, OD-2, OD-4, OD-5. Depends on S1b and S1c for dispatch-time reservation and the create-service seed.
3. **D1c. Serialized deliver-only.** Needs OD-3 B, which is a custody-authority ruling. Closes gap 4 together with OD-6.
4. **D1d. Rung 2 (paper photograph), rental reuse.**

---

## 10. OWNER DECISIONS

Each has options and a recommendation. Until the Owner rules, the repository stays as it is.

**OWNER DECISION 1. Delivery model, and the scope of v1.**
Options: (A) A delivery is only a Work Order (an `INSTALL` type reused); no handover record. (B) A delivery is a Work Order (the visit) that owns a delivery record (the handover: header and lines). (C) A delivery record that can be scheduled on its own.
**Recommend B.** A reuses install semantics for a visit that installs nothing and leaves the handover as free text. C creates a second scheduling authority beside Dispatch.
Scope: v1 covers sale deliveries only. Rental delivery and pickup, parts counter and will-call pickup, and customer returns are out until ruled. **Recommend confirm.**

**OWNER DECISION 2. How a delivery-only visit is told apart.**
Options: (A) New Work Order type `DELIVERY` (migration plus about twenty touch points; `serviceScopeForWorkOrderType` must map it to `INSTALLATION` in the same change). (B) Keep `INSTALL` and add a fulfillment-scope column on the Work Order.
**Recommend A.** B would offer the install closeout on a visit that installs nothing, and every consumer of `INSTALL` would need a second test.

**OWNER DECISION 3. Serialized units in a delivery-only visit.**
Options: (A) Not supported in v1; a serialized unit is delivered inside an `INSTALL` visit; delivery-only covers PART lines. (B) Add a `DELIVERED` serial state and a customer-site custody reference (ADR-010 section 3), changing serialized custody. (C) Mint Equipment at delivery.
**Recommend A for v1, B as a follow-up ruling.** B edits a protected inventory authority. C is rejected.

**OWNER DECISION 4. Picking.**
Options: (A) No pick-list object: the delivery Work Order is the demand; a pick is the existing bin pick plus warehouse -> truck transfers, made traceable by one additive Work Order link on the transfer; "picked" is derived. (B) A pick-list object with its own states. (C) No link.
**Recommend A.** B duplicates a status machine the Work Order already has. C leaves the truck's contents unanswerable.

**OWNER DECISION 5. Lifecycle, partial delivery and backorder.**
Options: (A) Facts, not states: the Work Order lifecycle is unchanged; the handover outcome is `DELIVERED_IN_FULL`, `DELIVERED_PARTIAL` or `NOT_DELIVERED`; backorder is derived; a further visit is a dispatcher-created Work Order. (B) A separate delivery status machine.
**Recommend A.** B would let two statuses disagree about one visit.

**OWNER DECISION 6. Does an acknowledgment gate billing or fulfillment?**
Options: (A) No. It is evidence only; fulfillment and billing triggers are unchanged (equipment by installation, parts by usage). (B) An advisory exception on the billing package that does not hold it. (C) A hard gate: no package until `ACCEPTED`.
**Recommend A.** DECISIONS #201 already rules that customer acceptance does not entitle. A hard gate would stall invoicing whenever the signer was not on site. F-1 should confirm; if it wants B, D-1 supplies the fact. The deliver-only equipment fulfillment question rides OD-3 B.

**OWNER DECISION 7. What an acknowledgment attaches to, and how many.**
Options: (A) One record on the Work Order per visit, with a `kind` (`DELIVERY`, `INSTALLATION`, `DELIVERY_AND_INSTALLATION`, later `SERVICE`). (B) Only on a delivery record. (C) Two signatures on a combined visit (delivery, then installation).
**Recommend A.** One signature covers what the visit did. B leaves install and service visits without evidence. C doubles the customer's signing for no new fact.

**OWNER DECISION 8. Outcomes and the evidence each requires.**
Confirm four outcomes (`ACCEPTED`, `ACCEPTED_WITH_EXCEPTIONS`, `REFUSED`, `NOT_OBTAINED`) as in section 6.4: acceptance always carries a signer name and a signature artifact; a refusal needs a reason; `NOT_OBTAINED` has a closed reason list and never reads as acceptance; a refusal reverses nothing automatically; an exception moves no stock and changes no shipped quantity.
**Recommend confirm.** The alternative, letting the technician attest acceptance without a signature, is the one outcome this design makes unrepresentable on purpose.

**OWNER DECISION 9. Capture rungs for the first build, and how the signature is stored.**
Options: (A) Rung 1 only (on-device signature, PNG at most 64 KiB, bytes and SHA-256 in PostgreSQL); rung 3 is `NOT_OBTAINED / PAPER_OUTSIDE_SYSTEM`; rung 2 later. (B) Rungs 1 and 2 together (rung 2: device-downsized JPEG at most about 800 KB). (C) Record only a hash and a reference, no image.
Also confirm the 2026-07-31 direction: in person only, no send-for-signature, no remote approver, no third-party e-sign.
**Recommend A, then B.** C cannot show the signature in a dispute.

**OWNER DECISION 10. The statement shown, the binding, and company variants.**
Options: (A) Owner and counsel supply the wording per company and kind; the build stores a version and the SHA-256 of the exact content shown; the server recomputes and refuses `CONTENT_CHANGED`; wording is selected by operating company. (B) A single generic statement.
**Recommend A.** Whether and how an on-device signature binds the customer is a legal question for counsel, not a repository choice. Appendix A is a draft for them to replace.

**OWNER DECISION 11. Does completion require an acknowledgment outcome?**
Options: (A) Never; it is optional. (B) For `DELIVERY` and `INSTALL` Work Orders, completion requires any recorded outcome, and `NOT_OBTAINED` with a reason satisfies it, so a missing signature never traps a job. (C) Completion requires `ACCEPTED`.
**Recommend B.** It forces the question to be answered on every handover without making a signature a precondition. It changes the completion edge and makes the acknowledgment a REQUIRED offline dependency of completion, which is why it needs a ruling.

**OWNER DECISION 12. Offline capture.**
Options: (A) A sixth technician intent in the closed list, synced before completion, device clock claim kept separate, identity derived from (type, work order, capture key). (B) Online only.
**Recommend A.** B fails exactly where it is needed.

**OWNER DECISION 13. Correction.**
Options: (A) Append-only; the assigned technician may record a later superseding record while the Work Order is not terminal; after `COMPLETED` there is no correction in v1. (B) An office correction after completion, which needs a new capability.
**Recommend A.** B is a new key and therefore a non-parity grant (STOP) until the Owner names the holders.

**OWNER DECISION 14. Read access and retention.**
Options: (A) Acknowledgment metadata is read through the existing Work Order detail authority under company isolation; the image bytes are a separate read under the same authority, never in a list; records are retained for the life of the Work Order and never deleted (the platform's no-delete rule). (B) A narrower read key for the image. (C) A fixed retention period.
**Recommend A.** B is a new key (STOP). C needs a period from counsel; Q35 (retention and evidentiary weight) was never answered, and the capture method is stored so the weight can be distinguished later.

**OWNER DECISION 15. Capabilities and grants. STOP item.**
Options: (A) No new key. Create a delivery Work Order under `workOrder.create`; the assigned Employee records the delivery record and acknowledgment under `workOrder.execution.record` + `RECORD_ASSIGNMENT` (labor's precedent), which widens that key's stated meaning; completion stays `workOrder.lifecycle.complete`. (B) New keys (for example an acknowledgment key and a delivery key) with named holders.
**Recommend A.** Firebase had no such key, so B has no parity set and every grant would be a non-parity grant needing an explicit Owner ruling on holders. A needs no grant row at all.

**OWNER DECISION 16. Title, and what counts as "successful delivery/acceptance".**
Options: (A) The acknowledgment is the evidence input for D-2; only `ACCEPTED` counts; `ACCEPTED_WITH_EXCEPTIONS` does not until the exceptions are resolved; D-1 builds no title axis. (B) `ACCEPTED_WITH_EXCEPTIONS` also counts. (C) Build a title axis in D-1.
**Recommend A.** It is the conservative reading of the ratified rule and keeps title a separate axis (INV-4). C is a separate ownership capability.

**OWNER DECISION 17. Warranty start and `installed_on` (interface with W-1).**
D-1 will not choose. It supplies two server-clock dates: the install event time and the acknowledgment time. Options for the warranty trigger: (A) the installation date for a unit Taylor installs, the acknowledged delivery date for a delivery-only unit. (B) The acknowledgment date always. (C) The later of the two.
**Recommend A, as W-1's default to confirm.** Confirm also that setting `installed_on` at install belongs to W-1 and that a device clock claim is never used.

**Not decided here, still open:** the amount, timing and policy of invoicing against a delivery (F-1); quote and discount approval (Q-1); the warranty object and its terms (W-1); the S1 reservation decisions this spec leans on (S1a OD-1 to OD-12); legal effect and wording of an electronic signature (counsel); production retention period (counsel); rental delivery and pickup; counter and will-call pickup; customer returns.

---

## 11. Non-goals and boundaries kept

No code, migration, capability, grant, role, Rules, schema or deployment is changed by this document. No Firebase or production system was read or written; every fact above comes from the repository at `b3d09dc3` and the cited evidence. The Firebase writers stay frozen. Picking and staging still reserve nothing. No title, warranty or billing behavior changes.

---

## Appendix A. Draft statement (for Owner and counsel to replace)

Not approved text. It exists so the binding mechanism (a versioned statement hashed with the content shown) has something concrete to point at.

> **Delivery acknowledgment, version DRAFT-0.** I confirm that the items listed on this screen were delivered to this address on the date shown. I am authorised to accept delivery for the customer named. Any shortage, damage or error is noted against the item. Signing records receipt; it does not by itself waive any right.

A kind of `INSTALLATION` or `DELIVERY_AND_INSTALLATION` adds a clause that the equipment was installed and shown operating. The final wording, its variants for the two operating companies, and whether any of it is binding on the customer's business are for the Owner and counsel.
