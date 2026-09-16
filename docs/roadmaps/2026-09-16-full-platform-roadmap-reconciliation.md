# EOS Full Platform Roadmap Reconciliation — 2026-09-16

**Status:** CURRENT PROGRAM ROADMAP / RECONCILIATION  
**Owner:** Rudy DiGiorgio  
**Repository baseline:** `origin/main @ d3ecd534395de29b346f5159fad9809cb54423aa` (2026-09-16)  
**Reconciles:** business objects, end-to-end business processes, platform foundations, PostgreSQL cutover, Firebase exit, Administration, application delivery, active/open work, and future capability register.  

> This document is the current program-level answer to **where EOS is, what has been completed, what remains, and what must be retired**. Older roadmap snapshots remain historical evidence but must not be used as current implementation status when they disagree with this reconciliation or later repository evidence.

---

## 1. Why this reconciliation exists

EOS has accumulated strong domain work, but program status has become difficult to read because several different states have repeatedly been called “done”:

1. a concept was designed;
2. code or a schema was built;
3. a PostgreSQL target was added;
4. migration/cutover tooling was added;
5. the migration was actually run;
6. runtime reads/writes were actually cut over;
7. the old Firebase path was retired;
8. the running application was accepted by the Owner;
9. user training/operational closeout was completed.

Those are not the same state.

This reconciliation therefore treats **implementation, cutover, acceptance, and retirement separately** and inventories the platform from business-object and business-process perspectives.

The immediate architecture correction ordered by the Owner on 2026-09-16 is also incorporated: the current identity/access/roles/permissions implementation is to be replaced by **Authorization v2**, and the target platform state is **zero Firebase dependency**.

---

## 2. Status vocabulary

| Status | Meaning |
|---|---|
| **COMPLETE** | Current target architecture is implemented, governed, exercised end-to-end, and no known replacement/cutover work remains for the scoped capability. |
| **OPERATIONAL / PARTIAL** | A useful governed capability works today, but material workflow, authority, exception, migration, or platform work remains. |
| **BUILT / NOT CUT OVER** | Target code/schema/tooling exists, but runtime authority/data has not fully moved to it. |
| **DESIGNED / NOT BUILT** | Architecture or accepted decisions exist, but the operational capability is not implemented. |
| **LEGACY / RETIRE** | Existing implementation remains reachable or retained but conflicts with the target architecture and must be removed after replacement. |
| **BLOCKED / HELD** | Work intentionally cannot progress until a named dependency or Owner gate is satisfied. |
| **FUTURE** | Known business capability preserved in the roadmap but not part of the immediate convergence program. |

### Completion percentage

Percentages in this document are **roadmap completion estimates**, not test coverage, certification scores, or promises. For an operational object, the default rubric is:

- 10% — business meaning / lifecycle defined
- 15% — canonical authority / schema established
- 15% — PostgreSQL target/persistence established where required
- 15% — governed reads
- 15% — governed writes / commands
- 10% — usable application experience
- 10% — end-to-end workflow + exception handling
- 5% — migration/cutover from superseded authority
- 5% — acceptance/training/legacy retirement

For a business process, the equivalent dimensions are discovery, object/authority coverage, happy path, exception path, authorization, UI, data cutover, end-to-end proof, observability/audit, and training/operational acceptance.

A high percentage does **not** mean “do not touch again”; it means most of the currently defined target is present.

---

# 3. Executive platform state

## 3.1 What is materially complete or strong

EOS is not an empty prototype. The repository contains mature governed foundations for major parts of the operating business:

- Customer/CRM concepts and UI foundations.
- Opportunity, Sales Agreement, and Sales Order commercial models and governed server-side work.
- Parts/catalog, supplier, warehouse, bin, truck/mobile-location, inventory, purchasing, receiving, transfers, and cycle-count foundations.
- Equipment/serialized-asset and custody foundations.
- Work Order lifecycle, scheduling, dispatch, technician execution, inventory-demand/parts-readiness, and audit foundations.
- Reporting/financial authority work, North Star presentation work, dashboards, and performance-goal foundations.
- Employee/Principal separation and substantial PostgreSQL Workforce runtime work.
- PostgreSQL policy/tenant/identity/capability infrastructure.
- Vercel web delivery and Render API infrastructure.
- Governed data-import architecture.
- Email Connections / Inbound Work capability in sandbox/accepted program history.
- Strong repository governance, audit evidence, test gates, environment fencing, and migration/cutover tooling.

## 3.2 What is not complete

The platform is still split across generations of architecture:

- Firebase Auth remains part of the current login/identity chain.
- Firestore and Firebase-era authority still own or materially participate in several operational domains.
- Some PostgreSQL migrations/cutover tools are merged but **not run**.
- Some domains have PostgreSQL read authority but no governed PostgreSQL writer.
- Work Order assignment has no PostgreSQL authority yet; the current authority remains tied to the Firestore Work Order transaction/lifecycle.
- Employee Job Role and several employee/work-assignment relationships are not yet first-class governed PostgreSQL authorities.
- The current permission model contains valuable capability/policy work but has accumulated compatibility layers and inconsistent interpretation. It is being superseded by the Owner-directed Authorization v2 convergence rather than patched indefinitely.
- The application is responsive web software today, not yet a finished installable/multi-client EOS application family.
- Financial completion, AR/payment, commissions, service contracts/PM, returns/RMA, territory/coverage, labor/time/payroll, and several cross-company processes remain incomplete or future.

## 3.3 Current top-level completion estimate

| Program area | Est. complete | Current state |
|---|---:|---|
| Core business-domain modeling | **85%** | Strong object/lifecycle coverage; several future authorities remain. |
| Operational workflows | **72%** | Service + inventory/purchasing are strongest; finance and cross-company completion lag. |
| PostgreSQL platform foundation | **80%** | Tenant/identity/policy/ops/catalog/workforce/commercial foundations exist. |
| PostgreSQL runtime cutover | **55%** | Employee reads and multiple target authorities exist; several migrations not run and operational domains remain Firebase-era. |
| Identity + Authorization | **45%** | Significant policy/Principal/Role groundwork exists, but Owner has ordered end-to-end v2 convergence and Firebase exit. |
| Administration / tenant self-service | **50%** | Meaningful Admin surfaces exist; target self-service control plane is incomplete. |
| Reporting / Financial insight | **68%** | Strong authority/read work; full financial transaction lifecycle is incomplete. |
| North Star / UI presentation | **80%** | Broad visual/design progress; some open/stale PR cleanup and remaining page migrations. |
| Application/mobile readiness | **45%** | Responsive web foundation exists; PWA/native/mobile client architecture not finished. |
| Zero-Firebase target | **35%** | Direction and several cutovers exist; Auth/Firestore/Functions-era dependencies remain. |
| Overall EOS platform toward current target | **~67%** | Substantial product exists; remaining work is increasingly convergence/cutover rather than greenfield basics. |

---

# 4. Platform foundation roadmap

