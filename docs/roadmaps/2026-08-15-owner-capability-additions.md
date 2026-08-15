# Owner Roadmap Capability Additions — 2026-08-15

**Status:** Owner-approved roadmap preservation. `IDENTIFIED` unless stated otherwise.

This artifact records business/product capabilities identified during the 2026-08-15 Product/Design session so they are not lost before the next canonical roadmap/register projection reconciliation.

It follows the Business Capability Roadmap / Coverage Register rule: **record the need, preserve seams, do not treat identification as implementation authorization.** Nothing in this document authorizes Firestore schema creation, Rules changes, deployment, hardware purchasing, or a new canonical authority.

The generated `docs/orchestration/roadmap/ROADMAP.md` remains a read-only projection and must not be hand-edited.

---

## 16. Warehouse Location, Container & Scan Movement Control

- **Current maturity:** `IDENTIFIED`.
- **Business problem:** EOS needs the full physical warehouse-control layer around ordinary Parts and Equipment so users can find, receive, put away, pick, stage, kit, transfer, load, return, and reconcile inventory without creating parallel stock truths. The scan-first workflow is a day-one operating requirement, not merely a barcode lookup screen.
- **Primary domains:** Inventory, Warehouse, Receiving, Parts, Equipment, Work Orders, Trucks/Dispatch.
- **Known canonical authorities to reuse:** Part Master; Receiving; `inventory_transactions` / governed inventory movement authority; `warehouses` / `stock_locations`; Work Order Parts Planning; Truck Registry / truck inventory integration; Serialized Asset Registry for individually tracked units.
- **Scope to preserve:**
  - physical location hierarchy: warehouse → zone → aisle → rack → shelf/bin (exact persistence shape to be assessed, not invented here);
  - staging / quarantine / repair / shipping / truck-loading locations where governed;
  - containers such as totes, pallets, cages, carts, kits, and LPN-style movable units;
  - container membership and containerized movement so a controlled group can move without rescanning every low-value item;
  - scan-first workflows for receive, put-away, pick, stage, transfer, truck load/unload, WO issue/consume/install, return, and reconciliation;
  - part + source/destination scan patterns that minimize typing and make incorrect movement difficult;
  - support for serialized and non-serialized inventory without collapsing their identities;
  - offline/retry/idempotency behavior appropriate to scanner/mobile operation;
  - reconciliation/exception behavior when physical evidence and expected state disagree.
- **Hard authority rule:** Scanner/UI actions express **movement intent**. They must invoke the same trusted movement/Receiving/WO authorities as other EOS surfaces; the scanner must not directly maintain independent quantity/location truth.
- **Non-goals at identification:** no second inventory ledger; no second Receiving path; no speculative universal warehouse schema; no assumption that every low-value Part receives an individual RFID identity.
- **Dependencies:** current inventory movement architecture; Receiving maturity; Truck Inventory integration; Serialized Asset foundation; WO Parts Planning/readiness.
- **Roadmap trigger:** Revisit as the current Serialized Asset/Receiving wave completes and before Truck Inventory integration or warehouse scan UX is considered operationally complete.

---

## 17. Serialized Asset Location, Observation & Reusable Tracking

- **Current maturity:** `IDENTIFIED`.
- **Business problem:** High-value Equipment is frequently moved within warehouse/field operations and can take substantial employee time to locate. EOS needs to answer **where the asset is expected to be, where it was last physically observed, who/what currently has custody, and how to find it**, through delivery and other governed custody states.
- **Primary domains:** Serialized Assets/Equipment, Inventory, Warehouse, Trucks/Fleet, Dispatch, Sales Order fulfillment, Delivery/Custody, Service.
- **Known canonical authorities to reuse:** Serialized Asset Registry / Equipment identity; governed inventory movement/ledger; Truck Registry; truck GPS/location source where connected; Account/Customer Location; Sales Order / Work Order lineage. **Do not create a second Equipment or movement authority.**
- **Core governance rule:** **Physical observation is evidence, not inventory authority.** A reader/tag observation must not silently rewrite governed inventory/custody truth. High-confidence automation may later initiate the same governed movement command under explicit policy.
- **Hardware-neutral observation scope:**
  - barcode/QR scan observations;
  - passive UHF RFID / ISO 18000-6C observations;
  - IR/beam/presence evidence for physical crossing and direction;
  - BLE / AirTag-like enterprise tracking;
  - UWB for precise local `Find Equipment` experiences;
  - truck-derived location while an asset is actively associated with a GPS-tracked truck/container;
  - selective GPS/cellular trackers for the highest-value/risk assets.
