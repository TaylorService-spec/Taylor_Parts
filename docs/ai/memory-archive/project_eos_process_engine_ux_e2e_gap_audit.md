<!-- ARCHIVED AI WORKING NOTES — NOT AUTHORITY -->
> **Historical AI working notes**, moved out of Claude's private memory on 2026-08-16 so they are
> visible and auditable in the repository. **This file is not authoritative.** The authoritative
> record for this workstream is the linked `docs/` specification, DECISIONS entry, or PR history.
> Retained verbatim so nothing is lost; do not cite it as a decision of record.

---
name: project_eos_process_engine_ux_e2e_gap_audit
description: "Full analysis-only audit spec (PROCESS/ENGINE/UX/E2E across Sales, WO, Inventory, Billing, Ventana) — queued as Wave 5 item 5, NOT started"
metadata:
  node_type: memory
  type: project
  originSessionId: 9589897a-9e7f-4a2b-b9d0-a68877d3df6f
  modified: 2026-08-15T00:10:15.002Z
---

Queued into [[project_card_composition_standardization]] Wave 5 as item 5 (2026-08-14, verbatim from Owner). **Analysis-only — read/report, zero code/doc/branch/PR/deploy/data/Rules/grant changes.** Not started.

Full audit prompt, preserved verbatim for exact re-invocation when authorized:

---

TAYLOR EOS — PROCESS / ENGINE / UX / E2E GAP AUDIT
Repository: `TaylorService-spec/Taylor_Parts`

ROLE: Act as the repository implementation auditor. Analysis-only. DO NOT: modify code; modify documentation; create branches or PRs; deploy anything; write Firebase data; change Rules, grants, roles, or credentials; assume a documented process is implemented; assume backend code means usable UX; assume a UI component means the workflow is operational.

Objective: determine exactly how much of the currently designed Enterprise Operations OS lifecycle is (1) PROCESS DEFINED, (2) ENGINE BUILT, (3) UX BUILT, (4) E2E COMPLETE, and identify the smallest remaining gaps.

**1. SYNC AND AUTHORITY** — Start from current `origin/main`. Record current SHA, audit date, relevant newer roadmap/status artifacts. Treat repository evidence as authoritative. At minimum read and reconcile: `docs/roadmaps/sales-to-cash-lifecycle-build-plan.md`, `docs/roadmaps/roadmap-reconciliation-2026-07.md`, `docs/roadmaps/business-capability-register.md`, `docs/architecture/SYSTEM_AUTHORITIES.md`, `docs/specifications/sales-to-cash-to-commission-lifecycle.md`, `docs/specifications/enterprise-inventory-architecture.md`, `docs/business-processes/ventana-ice-machine-commercial-inventory-lifecycle.md`, `docs/specifications/ventana-ice-machine-lifecycle-responsibility-model.md`, `docs/business-processes/cross-franchise-equipment-receiving-installation.md`, `docs/reviews/w1-line-of-business-execution.md`, plus relevant implementation plans, ADRs, tests, routes, React modules, Functions, domain modules, and Firestore authority. Do not use superseded roadmap material as current status when newer authority exists.

**2. AUDIT MODEL** — Four layers classified independently per capability:
- PROCESS DEFINED: COMPLETE / PARTIAL / UNDEFINED (business process/rules sufficiently defined to implement without inventing material business policy)
- ENGINE BUILT: BUILT / PARTIAL / NOT BUILT (governed backend/domain implementation — Cloud Functions, commands, lifecycle/state machines, domain modules, Firestore persistence, authoritative linking, ledger behavior, validation, tests)
- UX BUILT: BUILT / PARTIAL / NOT BUILT (a normal authorized persona can actually perform or inspect the capability through the app — route exists, nav exists, component exists, data wired, action invokes authoritative command, persona can reach it, results rendered honestly)
- E2E COMPLETE: COMPLETE / PARTIAL / NOT COMPLETE / BLOCKED (process+engine+UX+persistence+authoritative linkage form a usable lifecycle; unit tests alone never qualify as E2E complete)

**3. LIFECYCLES TO AUDIT**:
- **A. SALES/COMMERCIAL** (16 items): Account/customer; Opportunity creation; Opportunity progression; WON Opportunity; explicit WON→Sales Order creation; Opportunity↔Sales Order lineage; Sales Order pricing; Sales Order lifecycle; allocation; partial allocation; Sales Order→service creation; commercial seller attribution; `operatingCompanyId`; Account `lineOfBusiness[]`; salesperson/ownership attribution; cross-company commercial attribution.
- **B. WORK ORDER/FIELD SERVICE** (20 items): WO creation; SO→WO relationship; parts planning; readiness; scheduling; rescheduling; dispatch; technician eligibility; technician assignment; technician acceptance; travel; arrival; execution; actual parts recording; additional-part/overage exception; completion; cancellation; completion→SO fulfillment; partial fulfillment; customer/service history.
- **C. INVENTORY/MATERIALS** (27 items): parts master; warehouse stock; reorder request; purchasing; PO; full receiving; partial receiving; reservation; reservation release; actual consumption; inventory ledger; warehouse→warehouse transfer; warehouse→truck transfer; truck inventory; truck inventory consumption; expected-vs-scanned reconciliation; cycle count; discrepancy persistence; damaged inventory; scrap/adjustment; unused-part return; RMA; serialized asset receiving; serialized custody; serialized location; serialized installation; Equipment creation/linkage. Explicitly do NOT collapse WO parts planning / reservations / physical stock / consumption / reconciliation observations / ledger effects into one "inventory" capability — audit each independently.
- **D. BILLING/FINANCE** (15 items): fulfillment→billing eligibility; billing-action producer; invoice issuance; invoice lineage to SO; `fulfilledQty`; `billedQty`; conservation between fulfillment and billing; unpaid invoice; partial payment; full payment; payment command; AR state; payment reconciliation; operating-company attribution on invoice/payment; customer/account reporting. Commission stays separate unless actual governed implementation exists.