| Foundation | Current authority/state | Done | Remaining | Est. |
|---|---|---|---|---:|
| **Vercel web delivery** | Vercel | Web application delivery is operational; production integration exists. | Harden enterprise deployment controls as client requirements demand; PWA/app packaging later. | 85% |
| **Render API/backend** | Render `eos-api-*` path | API/runtime foundation, PostgreSQL-facing services, policy/workforce services exist. | Move every protected business operation behind the EOS API boundary; remove Firebase Functions/runtime dependence. | 75% |
| **PostgreSQL** | EOS DB schemas/migrations | Tenant, policy, identity, operational, warehouse/bin/truck, supplier/catalog, employee and other authority migrations exist. | Complete remaining domain authorities and execute controlled cutovers/migrations. | 80% |
| **Firebase Auth** | Current external credential verifier in parts of runtime | Existing users can authenticate; known identity mapping exists. | Replace with EOS-owned session model + OIDC identity bindings; retire Firebase Auth dependency. | LEGACY / 35% exit |
| **Firestore business data** | Mixed current authority | Large body of proven historical workflows/data exists; numerous migration tools and target PG schemas exist. | Finish object-by-object cutover; prove no business read/write authority remains; retire Firestore business-data dependency. | LEGACY / 45% exit |
| **Firebase Functions** | Mixed legacy operational substrate | Many trusted commands/lifecycles proven historically. | Port required commands to EOS/Render service boundaries and retire Firebase callable dependency. | LEGACY / 40% exit |
| **Identity** | Principal/Membership + external subject; Firebase still proves current identity | Principal, tenant membership, Employee linkage foundations exist. | Authorization v2 identity binding, Microsoft/Google OIDC, EOS sessions/revocation, zero Firebase. | 55% |
| **Authorization** | Existing Admin Policy/capability architecture + compatibility layers | Valuable role/capability catalogs, audit, effective-access concepts, scope work and tests exist. | Replace/converge under Authorization v2; one evaluator; object/action/scope/field/workflow model; retire compatibility/parallel role systems. | 45% |
| **Audit** | Multiple governed audit systems | Strong immutable/auditable command patterns across major workflows. | Converge audit vocabulary/storage where duplicated; ensure Authorization v2/session/admin changes use one durable audit contract. | 75% |
| **Environment/deployment governance** | Repo + Vercel/Render pipelines | Strong fences, provenance checks, nonprod separation. | Reconcile stale Firebase deployment docs/tools and remove obsolete environment machinery with Firebase exit. | 80% |
| **App/client architecture** | Vite responsive web | Broad responsive app, North Star system, role-specific views. | Make client explicitly API-only; PWA/installability; mobile/device capability layer; later iOS/Android/desktop clients as justified. | 45% |

---

# 5. Authorization v2 — foundation reset

This is an **immediate foundational workstream** and supersedes further incremental patching of the current permissions model.

## 5.1 Permanent separation

### Identity

`External Identity -> EOS Principal -> Employee`

### Authorization

`Principal -> Security Role(s) -> Permissions`

### Business responsibility

`Record -> Owner / Accountable / Assignee / Approver / Operating Company`

The three models may reference one another, but must never be collapsed.

## 5.2 Non-negotiable rules

1. Employee is not Principal/User Access.
2. Job Role is not Security Role.
3. Security Roles contain permissions.
4. Owner is not Accountable is not Assignee.
5. Record responsibility does not silently create security authority.
6. Permission evaluation supports Resource + Action + Scope + Field Access, with explicit workflow capabilities where CRUD is insufficient.
7. One server-side EOS authorization service is authoritative for every client and domain.
8. UI visibility is user experience, never the security boundary.
9. Vercel owns presentation/delivery, not EOS authority.
10. Render/EOS validates sessions and authorization and enforces business commands.
11. PostgreSQL stores the durable identity, authorization, responsibility, session, and audit facts.
12. External IdPs prove identity only.
13. No new Firebase dependency is permitted.
14. Target state is zero Firebase dependency.
15. Authorization v2 must work unchanged for web, PWA, desktop, iOS, and Android clients.

## 5.3 Authorization v2 delivery sequence

| Phase | Deliverable | Completion gate |
|---|---|---|
| A | Current authority census + freeze | Every current identity/role/capability/scope/user/record-ownership source inventoried; no new parallel permission mechanism. |
| B | PostgreSQL v2 model | Principals, identities, Security Roles, permissions, role assignments, overrides, sessions/revocation, audit contracts established. |
| C | EOS identity gateway | Microsoft/Google OIDC binding to Principal; EOS creates/validates/revokes sessions; Firebase not required. |
| D | Central authorization evaluator | One deterministic `authorize()` path covers object/action/scope/fields/workflow capability. |
| E | Administration UI | Employees, Users & Access, Security Roles, effective access, overrides, sessions and audit are understandable and configurable. |
| F | Domain authority census/cutover | Every route, endpoint, button, field, export, report, workflow action and sensitive read maps to v2 authority. |
| G | Persona acceptance matrix | Admin, Retail Sales, National Accounts Sales, Service, Parts/Warehouse, Accounting etc. produce deterministic expected/actual access. |
| H | Firebase removal | Firebase Auth/Firestore/Functions-era authorization/access dependencies removed and repository/runtime scans prove zero dependency. |
| I | Training / closure | Administrator + end-user training updated; Owner accepts running experience. |

---

# 6. Business object inventory

## 6.1 Workforce, identity, access, organization