- **Operational experiences to preserve:**
  - `Expected Location` vs `Last Observed` vs `Derived Location` vs direct tracker location;
  - `Last Seen` timestamp, zone/device/source, confidence, and observation history;
  - expected-vs-observed mismatch / unknown-location attention;
  - `Find Equipment` workflow, initially zone/last-seen based and later capable of BLE/UWB proximity guidance;
  - warehouse/staging/loading/delivery observation chain;
  - transit tracking through truck association without requiring a cellular tracker on every asset.

### Reusable Tracking Device Management

Enhanced trackers are **reusable operational assets**, not the permanent identity of customer Equipment.

Preserve the need for:
- Tracking Device Registry independent from Serialized Asset identity;
- technology/type (`UHF_RFID`, `BLE`, `UWB`, combined, `GPS_CELLULAR`, etc.) without coupling EOS to one vendor;
- permanent device/hardware identifier;
- `AVAILABLE`, deployed/assigned, recovery/return, maintenance/charge, damaged, lost and retired lifecycle concepts (exact enum deferred to assessment);
- temporary asset ↔ tracker assignment with history;
- scan-to-bind and scan-to-release;
- delivery recovery control — tracker may be removed at customer delivery, placed in truck custody, returned to warehouse, checked/charged and reused;
- explicit exception when a required tracker is not recovered;
- battery/health telemetry where hardware exposes it;
- hardware observations resolved through the active tracker↔asset assignment rather than making the tracker the asset identity.