**4. VENTANA DEEP AUDIT (required, own section)** — Ventana = Taylor's upstream ice-machine supplier, NOT Taylor↔Taylor cross-franchise. 27 independent steps: customer demand→Taylor commercial sale→Taylor purchase from Ventana→Ventana supplier attribution→receipt into Taylor control→serial capture→Taylor title after purchase/receipt→inventory-control BEGIN→availability→allocation→staging→loading→transit→delivery→customer acceptance→customer title→installation→Equipment linkage→service responsibility→warranty responsibility→billing responsibility→sale-close evidence→inventory-control EXIT→drop-ship→cancellation→damage/disposition→multi-machine coordinated installation. For every step: PROCESS/ENGINE/UX/E2E, plus which authority carries each independent axis (inventory control; ownership/title; custody; availability; commercial seller; fulfillment responsibility; installation responsibility; service responsibility; warranty responsibility; billing responsibility).
- **D-5**: treat sale-close criteria as load-bearing — determine current status of `SALE_CLOSE_CRITERIA_RATIFIED`, `saleCloseAuthoritative`, Sales Order `FULFILLED→CLOSED`, P3.2 from the Sales→Cash build plan. Do not claim the Ventana lifecycle reaches authoritative inventory-control `EXITED` unless code actually proves it.

**5. TAYLOR↔TAYLOR CROSS-FRANCHISE** (separate from Ventana) — determine what exists for: commercial seller; book-of-record operating company; fulfiller; inventory controller; installation responsibility; service responsibility; billing responsibility; equipment ownership; custody/location. Report where architecture supports independent responsibility axes but UX doesn't yet expose them.

**6. PERSONA/ROUTE AUDIT** — for each operational capability: intended persona; actual governed role; application route; nav entry; read capability; write/action capability. Minimum personas: Owner, Admin, Dispatcher, Technician, Warehouse/Parts, Salesperson, Controller/Finance, Shop/Service Manager. A persona described in process docs with no governed role/usable route = UX classified NOT BUILT.

**7. MASTER MATRIX** — one consolidated table: `| Domain | Capability | Process | Engine | UX | E2E | Authority | Route/UI | Persona | Missing Gap | Evidence |`. Every status cites concrete repo evidence (file/module/Function/test/route/spec/roadmap item). No unsupported status assertions.

**8. GAP-TYPE CLASSIFICATION** — for every PARTIAL/NOT BUILT item, exactly one primary category: UX-ONLY (engine/authority exists, missing piece is usable app UX) / WIRING (engine+UI exist, not connected) / BACKEND (authoritative command/persistence/lifecycle logic absent) / BUSINESS-RULE (blocked by unresolved Owner/business policy) / ACTIVATION (built but grants/deployment/capability activation remain) / DATA (capability exists but usable reference/scenario data missing) / E2E-VERIFICATION (everything appears present but unproven through the complete lifecycle). Goal: surface functionality already built underneath EOS but not properly exposed in UX.

**9. UX-BACKLOG VIEW** — separate list: every capability where ENGINE=BUILT and UX=PARTIAL/NOT BUILT. For each: existing engine authority; missing screen/action; likely existing page it belongs on; personas needing it; whether adding UX requires schema/backend changes. Do NOT design the UX yet — candidate backlog only.

**10. TRUE-BUILD BACKLOG** — PROCESS DEFINED / ENGINE MISSING: genuine software builds, not cosmetic UX. Include required authority; dependencies; whether an existing domain can own it; whether already represented by a roadmap item.

**11. BLOCKED BUSINESS-DECISION LIST** — OWNER/BUSINESS RULE REQUIRED. Do not invent answers. Include especially Ventana D-5 if still unresolved.

**12. SANDBOX READINESS** — classify each major domain: READY FOR SANDBOX DATA / READY AFTER UX / READY AFTER ACTIVATION / READY AFTER E2E VERIFICATION / BLOCKED BY ENGINE / BLOCKED BY BUSINESS RULE. Directly supports the separate Sandbox Scenario Data initiative.

**13. EXECUTIVE SUMMARY** — answer: (1) how much of EOS's defined process is already implemented underneath the site; (2) what major functionality is primarily waiting for UX; (3) what genuinely still needs backend/domain implementation; (4) what is merely waiting for activation/deployment/data; (5) what remains blocked by business decisions; (6) how complete is Sales→Cash; (7) how complete is Inventory; (8) how complete is Field Service; (9) how complete is the Ventana lifecycle; (10) the 10 highest-value gaps to close next, ranked by how much existing functionality they unlock. No invented percentage-complete numbers unless transparently calculated from the matrix (`completed cells / applicable cells` per Process/Engine/UX/E2E separately, if shown).

**STOP CONDITION**: analysis only, do not implement any gaps. Return the completed audit for Owner/ChatGPT review.

---

See [[project_card_composition_standardization]], [[project_sales_to_cash_runway]], [[project_business_capability_register]], [[project_ventana_ice_machine_lifecycle]], [[project_ux_journey_program_state]] for the durable authorities this audit will read against.