| Object / authority | Current state | What is done | What remains | Est. |
|---|---|---|---|---:|
| **Employee** | OPERATIONAL / PARTIAL | PostgreSQL Workforce authority and runtime reads; Admin Users directory and Employee profile now read governed PG Employee IDs; reporting relationships exist. | Governed Employee create/update writer; full lifecycle/status changes; Job Role authority; assignments; complete data cutover/legacy retirement. | 75% |
| **Principal** | OPERATIONAL / PARTIAL | PostgreSQL Principal + membership foundation and Employee link model exist; synthetic/nonprod login chain proven. | Authorization v2 identity model cleanup; external OIDC bindings; Firebase subject/provider retirement. | 75% |
| **External Identity / Credential** | LEGACY + TARGET PARTIAL | External-subject mapping concepts and credential administration exist. | Microsoft/Google OIDC; EOS session authority; retire Firebase Auth as required identity provider. | 45% |
| **Tenant Membership** | OPERATIONAL / PARTIAL | Tenant membership and governed Principal relationships exist. | Reconcile with Authorization v2 Role assignment/session semantics and multi-client access administration. | 75% |
| **Security Role** | PARTIAL / SUPERSEDED FOR CONVERGENCE | Existing governed business roles, compatibility roles, Role catalog and tests. | Rebuild/converge into one v2 Security Role model; eliminate compatibility ambiguity and role-vocabulary gaps. | 45% |
| **Permission / Capability** | PARTIAL / SUPERSEDED FOR CONVERGENCE | Large capability catalog, policy assignments, scope work and command gates exist. | Resource/action/scope/field model + explicit workflow capability contract; one effective evaluator; full registered vocabulary; no parallel capability resolvers. | 50% |
| **Principal Permission Override** | TARGET | Concept required for admin exceptions. | Implement governed add/remove override, reason/effective period/audit, effective-access explanation. | 10% |
| **Job Role** | DESIGNED / NOT FULLY BUILT | Retail Sales and National Accounts Sales explicitly distinct; Job Role separated conceptually from Security Role. | Canonical Job Role authority/storage, admin maintenance, Employee assignment/history; no generic `SALES` shortcut. | 30% |
| **Manager / Reporting Relationship** | OPERATIONAL / PARTIAL | PostgreSQL reporting relationship and Employee reads exist. | Full admin maintenance UX/history and convergence with organization structure. | 70% |
| **Employee Work Assignment** | DESIGNED / GAP | Requirement and EMP-RT-05 gap identified. | Canonical assignment authority by domain; Work Order assignment is first major dependency. | 20% |
| **Owner / Accountable Person** | OPERATIONAL / PARTIAL | Typed ownership/accountability model and governed commercial/CRM writers exist; census work is mature. | Apply consistently to every major record family; expose/administer in UI; migrate remaining Firebase-era objects. | 70% |
| **Assignee / Approver** | PARTIAL | Domain-specific assignee/approver concepts exist. | Canonical separation from Owner/accountable and standardized projections/audit where appropriate. | 55% |
| **EOS Session** | TARGET / GAP | Current authentication tokens can enter system. | First-class EOS server session, expiry/revocation, session admin, role-change invalidation/re-evaluation, mobile-safe token/session pattern. | 20% |

## 6.2 Customer / CRM

| Object | Current state | Done | Remaining | Est. |
|---|---|---|---|---:|
| **Account / Customer** | BUILT / CUTOVER IN PROGRESS | Mature customer model/UI; PostgreSQL CRM authority/cutover tooling; ownership rulings and import contract. | Execute approved data cutover; flip runtime readers/writers; retire Firestore source; finish governed commercial profile fields. | 78% |
| **Contact** | BUILT / CUTOVER IN PROGRESS | Model, relationship to Account, PG target/cutover classification. | Execute cutover; governed PG writes/reads everywhere; remove legacy fields/paths. | 72% |
| **Location / Customer Site** | BUILT / CUTOVER IN PROGRESS | Core model and Account relationship; cutover ownership rules. | Execute PG cutover; ensure all service/equipment/sales references use canonical PG identity. | 72% |
| **Account Commercial Profile** | OPERATIONAL / PARTIAL | Payment terms/tax/currency/PO/invoice delivery concepts and governed-field work exist. | Finish PG target/cutover and Admin/CRM mutation flow; credit/pricing remain separate future capabilities. | 62% |
| **CRM Activity / Interaction** | PARTIAL | Interaction/attention/read foundations exist. | Unified activity authority, action/reminder workflow, lifecycle history and richer manager/customer timeline. | 55% |
| **Customer duplicate/merge** | FUTURE | Need identified. | Governed duplicate detection, merge authority, survivor rules, audit, integration impact. | 10% |
| **Customer segmentation / routing / dormancy** | FUTURE/PARTIAL | Some reporting/attention foundations. | Configurable segments, routing, dormant/reactivation workflow, territory/coverage integration. | 20% |

## 6.3 Sales / commercial

| Object | Current state | Done | Remaining | Est. |
|---|---|---|---|---:|
| **Opportunity** | BUILT / CUTOVER TOOLING MERGED | Governed commercial model, identity, owner/accountable handling, PG commercial command work; C5 migration tooling exists. | C5 migration/copy is explicitly not yet run; cut over all runtime reads/writes; exception/loss/close workflow; richer activity. | 75% |
| **Sales Agreement / Quote** | BUILT / CUTOVER TOOLING MERGED | Agreement authority and commercial chain foundations. | Run migration/cutover; complete revisions/approvals/discount exceptions/proposal artifacts. | 72% |
| **Sales Order** | BUILT / CUTOVER TOOLING MERGED | Strong order identity/read/lineage and PG target foundation. | Run migration/cutover; full line/fulfillment authority; partial fulfillment/cancel/return; downstream invoice/install completion. | 78% |
| **Commercial Lines** | PARTIAL/GAP | Commercial parent records exist. | Canonical line-level authority is still a blocked relationship in Sample Company v2; finish product/model/part and fulfillment linkage. | 45% |
| **Sales Credit / Commission** | FUTURE | Need preserved; owner explicitly not equal commission recipient. | Credit attribution, split credit, eligibility, payment trigger, clawback/return handling. | 10% |
| **Territory / Commercial Coverage** | FUTURE / IDENTIFIED | Detailed principles preserved: channel, territory, named/corporate/local coverage, effective dating. | Formal assessment, Territory + Coverage Assignment authorities, precedence/resolution, Admin UX, reporting integration. | 10% |
| **Channel** | PARTIAL | Retail and National Accounts concepts exist. | Move from hard-coded vocabulary to governed configurable reference data; add Strategic Accounts when authorized. | 35% |

## 6.4 Finance / billing

| Object | Current state | Done | Remaining | Est. |
|---|---|---|---|---:|
| **Invoice** | PARTIAL | Financial normalized read/identity concepts and sales-chain linkage work exist. | Canonical transactional invoice authority, issue/adjust/credit lifecycle, PG persistence, runtime cutover. | 45% |
| **Payment / AR** | FUTURE/PARTIAL | Reporting/financial framework and provider-neutral concepts exist. | Payment posting/reconciliation, partial payment, overdue/collections, disputes, write-off, financial completion. | 30% |
| **Credit / Adjustment / Refund** | FUTURE | Concepts identified in reverse-commerce/financial framework. | Explicit governed objects/commands/audit and accounting integration. | 10% |
| **Financial provider contract** | PARTIAL | Provider-neutral financial architecture exists. | Select/implement authoritative provider(s) or governed local ledger; reconcile production data. | 45% |
| **Multi-currency / FX** | FUTURE / IDENTIFIED | Money helpers and ISO currency seams exist; register preserves locked-rate requirements. | Company base currency, allowed transaction currencies, governed rates/provenance/snapshots/amendments. | 15% |

## 6.5 Catalog / supplier / procurement