- **Economic/product principle:** ordinary low-value Parts remain primarily barcode/bin/container controlled; more capable reusable trackers are deployed selectively based on Equipment value/risk/operating need.
- **Dependencies:** Serialized Asset Registry; Warehouse Location/Container control (#16); governed Transfer/delivery authority; Truck Inventory / Truck Registry; future GPS/fleet integration.
- **Roadmap trigger:** Formally assess after Serialized Asset identity + location/movement controls are mature enough that observations can attach to an existing authority without inventing parallel state.
- **Hardware sequencing principle:** establish the EOS observation/event contract before selecting a specific RFID/BLE/UWB/GPS vendor. Pilot one controlled warehouse/equipment zone before broad rollout.

---

## 18. Optional Commercial Marketing Module + Marketing Integration Contract

- **Current maturity:** `IDENTIFIED`.
- **Business problem:** EOS CRM needs marketing context, audience/campaign relationships and attribution, but Marketing must be **detachable/licensable** because some customers will buy native EOS Marketing while others already use external marketing/sales-enablement platforms.
- **Primary domains:** Marketing, CRM/Sales, Accounts, Contacts, Opportunities, Sales Orders, Reporting/Analytics, Integrations.
- **Core modularity rule:** Core Accounts, Contacts, Opportunities and Sales Orders **must not depend on the native EOS Marketing module**.
- **Supported product modes:**
  1. native EOS Marketing licensed/enabled;
  2. external marketing/enablement provider connected;
  3. no marketing capability — marketing surfaces disappear cleanly without breaking core CRM.
- **Integration-contract-first principle:** define a provider-neutral Marketing Context / Integration Contract before building the native module. Native EOS Marketing becomes one provider implementation of the same contract used by external adapters.
- **Provider capability model:** adapters may support different capabilities (campaign membership, engagement, content activity, attribution, audiences, etc.); do not force platforms with different purposes into one false common behavior.
- **Native module scope to preserve:**
  - campaigns / initiatives;
  - campaign membership for Accounts and Contacts;
  - member/engagement state and activity history;
  - governed segmentation/audience definitions;
  - campaign → Account/Contact → Opportunity → Sales Order → revenue attribution;
  - account/contact CRM marketing panels through the provider-neutral contract;
  - permissions/audit and operating-company boundaries;
  - reporting/effectiveness;
  - later next-best audience/action intelligence.
- **Initial non-goals:** no requirement to build mass email/SMS delivery infrastructure; no vendor-specific fields in core Account/Contact records; no duplicate marketing authority when an external provider remains authoritative.
- **Commercial packaging:** native EOS Marketing is a separately enableable/priced module; external integrations may be packaged independently without requiring the native module.
- **Dependencies:** CRM Account/Contact foundation; Opportunity and Sales Order lineage; integration architecture; future module/configuration packaging model.
- **Roadmap trigger:** Before implementing marketing fields directly in Account/Contact UX, or when the Customer Workspace redesign reaches Marketing context/association work.

---

# Related CRM / Sales UX roadmap deltas

These are **UX/product convergence items over existing authorities**, not new canonical business authorities.

## Customer / Account Workspace convergence

Preserve the redesign direction:
- compact Account/Customer header + primary actions;
- customer health strip for pipeline, order backlog, AR/past-due, and service state using authoritative projections;
- two-column operational composition rather than a long database-record stack;
- Commercial / Sales Order / Service & Equipment sections;
- consolidated Accounts Receivable presentation rather than repeated disconnected financial sections;
- Account Attention projection/panel using existing domain authorities;
- eliminate repeated `source not connected` empty-state blocks — one honest provider/source state, or hide optional surfaces;
- Marketing panel consumes capability #18 contract and disappears cleanly when no provider exists.

## Salesperson Activity, Notes & Follow-up

Preserve a true attributed activity/history model rather than a single overwritable `notes` field:
- timestamped + attributed notes;
- note/activity types such as meeting, call, sales note, relationship note, general note;
- optional association with Account, Contact, Opportunity, Sales Order, or other governed CRM object;
- next-action/follow-up with due date rather than leaving commitments buried in prose;
- audit/history retained.

Persistence/authority is **not ratified by this roadmap note**; assess against any existing Activity authority before implementation.

## Opportunity Create operational activation

Current Opportunity architecture already contains governed commands/readiness seams. `New Opportunity` in the deployed sandbox baseline must not be treated as a request for a second Opportunity backend.

When raised:
- inspect current `main` first;
- wire/activate the existing governed create authority;
- enforce capability/readiness honestly;
- connect Account/Contact context correctly;
- test authorized/denied/error/idempotency behavior;
- navigate/refresh to persisted state;
- hide/disable honestly if authority is unavailable rather than presenting an apparently live inert control.

## Opportunity Stage Chevron / Governed Progression UX

Preserve a persistent lifecycle path such as `New → Qualification → Discovery → Proposal → Negotiation → Closed Won / Closed Lost` using the **existing Opportunity lifecycle/transition authority**.

- completed/current/future stages visually distinct;
- Won/Lost branch rather than sequential falsehood;
- clicking a valid transition invokes the governed transition command, never a direct field write;
- invalid transitions unavailable;
- preserve stage history/evidence (`enteredAt`, `exitedAt`, actor/context as the eventual authority permits) for stage aging, sales-cycle velocity and stalled-opportunity analysis;
- later stage-specific next-best-action/prerequisite guidance may consume the same lifecycle state.

---

# Explicitly NOT authorized by this roadmap addition

The current Serialized Asset workstream still has two separate boundaries that this document does **not** resolve:

1. **Enterprise Inventory Phase 4 / Transfer Orders** — still the prerequisite for governed customer delivery and the serialized-asset §H installation handoff. No direct CUSTOMER relocation or substitute transfer authority is authorized here.
2. **Serialized Asset location-shape reconciliation** — the specification's scalar `currentLocationId` versus the merged Available Equipment composer input `{ type, locationId }` remains a spec-author/design decision. Do not fabricate `type` merely to unblock UI.

Likewise, this document does not authorize implementation of RFID/BLE/UWB hardware integrations or EOS Marketing merely because their business capabilities are now preserved.

---

## Projection / register reconciliation instruction

At the next canonical roadmap projection reconciliation:
- fold sections 16–18 into `docs/roadmaps/business-capability-register.md` as `IDENTIFIED` entries without changing their maturity;
- add the corresponding identified-future capabilities to the machine-readable roadmap model if that projection intentionally includes the broader register;
- carry the CRM/Sales UX deltas into the appropriate UX/Commercial roadmap workstream without creating duplicate authorities;
- preserve the Transfer Order and location-shape boundaries above.