| Object | Current state | Done | Remaining | Est. |
|---|---|---|---|---:|
| **Part Master** | BUILT / CUTOVER IN PROGRESS | Descriptive PG Part Master migration/writers landed; reference authority exists. | Execute/verify controlled data cutover where not yet completed; flip all remaining runtime consumers; retire Firestore catalog. | 82% |
| **Supplier** | OPERATIONAL / PARTIAL | Governed Supplier Master and PG authority foundations exist. | Finish runtime cutover/mutation completeness and vendor-performance/economics layers. | 80% |
| **Supplier Catalog Item** | OPERATIONAL / PARTIAL | Supplier-part relationship and catalog foundation exist. | Pricing history, substitutions, preferred-source rules, lead-time/performance analytics. | 72% |
| **Reorder Request** | OPERATIONAL / MATURE | End-to-end review/assignment/purchasing lifecycle is one of the most mature workflows. | Move remaining authority/data off Firebase-era implementation; reconcile v2 ownership/assignee model; richer exception/zero-history planning. | 85% |
| **Purchase Order** | OPERATIONAL / PARTIAL | Governed PO/reorder PO flow, immutable/void patterns and PG purchasing foundation exist. | Full vendor PO document/artifact/revision/partial/backorder/credit functionality and final data cutover. | 82% |
| **Receiving Order / Receipt** | OPERATIONAL / PARTIAL | Trusted receiving and location/readiness work exists. | Complete PG/runtime convergence, partial/damaged/discrepancy handling, document/evidence and exception closure. | 78% |
| **Vendor Return / Credit** | FUTURE | Need identified. | RMA/vendor return, credit/replacement linkage and financial reconciliation. | 10% |

## 6.6 Inventory / warehouse / mobile stock

| Object | Current state | Done | Remaining | Est. |
|---|---|---|---|---:|
| **Warehouse** | OPERATIONAL / STRONG | PG warehouse authority/migration, assignment and read foundations exist. | Finish all runtime cutover and admin maintenance; reconcile v2 scopes. | 88% |
| **Bin / Stock Location** | OPERATIONAL / STRONG | PG bin/location authority and labeling work. | Complete maintenance/exception workflows and remaining legacy cutover. | 86% |
| **Truck / Mobile Location** | OPERATIONAL / STRONG | PG truck/mobile registry and inventory concepts exist. | Employee/Technician linkage; assigned-truck authority; mobile app completion. | 82% |
| **Stock Position** | OPERATIONAL / PARTIAL | Ledger-derived position/readiness and location authority. | Full PG transactional convergence, reservations/transfers/counts/returns unified in one movement truth. | 75% |
| **Inventory Transaction / Ledger** | OPERATIONAL / STRONG | Append-only movement concepts, consumption/reservation/release, receiving and opening balance patterns. | Complete PG source-of-truth cutover for all movement types and legacy data; return/scrap/quarantine extensions. | 78% |
| **Inventory Commitment / Reservation** | OPERATIONAL / PARTIAL | Commitment and WO replay foundations exist. | Full lifecycle exposure, allocation conflicts, release/reassignment, fulfillment integration. | 72% |
| **Transfer Order** | OPERATIONAL / PARTIAL | Transfer authority and location scope work exist. | Final PG/runtime convergence, mobile execution and exception/discrepancy closure. | 78% |
| **Cycle Count** | OPERATIONAL / STRONG | Warehouse/mobile/reconciliation flows and training work are advanced. | Reconcile current deployment path, remove Firebase callable dependency, complete final operational acceptance on new stack. | 85% |
| **Inventory Action log** | LEGACY / RETIRE | Historical action-log evidence exists; production assessment found minimal use. | Archive in place if still required for history, close write path, remove as current operational/reporting authority. | 20% target-retirement |
| **Damage / Scrap / Quarantine** | FUTURE/PARTIAL | Need known. | Governed reason/state/movement/write-off flows and financial impact. | 15% |

## 6.7 Equipment / serialized assets / warranty

| Object | Current state | Done | Remaining | Est. |
|---|---|---|---|---:|
| **Equipment Model** | OPERATIONAL / STRONG | Model authority and PG foundations exist. | Complete catalog/config administration and compatibility linkage. | 85% |
| **Serialized Equipment / Asset** | OPERATIONAL / PARTIAL | Equipment authority, serialized identity/custody, customer/location read foundations. | Full PG runtime cutover, installation/move/swap/retire workflow, availability/commitment model. | 72% |
| **Serialized Custody** | OPERATIONAL / PARTIAL | Custody authority added in PG foundation. | Complete every movement/installation/loaner/return transition and UI/audit. | 70% |
| **Installed Base** | PARTIAL | Customer Equipment workspace/timeline/read foundations. | Sale/order -> serial allocation -> installation -> ownership/location -> service-history chain end-to-end. | 55% |
| **Install Entitlement** | PARTIAL | Entitlement concepts/authority exist. | Full customer-facing/service-triage experience and billing/claim consequence. | 60% |
| **Warranty Claim** | PARTIAL | Claim/status foundations exist. | Core-role grants, exception queue, parts return, settlement/recovery/reconciliation, analytics. | 55% |
| **Temporary Placement (Loaner/Evaluation)** | FUTURE / IDENTIFIED | Business relationship and execution principles captured. | Formal representation assessment; request/allocation/custody/return; service + sales consumers. | 15% |
| **Part/Equipment compatibility** | GAP | Need is known and present in scenario block list. | Canonical relationship authority and governed maintenance/read paths. | 20% |

## 6.8 Service / Work Orders / field operations

| Object | Current state | Done | Remaining | Est. |
|---|---|---|---|---:|
| **Work Order** | OPERATIONAL / MATURE, FIREBASE-ERA AUTHORITY | Rich lifecycle/state machine, execution, scheduling, parts readiness, audit, North Star UI and strong tests. | Create PostgreSQL Work Order authority; migrate/cut over records/lifecycle/commands; remove Firebase transaction/Function dependency; complete billing readiness/reopen/revision. | 68% |
| **Work Order Assignment** | DESIGNED / GAP | Current Firestore scheduled/assigned tech semantics inventoried; open census PR defines target Employee-keyed history model. | Owner decisions, PG authority, historical/effective assignment, EMP-RT-05, lifecycle cutover. | 30% |
| **Technician** | OPERATIONAL / PARTIAL | Technician execution, current-job and scheduling foundations exist. | Canonical Employee<->Technician relationship; move remaining tech authority off Firebase; skills/cert eligibility. | 62% |
| **Scheduling Availability** | OPERATIONAL / STRONG | Working availability, blocked time, collision model and planning estimate are mature. | Move storage/commands to PG/Render; mobile/app convergence; capacity enhancements. | 72% |
| **Dispatch / Schedule** | OPERATIONAL / STRONG | Schedule, reschedule, reassign, unschedule, dispatch, board/UI and overlap policies exist. | PG Work Order/assignment cutover; richer capacity/route/ETA/SLA; final app/mobile behavior. | 75% |
| **Field Execution** | OPERATIONAL / STRONG | Travel/arrival/work/complete, parts execution and field UX foundations. | PG Work Order cutover, offline/device strategy, inspections/checklists/signature/receipt/email closeout. | 82% |
| **Work Order Labor** | DESIGNED / EARLY | Lifecycle timestamps and labor principles exist. | Governed time attribution, paid/non-job/unaccounted time, approvals/corrections, effective-dated labor cost, payroll/export. | 25% |
| **Service Contract** | FUTURE | Need preserved. | Contract authority, equipment coverage, SLA/inclusions/renewal/profitability. | 10% |
| **PM Schedule** | FUTURE | Need preserved. | Recurring schedule generation, due/overdue rules, contract linkage and dispatch integration. | 10% |

## 6.9 Communications / inbound work

| Object | Current state | Done | Remaining | Est. |
|---|---|---|---|---:|
| **Email Connection / Mailbox** | OPERATIONAL IN SANDBOX / PARTIAL | M365/Google connection architecture, mailbox/routing/admin design, provider delivery/attachment custody work, training. | Re-home secrets/provider runtime on zero-Firebase/Render stack; real tenant binding; final operational rollout. | 65% |
| **Inbound Message / Inbound Work** | OPERATIONAL IN SANDBOX / PARTIAL | Review/extraction/matching/duplicate/thread/audit and Accept/Decline/Attach flows. | PG persistence/cutover, production mailbox operation, full error/retry/monitoring, zero-Firebase transport. | 68% |
| **Notification / My Work** | PARTIAL | Notification foundations and workflow queues exist. | Unified role/user work inbox when multiple workflow types are governed; ownership/accountability alignment. | 50% |

## 6.10 Reporting / analytics / administration / metadata

| Object/capability | Current state | Done | Remaining | Est. |
|---|---|---|---|---:|
| **Reporting** | OPERATIONAL / PARTIAL | Governed reporting authorities, query allowlists, financial/reporting work, dashboards. | Unified metric metadata/semantic layer, schedules/sharing/export, quality/freshness assertions, full PG sources. | 70% |
| **Financials UI / lifecycle reporting** | OPERATIONAL / PARTIAL | Strong read/authority/visual foundation. | Real invoice/payment/AR transaction authority and full reconciliation. | 65% |
| **Performance Goal** | OPERATIONAL / PARTIAL | Goal authority and personalized dashboards accepted in sandbox history. | PG/Render convergence and final production/client rollout. | 70% |
| **Object/Field Metadata** | PARTIAL | Field Architecture v2, metadata/query foundations and entity/list work exist. | Tenant self-service configuration, governed admin editors, full runtime migration, no source-code requirement for routine configuration. | 40% |
| **Entity List Metadata** | PARTIAL | Architecture/issues defined; some list/query work exists. | Finish reusable list runtime across Customers + Work Orders and retire full-client dataset patterns. | 45% |
| **Data Import** | OPERATIONAL / PARTIAL | Governed contracts, preview/execution, sandbox fencing, provenance and historical-service import. | PG-native writers for all target entities, production onboarding policy, migration toolkit integration, zero-Firebase. | 65% |
| **EOS Contextual Assistant** | HELD | Architecture/security/tooling foundation exists. | Resume only after non-Firebase identity/session and non-Firebase authoritative reads; then governed read-only assistant. | 25% |
| **Tenant metadata self-service / automation / EQL / bulk data** | FUTURE/PARTIAL ARCHITECTURE | Architecture recorded. | Build after stable v2 authority + entity metadata; admin configuration may compose authority but never create it. | 20% |

---

# 7. End-to-end business process inventory

## 7.1 Customer setup and account maintenance

**Target:** Prospect/customer created -> Contacts/Sites -> ownership/accountability -> commercial profile -> equipment/service/sales history.

- **Done:** Account/Contact/Location product foundations; governed profile concepts; ownership rulings; PG target/cutover tooling; customer record UI.
- **Remaining:** run CRM cutover; PG runtime writers/reads only; duplicates/merge; richer change history; segmentation/routing; account/site governance; v2 permission mapping.
- **Status:** BUILT / CUTOVER IN PROGRESS
- **Est.: 75%**

## 7.2 Opportunity -> Agreement/Quote -> Won/Lost

- **Done:** Opportunity and Agreement authority foundations; ownership/accountability; human/system identity work; PG commercial command/cutover tooling.
- **Remaining:** run C5 migration; cut over runtime; close/loss reasons; revisions/discount approvals/proposal artifacts; activity/reminders; territory/credit integration.
- **Status:** BUILT / NOT FULLY CUT OVER
- **Est.: 72%**

## 7.3 Won Opportunity -> Sales Order

- **Done:** governed order authority, numbering/lineage, commercial chain, PG target and migration tooling.
- **Remaining:** migration/cutover, line authority, partial/cancel/revision exceptions, full order-to-fulfillment projection.
- **Status:** BUILT / NOT FULLY CUT OVER
- **Est.: 76%**

## 7.4 Sales Order -> allocate equipment -> warehouse prep -> schedule -> deliver/install -> close

- **Done:** many constituent authorities exist: Sales Order, Equipment, custody, warehouses/bins/trucks, Work Orders, scheduling/dispatch, technician execution.
- **Remaining:** one governed cross-domain fulfillment chain; order-line-to-serialized-equipment linkage; coordinated multi-equipment execution; readiness/commitment; installation close; billing handoff.
- **Status:** PARTIAL CROSS-DOMAIN
- **Est.: 52%**

## 7.5 Ventana ice-machine commercial + inventory lifecycle

- **Done:** Discovery baseline records upstream/downstream business reality; company authority, inventory, equipment and sales foundations exist.
- **Remaining:** explicit cross-company commercial ownership, Taylor inventory-control persistence through install + sale close, accounting/chargeback/billing rules, end-to-end scenario proof.
- **Status:** DISCOVERED / PARTIAL
- **Est.: 35%**

## 7.6 Reactive service intake -> Work Order

- **Done:** Customer/Equipment selection, Work Order create/lifecycle, service UI, parts readiness, execution and audit are mature.
- **Remaining:** PG Work Order authority and cutover; zero-Firebase command path; complete ownership/accountability/assignment v2 integration.
- **Status:** OPERATIONAL / ARCHITECTURE CUTOVER REQUIRED
- **Est.: 80% business capability / 60% target architecture**

## 7.7 Email -> Inbound Work -> Accept/Decline/Attach -> Work Order

- **Done:** mailbox/config/routing/review, extraction/matching, duplicate/thread protection, Accept/Decline/Attach and audit in sandbox program.
- **Remaining:** PG/Render persistence/provider transport, real mailbox binding, zero-Firebase runtime, production rollout and monitoring.
- **Status:** SANDBOX-OPERATIONAL / PARTIAL
- **Est.: 65%**

## 7.8 Work Order planning -> scheduling -> dispatch

- **Done:** scheduling window, technician planning, availability, blocked time, conflict policy, reschedule/reassign/unschedule/dispatch and board foundations.
- **Remaining:** PG Work Order + assignment authority; Employee-based assignee identity; skills/cert eligibility; route/capacity/ETA improvements.
- **Status:** OPERATIONAL / CUTOVER DEPENDENCY
- **Est.: 75%**

## 7.9 Technician execution -> travel -> arrive -> work -> parts -> completion

- **Done:** mature execution lifecycle, field mode, atomic completion patterns, parts execution/readiness and audit.
- **Remaining:** PG Work Order/Technician convergence, mobile/offline/device layer, inspections/checklists, signature/receipt/email, full closeout evidence.
- **Status:** OPERATIONAL / STRONG
- **Est.: 82%**

## 7.10 Technician truck part scan/consume -> Work Order -> invoice

- **Done:** truck/mobile-location concepts, inventory reservation/release/consume primitives, Work Order parts execution, architectural direction from Issue #182.
- **Remaining:** assigned-truck scope through Employee/Technician relation, idempotent PG/Render command, pricing/tax/invoice attachment, offline retry, return/refund reversal.
- **Status:** PARTIAL / FUTURE COMPLETION
- **Est.: 35%**

## 7.11 Inventory reorder -> review -> assignment -> purchase -> receive

- **Done:** one of EOS's strongest complete workflow families; Reorder Request lifecycle, assignment, purchasing progress, PO/void, receiving and audit are well developed.
- **Remaining:** move remaining runtime authority/data to PG/Render, v2 assignee/role convergence, partial/backorder/substitution/vendor-credit and full receiving economics.
- **Status:** OPERATIONAL / MATURE
- **Est.: 86%**

## 7.12 Warehouse receiving -> stock -> allocation/readiness

- **Done:** receiving command/location concepts, inventory ledger/positions, warehouses/bins, readiness and serialized foundations.
- **Remaining:** zero-Firebase runtime, damaged/partial/discrepancy, explicit allocation/commitment chain, full PG ledger convergence.
- **Status:** OPERATIONAL / PARTIAL
- **Est.: 75%**

## 7.13 Warehouse/Truck transfer

- **Done:** transfer order foundations, warehouse/truck authorities and scoping.
- **Remaining:** full PG/Render cutover, mobile handoff/receipt, discrepancy/lost/damaged exceptions and historical custody proof.
- **Status:** OPERATIONAL / PARTIAL
- **Est.: 76%**

## 7.14 Cycle Count -> reconcile -> close

- **Done:** warehouse and technician/mobile count workflows, reconciliation, separation of duties, UI/training and strong test history.
- **Remaining:** deploy/runtime reconciliation to target stack; remove Firebase callable dependency; final zero-Firebase acceptance.
- **Status:** OPERATIONAL / STRONG
- **Est.: 85%**

## 7.15 Equipment receive -> custody -> customer installation -> installed base

- **Done:** equipment/model/serialized/custody concepts, cross-franchise discovery, Work Order/dispatch execution pieces.
- **Remaining:** unified receiving-to-equipment record, order-line allocation, readiness, install/commission, custody transfer, installed-base history, cross-company economics.
- **Status:** PARTIAL
- **Est.: 55%**

## 7.16 Warranty entitlement -> service -> manufacturer claim -> recovery

- **Done:** entitlement/claim foundations and service links.
- **Remaining:** pre-WO triage, claim authorization/grants, parts return, exception queue, settlement/recovery/reconciliation, analytics.
- **Status:** PARTIAL
- **Est.: 55%**

## 7.17 Work completion -> invoice -> AR -> payment -> financial completion

- **Done:** business metric/financial architecture and several reporting/read foundations.
- **Remaining:** transactional invoice authority, billing readiness, payment/partial payment, overdue/collections, adjustments/refunds/write-offs, reconciliation, financial completion state.
- **Status:** PARTIAL / MAJOR GAP
- **Est.: 40%**

## 7.18 Technician time -> labor attribution -> job cost -> payroll

- **Done:** lifecycle timestamps and conceptual separation of travel/on-site/paid/non-job/unaccounted time.
- **Remaining:** time authority, timesheets/approvals/corrections, rate history, job costing, overtime/breaks, payroll export/integration.
- **Status:** DESIGNED / EARLY
- **Est.: 25%**

## 7.19 Temporary loaner / sales evaluation placement -> return

- **Done:** requirement and custody/execution principles preserved.
- **Remaining:** representation assessment, request/allocation/readiness/placement/review/return, availability semantics, service and sales consumers.
- **Status:** FUTURE / IDENTIFIED
- **Est.: 15%**

## 7.20 Preventive maintenance / service contracts

- **Done:** business need and dependencies captured.
- **Remaining:** contract object, coverage/SLAs/inclusions, PM schedules, generation, dispatch, renewal and profitability.
- **Status:** FUTURE
- **Est.: 10%**

## 7.21 Returns / RMA / reverse commerce

- **Done:** need and forward-ledger constraints captured.
- **Remaining:** customer/vendor returns, equipment return, replacement, credit/rebill, custody reversal, financial reconciliation.
- **Status:** FUTURE
- **Est.: 10%**

## 7.22 Sales credit / commissions

- **Done:** separation from Opportunity ownership explicitly preserved.
- **Remaining:** credit participants/splits, commission plans, eligibility, payment trigger, adjustments/clawbacks, reporting.
- **Status:** FUTURE
- **Est.: 10%**

## 7.23 Commercial territory / coverage -> pipeline/book/reporting

- **Done:** detailed roadmap requirements and invariants recorded.
- **Remaining:** formal authority model, configurable dimensions, resolver, effective dating, corporate/local/named overlays, admin/reporting integration.
- **Status:** FUTURE / IDENTIFIED
- **Est.: 10%**

## 7.24 Employee onboarding -> user access -> role assignment -> offboarding

- **Done:** Employee/Principal distinction, memberships, Employee links, PG Employee directory/profile, nonprod persona provisioning and role foundations.
- **Remaining:** Authorization v2; governed Employee writer; Job Role; OIDC; EOS sessions; role/permission admin; disable/revoke/offboard; zero Firebase; deterministic acceptance matrix.
- **Status:** PARTIAL / FOUNDATION RESET
- **Est.: 55%**

## 7.25 Administration -> Security Roles / permissions / effective access

- **Done:** large amount of capability/policy/admin groundwork and tests.
- **Remaining:** v2 role/permission schema, one evaluator, human-readable role editor, field/scope/workflow permission admin, overrides, simulator, audit, no compatibility-role ambiguity.
- **Status:** FOUNDATION RESET
- **Est.: 40%**

## 7.26 Data onboarding / import -> validate -> preview -> governed write -> provenance

- **Done:** entity-agnostic import framework, contracts, previews, provenance, historical-service pattern and sandbox fencing.
- **Remaining:** PG writers across objects, production onboarding policy, reusable migration/cutover packaging, error/correction workflow, zero-Firebase.
- **Status:** OPERATIONAL / PARTIAL
- **Est.: 65%**

## 7.27 Reporting -> drilldown -> export/share/schedule

- **Done:** reporting authority, query foundations, dashboards/financial reads and report concepts.
- **Remaining:** unified semantic/metric model, field-level v2 authorization, export/share/schedule, saved definitions, freshness/data-quality assertions, PG sources only.
- **Status:** OPERATIONAL / PARTIAL
- **Est.: 70%**

## 7.28 Contextual AI assistance

- **Done:** security/provider/tool-registry design and held Render boundary work.
- **Remaining:** zero-Firebase identity/session and business-read authorities first; then read-only contextual assistant, evaluation and later explicitly governed actions.
- **Status:** HELD
- **Est.: 25%**

---

# 8. Current PostgreSQL cutover reality

The program must report these states separately:

## 8.1 Runtime cut over or substantially consuming PostgreSQL now

- Employee runtime reads / Employee operating profile.
- Administration Users directory now uses governed PostgreSQL Employee IDs rather than the Firestore metadata directory.
- Tenant/Principal/Membership/policy foundations.
- Reporting relationships and portions of ownership/accountability infrastructure.
- Catalog/reference and multiple operational registries have PostgreSQL target authorities.

## 8.2 Target/migration code exists but cutover is not equivalent to completion

- **CRM:** cutover census/export/copy/verify tooling is merged, but a merged tool does not mean the migration has been executed and runtime has fully flipped.
- **Commercial:** C5 one-time migration tooling is merged and explicitly recorded as **NOT RUN** in the merge title/evidence.
- **Catalog:** PostgreSQL catalog writers/copy-once/verify work is merged; each environment still requires explicit migration/cutover evidence before legacy retirement.
- **Sample Company v2:** a strong connected nonprod world is merged and reveals blocked relationships rather than faking them; it is test/acceptance infrastructure, not proof that every production authority is cut over.

## 8.3 Major domains still blocked on new canonical PostgreSQL authority

- Work Order record/lifecycle migration.
- Work Order assignment authority and Employee-keyed assignment history.
- Employee assignment in general.
- Employee <-> Technician relation.
- Installed Equipment end-to-end relationship.
- Inbound Work target PG persistence.
- Commercial lines/full fulfillment relationship.
- Invoice/AR transactional authority.
- Some receipt-driven inventory movement/cross-domain links.
- Job Role authority.

---

# 9. Firebase exit inventory

**Target:** zero Firebase dependency.

## Keep temporarily only until replacement is proven

- current Firebase authentication verifier where still required for login;
- Firestore data/Function paths that are still the only operating authority for a domain;
- migration-only readers needed for controlled one-time copy/verification.

## Do not build on

- new Firebase Rules business authorization;
- new client-direct Firestore business writes;
- new Firebase-only workflow authority;
- new Firebase-specific business object contracts;
- new application features whose only viable target is a Firebase callable when the same feature belongs on Render.

## Remove after cutover

- Firebase Auth runtime dependency;
- Firestore business collections/readers/writers once their domain is cut over;
- Firebase Functions/callables replaced by EOS API commands;
- `firestore.rules` business authority and legacy role predicates;
- Firebase SDK initialization that has no remaining required client function;
- emulator/development environments whose sole purpose is the retired Firebase application architecture;
- stale docs/runbooks/tests that teach Firebase as the target EOS platform rather than historical migration evidence.

---

# 10. Open PR reconciliation — current program disposition

This section records **roadmap disposition**, not automatic merge/close authority.

| PR | Current meaning | Roadmap disposition |
|---|---|---|
| **#1915 Work Order assignment census** | Valuable current census; confirms PG assignment authority does not exist and is coupled to Work Order lifecycle cutover. | **KEEP AS DESIGN INPUT.** Reconcile target with Authorization v2 and Employee-based assignment. Do not implement independently of Work Order cutover. |
| **#1857 Cycle Count release/training correction** | Documents Vercel/Render deployment reality and cycle-count training; also records Firebase callables unavailable in that deployed stack. | **REVIEW/REBASE OR INCORPORATE** into current deployment/zero-Firebase docs; preserve training. |
| **#1855 Render assistant boundary** | Explicitly blocked on zero-Firebase identity/session and business reads. | **KEEP HELD.** Resume after foundation cutover, not before. |
| **#1832 workspace branding** | Small customer-name correction. | **REBASE/VERIFY** independently; not a foundation blocker. |
| **#1826 Cursor Cloud Agent Firebase emulator environment** | Builds future dev workflow around Firebase emulator. | **SUPERSEDE/CLOSE after confirmation** because target architecture is zero Firebase; replace later with PG/Render/Vercel-local development environment. |
| **#1821 Rules-out-of-Firebase** | Contains extensive valuable census/tests and attempts to converge authorization while retaining Firebase Auth and much compatibility architecture. | **DO NOT MERGE AS THE FINAL MODEL.** Harvest its census, parity tests and domain authorization evidence into Authorization v2; supersede the implementation with the Owner-directed clean rebuild. |
| **#1724 visual-system rollout** | Historical site-wide visual work; much related content subsequently landed through later changes. | **VERIFY DIFF AGAINST CURRENT MAIN, THEN CLOSE/SUPERSEDE OR EXTRACT ONLY MISSING DELTAS.** Do not merge stale 5-commit branch blindly. |
| **#1722 ND-33 live verification doc** | Historical evidence about receiving UI/deployment. | **RECONCILE/HISTORICALIZE**; do not treat old Firebase environment assumptions as current. |
| **#1630 inventory-action dependency assessment** | Useful evidence that action log is not real current inventory authority. | **USE FOR RETIREMENT DECISION**; archive-in-place direction belongs in Firebase/data cleanup. |
| **#1569 dispatch sticky header** | Small UX fix on old base. | **REPRODUCE ON CURRENT UI**; cherry-pick/reimplement only if still missing. |
| **#1487 legacy Work Order complaint correction** | One-time data-cleanup + provenance hardening. | **SEPARATE DATA-MIGRATION DISPOSITION**; do not mix into architecture reset. |
| **#1414 cert/world branch mix-up** | Stale/misdescribed historical PR. | **CLOSE AS STALE** after confirming no unique current work is stranded. |

---

# 11. Current open-issue reconciliation

The repository has many historical/open tracking issues. The roadmap should not assume “open” means “next.” Important current buckets:

### Foundation/current

- #226 Enterprise Access & Administration — **superseded in architecture direction by Authorization v2 reset; retain historical evidence and reconcile/replace child-row plan rather than blindly continue it.**
- #1915 PR / Work Order assignment census — input to Work Order/Employee assignment convergence.
- #175 Account Commercial Profile — reconcile with PG CRM cutover and current governed fields.
- #182 Truck Parts Sale-to-Invoice — remains a real future cross-domain process, now must target Render/PG rather than Firebase trusted writers.
- #325 Self-service Reporting — remains valid future capability, but must consume Authorization v2 field/scope authority.

### Product completeness / validation

- #1105 scenario/behavior test framework — remains valuable; Sample Company v2 provides an increasingly strong seed to build from.
- #1096/#1097/#1098/#1099 metadata/list/customer/opportunity work — reconcile against current PG query/read architecture and North Star implementations before resuming.
- #785 equipment customer-read reliability — revalidate after PG CRM/Equipment cutover; fix at target data seam rather than improving a retiring Firestore hook if that hook is about to disappear.

### AI / orchestration

- #1492 Work Order contextual intelligence and assistant work remain downstream of authoritative PG reads and Authorization v2.
- EOS orchestration/meta issues remain separate from Taylor business completion and must not displace core platform convergence unless they are blocking delivery.

---

# 12. Sequenced remaining program

## Wave 0 — Freeze and reconcile current truth

**Goal:** stop architectural churn while preserving working business capability.

- Adopt this reconciliation as current roadmap.
- Freeze new permission/role/Firebase mechanisms.
- Inventory current source of truth for every business object/read/write.
- Tag each path: CURRENT TARGET / MIGRATION ONLY / LEGACY / RETIRE / BLOCKED.
- Reconcile open PRs above; stop stale branches from accidentally becoming architecture.
- Keep business feature work that does not create new foundation debt moving.

**Exit:** one current object/process/authority matrix with named owner and source for every major family.

## Wave 1 — Authorization v2 + EOS identity/session

- Build clean PG v2 identity/authorization/session model.
- Microsoft/Google OIDC identity bindings.
- Render/EOS session validation/revocation.
- One effective authorization evaluator.
- Admin Employees / Users & Access / Security Roles / effective-access simulator.
- Persona acceptance matrix.

**Exit:** a user can sign into EOS without Firebase and receives deterministic server-enforced access from PG.

## Wave 2 — Finish already-started PG cutovers

Prioritize work where most target infrastructure already exists:

1. Employee writer/lifecycle + Job Role + access admin.
2. CRM cutover execution and runtime flip.
3. Catalog cutover execution/runtime flip.
4. Commercial C5 migration execution/runtime flip.
5. Supplier/warehouse/bin/truck registry runtime convergence.

**Exit:** these families have one PG authority, one Render command/read boundary, and no ordinary runtime Firestore dependency.

## Wave 3 — Operational core convergence

1. Work Order PG authority.
2. Work Order assignment Employee-based history.
3. Technician <-> Employee relation.
4. Scheduling/dispatch command/read cutover.
5. Field execution cutover.
6. Inventory ledger/commitment/transfer/cycle-count/receiving final PG convergence.
7. Equipment/serialized/custody/install linkage.
8. Inbound Work/email PG/Render convergence.

**Exit:** Taylor's daily service/inventory operation runs without Firebase business authority.

## Wave 4 — Commercial-to-cash completion

1. Commercial lines + fulfillment.
2. Equipment allocation/install fulfillment.
3. Work Order billing readiness.
4. Invoice authority.
5. AR/payment/collections.
6. Reverse commerce / credits / refunds.
7. Cross-company Taylor/Ventana financial handling.

**Exit:** Opportunity/Sales Order/Service work can reach financial completion with traceable lineage.

## Wave 5 — Management and workforce completeness

- labor/time/payroll;
- sales credit/commissions;
- commercial territory/coverage;
- skills/certifications/eligibility;
- exception ownership/My Work;
- service contracts/PM;
- temporary equipment placements;
- vendor performance/purchasing economics;
- reporting semantic model/self-service reporting.

## Wave 6 — EOS as an application family

- PWA/installability and durable app shell;
- client-safe session/token lifecycle;
- device abstraction for camera/barcode/signature/photos/location/offline;
- technician/warehouse mobile experience;
- later native iOS/Android/desktop clients where operationally justified;
- every client uses the same EOS APIs and Authorization v2.

---

# 13. Definition of platform completion

EOS is not “done” merely because every page exists. The current target is reached when:

1. Every major business object has one named authoritative storage/command/read source.
2. Every material business process can be traced from start to terminal/exception states.
3. Identity, Employee, Job Role, Security Role, permission, ownership, accountability and assignment are distinct and consistently enforced.
4. Every protected action is enforced server-side by Authorization v2.
5. PostgreSQL/Render are the authoritative business platform.
6. Firebase is absent from normal EOS runtime and business authority.
7. The Vercel client contains no privileged secret or business-authority logic.
8. Web/PWA/mobile clients consume the same governed APIs.
9. Each migration has census -> disposition -> copy -> verify -> cutover -> legacy-retirement evidence.
10. End-to-end scenario tests cover normal, exception, retry, duplicate, concurrent and denied behavior.
11. North Star UI accurately represents available business authority; unavailable states remain honest.
12. User/admin training is the last required artifact before deployment signoff for each major capability.

---

# 14. Program controls going forward

To keep this roadmap from becoming another stale snapshot:

- Every major merge that changes an object's authority, source of truth, runtime cutover state or business-process maturity must update this reconciliation or its successor.
- “Code merged” may not be reported as “cut over” unless the running environment actually uses it.
- “Migration tooling exists” may not be reported as “data migrated.”
- “UI exists” may not be reported as “business process complete” if the backend authority/action is unavailable.
- A legacy implementation is not removed until replacement proof exists; once replacement proof exists, leaving the legacy path reachable is itself open work.
- New objects/processes must identify Owner, Accountable, Assignee/Approver semantics before operational release where applicable.
- No new parallel authorization, role, permission, session, ownership or business-data authority may be created outside the designated platform model.
- Training remains the final deployment/signoff artifact for each capability.

---

# 15. Immediate next actions

1. **Adopt Authorization v2 / zero-Firebase as Foundation Workstream A.**
2. **Perform the object/source-of-truth census against current `main` and attach exact code authorities to the tables above.**
3. **Reconcile/close/supersede stale open PRs, starting with #1821 and #1826 because they directly conflict with the newly adopted target.**
4. **Finish Employee Operating Model inputs, Job Role authority and Employee writer because they are upstream of access and assignment.**
5. **Complete the already-built CRM/Catalog/Commercial PG cutover operations rather than starting parallel replacements.**
6. **Take Work Order + assignment as the first major operational PG convergence after those cuts, using #1915 as census input.**
7. **Then converge Inventory/Purchasing/Receiving/Transfers/Cycle Counts, Equipment, and Inbound Work on Render/PG.**
8. **Only after the operational core is converged, finish invoice/AR/payment and the broader management capabilities.**
9. **Convert the responsive web application into the installable/multi-client EOS application family without moving authority into clients.**

---

## Durable source references used for this reconciliation

This roadmap was reconciled from current repository evidence including, but not limited to:

- `docs/architecture/SYSTEM_AUTHORITIES.md`
- `docs/BusinessEntityModel.md`
- `docs/roadmaps/business-capability-register.md`
- `docs/SPRINT_STATUS.md`
- `docs/engineering/ACTIVE_WORKSTREAMS.md`
- `docs/DECISIONS.md`
- `docs/PROJECT_ARCHITECTURE.md`
- `docs/PlatformCapabilityModel.md`
- `docs/business-processes/*`
- current PostgreSQL migrations under `functions/migrations/`
- current `main` commits through `d3ecd534`
- current open PR/issue state as of 2026-09-16

Where a historical document conflicts with current code/current-main migration evidence, current executable repository state wins and the historical document remains evidence of the prior state.
