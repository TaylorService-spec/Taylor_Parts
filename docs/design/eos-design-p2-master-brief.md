# EOS — Design Phase 2 Master Brief

**Lane P3-C.** The consolidation of the Taylor EOS overnight programme into one statement a business
owner can act on.

**What this document is.** An honest description of what EOS is today, the small number of structural
causes that produced it, the decisions Design Phase 2 must make and the order they must be made in,
the conditions that must hold before anything is switched on in production, and an explicit list of
what nobody has actually verified.

**What this document is not.** It is not a defect list — the defect lists exist and are cited. It does
not answer a single Owner question; it frames them so they can be answered. It changes no code,
implements no design, and contacts nothing.

**The standard it is written to.** Every material claim carries a citation or names the input document
that carries one. Where the programme's lanes disagreed and the disagreement was settled with
evidence, the settlement is given. Where it was not settled, it is carried as unsettled and the
reason is stated. Where a figure is inherited and unverified, it is marked **UNPROVEN** in the body,
not only in an appendix.

**Read §6 before quoting any number or finding from any EOS document.** Seven claims in wide
circulation mean something other than what they appear to mean. Six are figures whose denominator or
predicate is not what a reader assumes; the seventh is a correct code reading taken from a branch that
has not merged. Each cost a lane a false conclusion, and the last one cost an earlier draft of this
brief a wrong precondition on its first decision.

---

## 0. Provenance

This brief consolidates eleven documents produced by the Phase-2 and Phase-3 lanes, plus one executed
correction received while it was being written. It adds no new measurement of its own; its contribution
is the consolidation, the causal argument, and the ordering.

| Input | What it contributes |
|---|---|
| `eos-workflow-registry.{md,json}` (P3-D) | **86 business workflows**, trigger to settled outcome, each with its break point, blocking mechanism, authority path and evidence status. The spine of this brief. |
| `eos-workflow-registry-schema-reconciliation.md` (P3-D) | How the three activity libraries' vocabularies map onto one another, and where they do not. |
| `service-scheduling-technician-equipment.md` (P3-A1) | Design archaeology: Service, Scheduling, Technician, Equipment. |
| `inventory-warehouse-purchasing-scanner.md` (P3-A2) | Design archaeology: Inventory, Warehouse, Purchasing, Scanner. |
| `sales-crm-financials-reporting-administration.md` (P3-A3) | Design archaeology: Sales, CRM, Financials, Reporting, Administration. |
| `service-technician.{md,json}` (P3-B1) | 330 day-in-the-life activities, Service and Technician. |
| `inventory-warehouse-purchasing.{md,json}` (P3-B2) | 330 activities, Inventory, Warehouse, Purchasing, Scanner. |
| `p3b3-*.json` (P3-B3) | 350 activities, Sales, CRM, Financial, Administration, Management, Adversarial. |
| `phase2-open-decision-ledger.md` (P2-D) | 25 deduplicated open items from ~90 raised notes across 31 handoff documents, 18 migration headers and 3 integration commits; 20 distinct Owner questions. |
| `verenward-global-record-identity-standard.md` + object-code registry + impact census (P3-0) | A proposed record-identity standard, its object-code registry, and the census of what adopting it would touch. |
| Executed role-resolution correction (P2-N) | Settles the one finding this brief had carried as its highest-priority unknown: **the 45 governed business roles are live authority**, and the contrary claim was branch-local. Adds the eleven-role `audit.event.read` denial and two merge gates. See §2.2, §5.1, §6.7, C16, C17. |

**The commit everything was checked against.** Every lane branched from `d104cf49`. The integrated
head is `0ba8ab0d` on `integration/wave-1`. P3-D re-checked every defect it promoted against the
integrated head and demoted six that were true at the lane base and fixed at the head. This brief
inherits that discipline: nothing below is reported as open that P3-D demoted.

---

## 1. What EOS is today

### 1.1 In one paragraph

EOS is a large, careful, well-governed system that is almost entirely switched off. The commands are
written. The authority model is real and, where it runs, it is strict and fails closed. The design
work behind it was mostly right. And in production today the system can be administered and cannot
be operated: **37 of its 147 capabilities are allowed to anyone anywhere in production, and not one
of them is commercial.** The business cannot raise an opportunity, quote a deal, allocate stock
against an order, record a technician's hours, issue an invoice, take a payment, or run a report from
EOS in production — not because the code is missing, but because the switches are off and, in several
cases, because the act belongs to no job anyone actually does.

### 1.2 The measured condition

**Eighty-six business workflows** were mapped, trigger to settled outcome, across fourteen domains —
272 steps in total, assembled from 1,010 modelled activities and re-verified at the integrated head.

| State | Count | Share | What it means |
|---|---:|---:|---|
| `WORKS_END_TO_END` | **0** | 0% | Runs from trigger to settled outcome with no gap. |
| `WORKS_WITH_GAPS` | **27** | 31% | The path completes, and something along it is wrong, lossy, ungoverned or unstated. |
| `BROKEN_MIDWAY` | **31** | 36% | The path starts, gets somewhere real, and has no next step. |
| `CANNOT_START` | **23** | 27% | The first step refuses, for every principal, in the environment named. |
| `NO_IMPLEMENTATION` | **5** | 6% | The business runs this path and EOS models no part of it. |

**The zero needs stating precisely, because it is easy to over-read and easy to under-read.**
Twenty-seven paths do complete. The zero is not a measurement that eighty-six things fail. It is the
combination of two facts: every path has a named gap somewhere along it, *and* nobody in this entire
programme ran any workflow end to end — the emulator cannot run in the programme's environment and no
lane made production contact. So the honest statement is: **no path in EOS has been demonstrated to
work end to end, and every path has a specific, cited gap.** (P3-D §9 item 10.)

**What stops the eighty-six:**

| First thing that stops the path | Workflows |
|---|---:|
| The next step was never written (`NO_CODE`) | 35 |
| A capability is registered inactive and the environment does not lift it | 23 |
| An Owner decision is pending | 15 |
| Firestore Rules refuse | 4 |
| The act belongs to no job someone does | 3 |
| A client gate asks a question nothing answers | 3 |
| The environment declines to activate | 2 |
| The transport cannot be reached | 1 |

Twenty-two of the eighty-six are blocked in more than one way at once, or by a different wall in a
different environment; reading the table alone understates it.

**By domain, the shape of the problem differs sharply:**

| Domain | Completes with gaps | Broken midway | Cannot start | Not modelled |
|---|---:|---:|---:|---:|
| Finance (12) | 1 | 1 | **9** | 1 |
| Service (11) | 4 | 6 | 0 | 1 |
| Inventory (9) | 2 | 6 | 1 | 0 |
| Administration (8) | 1 | 5 | 1 | 1 |
| Warehouse (6) | 1 | 1 | 3 | 1 |
| Cross-domain (6) | 1 | 4 | 1 | 0 |
| Scheduling (5) | **5** | 0 | 0 | 0 |
| Equipment (5) | 1 | 1 | 3 | 0 |
| Sales (5) | 0 | 2 | 2 | 1 |
| CRM (5) | 1 | 4 | 0 | 0 |
| Technician (4) | 3 | 0 | 1 | 0 |
| Scanner (4) | **4** | 0 | 0 | 0 |
| Reporting (4) | 1 | 1 | 2 | 0 |
| Purchasing (2) | **2** | 0 | 0 | 0 |

Read that table as a map of where the money is. Scheduling, Scanner and Purchasing are the healthiest
domains in EOS and none of them produces revenue. Finance is nine-tenths unable to start. Sales has
no domain workflow that completes at all.

### 1.3 What actually works today

This matters as much as what does not, and it is easy to lose.

- **The authority model is real and strict.** Where a governed command runs, it fails closed. The
  resolver denies on an inactive capability *before* checking who you are, so an inactive capability
  cannot be reached by privilege (`resolveEffectivePermission.ts:264-265`). The invoice command is
  written, tested, deployed and refuses correctly (`functions/src/finance/invoiceCallables.ts:112`).
  When EOS refuses, it refuses honestly.
- **Scheduling is the healthiest domain in EOS.** All five scheduling workflows complete — each with
  a recorded gap, none `BROKEN_MIDWAY` or `CANNOT_START`. The Owner's blocked-time ruling was
  implemented at the integrated head, the availability union arithmetic was fixed, and a cross-package
  test holds the client and server implementations in agreement.
- **Scanning completes.** All four scanner workflows complete, with gaps. The scanner shell is one of only two
  Service-domain surfaces that gates on capabilities rather than role strings.
- **Purchasing completes.** Both purchasing workflows complete — the whole reorder chain runs from
  recommendation through request, approval, purchase order and receipt, and nothing refuses. Its gaps
  are governance gaps, not refusals: the approval verbs reach no governed business role (§2.2), and two
  purchase-order collections exist with only one governed.
- **An append-only audit authority genuinely exists**, and governed commands write to it — including
  denials (`auditEventWriter.ts:606`).
- **The design work was largely right.** Wherever a design document and the code disagreed tonight,
  the design document was right far more often than not. This is unusual and it is an asset (§2.5).

### 1.4 What the business cannot do at all

Stated as the business would state it, each with the workflow record that establishes it.

| The business cannot… | Why | Record |
|---|---|---|
| **Bill a customer from EOS in production** | `finance.invoice.issue` is registered inactive; production activates nothing. The command is built and deployed. | `WF-FIN-001` |
| **Take a customer's money in production** | Same mechanism. | `WF-FIN-003` |
| **Record a technician's hours anywhere** | `workOrder.labor.record` and `.correct` are inactive **and** absent from every activation array in the repository, including the sandbox. Labour cannot be recorded in any environment EOS declares. | `WF-SVC-009` |
| **Bill a break-fix visit at all** | The billing queue anchors on a Sales Order; a repair call has none. Blocked by decision, not by code. | `WF-FIN-002` |
| **Open or work an opportunity in production** | Every `opportunity.*` id resolves DENY for all 48 roles under the production activation set. | `WF-SLS-001` |
| **Advance a Sales Order past booking, in any environment** | `salesOrder.fulfill` and `salesOrder.service` are held by `owner`, `admin` and `dispatcher` and by **no governed business role**. Activation does not fix this. | `WF-SLS-003` |
| **Price a deal from a list** | Every price on every agreement is typed by hand. No list, no schedule, no template, no history, no approval threshold. | `WF-SLS-005` |
| **Void an invoice** | The database has the columns, the projection has the state, reconciliation reads it, and no code writes it. An invoice issued in error is permanent. | `WF-FIN-004` |
| **Know what a job cost or earned** | The cost authority has not been ruled. Margin is structurally unknown and must render as unknown, never as zero. The cost engine is 425 lines and is imported by nothing. | `WF-FIN-008` |
| **Close an accounting period** | The close model is built and has nowhere to store a period. | `WF-FIN-007` |
| **Pay a supplier** | Half the money in a distribution business — what it owes — is not modelled at all. | `WF-FIN-010` |
| **Create a warehouse** | There is no registered warehouse write capability anywhere. Every warehouse in every environment came from a seed or an operator command line — for the object the ownership model calls the company boundary root. | `WF-INV-011` |
| **Rack a warehouse, or move stock between bins** | Both screens gate on capability ids that nothing ever asks the server about, so they deny for every principal in every environment, permanently. | `WF-INV-004`, `WF-INV-003` |
| **Run any report** | Every `report.*` id is inactive. | `WF-RPT-001` |
| **Create an employee record from the product** | It is a Node script. No callable, no screen, no capability row — for the most fundamental record in an access-control system. | `WF-ADM-003` |
| **Find a Company Settings screen** | There isn't one. | `WF-ADM-008` |
| **Handle warranty work** | No claim, no coverage model, no provider, no billing consequence. The route is declared in navigation with no component behind it. | `WF-SVC-020` |

### 1.5 The two facts that matter most

**First: the system is administrable and not operable.** Because of how roles are composed, every
capability in the catalogue is held by `admin`, and `owner` derives from `admin`. So the set of
capabilities held by *nobody* is empty — but the set held by **no governed business role** is 32, and
nine of those thirty-two are active and live in production right now. The whole reorder approval
chain is in that set: a Parts Manager can raise a reorder request today and cannot approve, reject or
cancel one. Only an administrator or a dispatcher can.

**Second: the commercial spine is stopped by a setting, not by a gap.** `config/environments.json`
carries 92 capability activation overrides for `platform-sandbox`, 3 for certification, and **no
`capabilityActivationOverrides` key at all** for `taylor-parts-production`. That is what makes the
production picture as bad as it is — and it is also what makes it the cheapest thing in this brief to
move. But moving it is not free, and it is not first: see §2.2 and §3.

---

## 2. The structural causes

Eighty-six workflows produced hundreds of individual findings. They are symptoms. They reduce to five
structural causes, and each of the five is argued below from the evidence rather than asserted.

The test applied to each: *would fixing every individual defect attributed to this cause, without
addressing the cause, leave the system able to generate the same defects again tomorrow?* All five
pass that test. Nothing else in the programme's findings does.

### 2.1 Cause one — EOS decides the same question in three places, and none of them is the authority of record

**The claim.** Authority in EOS is declared in one place and enforced in another, systematically, and
the place that decides is usually not the place the product shows people.

**The three deciders.**

1. **The governed capability engine** — 147 capability ids resolved against 48 roles
   (`permissionCatalog.ts`, `governedBusinessRoles.ts`, `compatibilityRoles.ts`,
   `resolveEffectivePermission.ts`). This is what Administration renders, what the product's language
   is built from, and what a user believes governs them.
2. **The legacy Firestore Rules role string** — **44 enforcement sites across 22 collections**
   branching on a `users/{uid}.role` value. `legacyAuthorizationSurface.ts:16-21` records a standing
   Owner constraint against a third authorization system existing at all.
3. **The Postgres object and field policy store** — what the Roles & Permissions screen actually
   edits.

**The evidence that these disagree in fact, not in theory.**

- **`WF-CRM-001` — five of seven capability holders are refused by the thing that actually decides.**
  `customer.record.update` is **ACTIVE** and resolves ALLOW for seven roles including `salesperson`,
  `salesManager`, `officeManager` and `generalManager` (executed at the integrated head). The write
  path is a client-direct Firestore write (`field-ops-app-vite/src/domain/accounts.js:78`) governed by
  `isAdminOrDispatcher()` (`firestore.rules:22-24`), which admits exactly `"admin"` and `"dispatcher"`.
  The capability model and the enforcing authority disagree about the same act, and **the capability
  model is the one the product shows people.**
- **`WF-SVC-005` — a Work Order's visibility is a legacy role string, and there is no capability for
  it at all.** `firestore.rules:507-508` is the only reach control, and no `workOrder.read` capability
  exists in the 147-id catalog. The most-used record in the business is governed by the layer the
  programme has a standing constraint against.
- **`WF-EQP-004` — a technician cannot read the equipment at the site they are standing on.** Equipment
  reads are gated on `isAdminOrDispatcher()` (`firestore.rules:1506`); the technician exclusion is
  deliberate and documented at `:1367-1381`. That is a Rules decision about a business question no
  capability expresses.
- **P3-A1 §2.4 — a client-writable lifecycle expressed as Rules predicates.** The legacy
  `fieldops_jobs` dispatch path encodes workflow transitions in Rules (`firestore.rules:329-334`,
  `:343-345`, `:353`) with the transaction on the client (`domain/jobActions.js:89-131`), on a
  nav-visible, still-routed production surface. The lane names the class exactly: *"authorization,
  workflow and assignment routing expressed as Rules predicates"* — the prohibited class.
- **P3-A3 §6.1 / §7.6 — the capability engine barely reaches the routes at all.** Across Sales, CRM,
  Financials, Reporting and Administration there are **four capability-guarded routes out of 62**:
  zero of six sales/CRM routes, zero of twenty financials routes, and two of nineteen administration
  routes. Everything else falls through to an `admin`/`dispatcher` default.
- **P3-A3 §7.3 — four tables answer the same question and disagree twenty-one times.**
  `access/objectPermissionMap.js:33-105` (25 objects, what Administration renders),
  `functions/scripts/governance/objectCapabilityMap.mjs:39-86` (24 objects, what the governance
  generators read), `access/policyObjectRegistry.js:123-133`, and a **fourth private copy** inside
  `scripts/reconcileCrudMatrix.mjs:100-129` — plus a fifth answer, `firestore.rules` itself, for
  objects marked `rulesOnly`. Twenty verb-level disagreements plus one object-level absence.
  **Eighteen of the twenty-one carry no recorded rationale anywhere.**

- **A live instance of the class, found by executing the shipped service: eleven governed roles are
  silently denied a capability they hold.** `recordChangeHistoryReadService.ts:284` and
  `employeeProfileCommands.ts:454` default their role set to `COMPATIBILITY_ROLES`, and
  `administrationUsersCallables.ts` never overrides it. So **eleven governed business roles that declare
  `audit.event.read` — controller, financeManager, operationsManager, owner and seven others — are
  refused by the deployed `listRecordChangeHistory`.** The capability resolves ALLOW; the service that
  enforces it never sees the role. **Neither file records this as a decision** — which is exactly what
  distinguishes it from `trustedWriterCommands.ts:1099-1110`, where the same narrowing is deliberate and
  documented. Measured through the shipped service, not read. It compounds `WF-ADM-006`: an append-only
  audit authority exists, governed commands write denials into it, and the people whose job is to read
  it cannot.

**The same cause at smaller scale, and this one is the cheapest thing in the brief to fix.**
Five capability ids are gated in client components and are **absent from the list the client asks the
trusted feed about** (`access/reportCapabilityAccess.js:30`, 44 ids). The feed is never asked, the
answer comes back `undefined`, and the fail-closed gate at `:139-148` grants only on an explicit
`true`. The result is five surfaces that are **unreachable by everyone, in every environment,
permanently**:

| Capability | Cost |
|---|---|
| `inventory.location.bin.manage` | Nobody can rack a warehouse — including `inventoryBinAdministrator`, the role built to hold it. |
| `inventory.stock.relocate` | The one scanner workflow that moves quantity can never be offered to anyone. |
| `equipment.compatibility.view` | The Part record's compatibility section is dead for everyone. |
| `financialPolicy.profile.read` / `.configure` | The financial policy profile cannot be read or configured. Activating the capability would not help. |

This is the same structure as the three deciders: the site that **declares** the requirement and the
site that **asks** for the answer are different files with nothing linking them.

**And a third condition the vocabulary cannot express at all.** Three objects rendered in
Administration → Objects have permissions that are **not expressible as capabilities** —
`objectPermissionMap.js:92` marks Equipment `rulesOnly` with empty create, read, edit and delete
lists, and Contacts (`:36`) and Customer Locations (`:37`) are the same. P3-A1 §1.2 names this as *a
third and distinct condition from both "ungranted" and "inactive."* Worse, P3-A3 §7.4 found that the
Administration policy seed **drops the `rulesOnly` marker**, so inside the tenant policy store a
Rules-governed object is indistinguishable from an unmodelled one — Contacts looks like Marketing
Initiatives.

**And a fourth: an authority that is checked and does not exist.** Six capability ids are named in
code or design and are **absent from the 147-id catalog** (executed against all 147):
`inventory.warehouse.status.set` (whose own source comment at `warehouseStatusWriter.ts:23` admits
*"Referenced by string only"*), `inventory.cycleCount.close`, `financial.intercompany.classify`,
`report.export`, `report.definition.share`, and the whole `budget.*` family that two Financials pages
draw five actions over.

**Why this is a cause and not a symptom.** Every one of the above is the same act: someone declared an
authority in the place that was natural for their work, and someone else enforced it in the place that
was natural for theirs, and nothing in the system requires the two to be the same place. Fixing the
customer-write gap, the five client gates and the twenty-one table disagreements one by one leaves the
mechanism intact. **The decision that removes the mechanism is naming one authority of record, and
that is why it is the first decision in §3.**

### 2.2 Cause two — capability is granted to administrators by construction, so "governed" does not mean "reachable by a job"

**The claim.** EOS grants capabilities to a role that is defined as *everything*, not to the jobs
people do. That single construction produces a measurement trap, a governance gap, and a live
operational hole, all at once.

**The mechanism, in one line of code.** `functions/src/access/compatibilityRoles.ts:235-240` builds
the `admin` compatibility role as its curated list **plus every remaining id in the catalogue**. The
code's own note at `:228-234` records this as a deliberate choice and anticipates that internal-control
exclusions would live in an explicit exclusion list — **which does not exist.** `OWNER_PERMISSIONS`
composes from `ADMIN_ROLE`, so `owner` is a second derived holder of everything.

**What that construction produces.**

1. **Zero of 147 capabilities are held by nobody.** Not a reassurance — a consequence of the spread.
   Any measurement that looks for "held by nobody but `admin`" also returns zero, because `owner` is
   always there too. This is the single most expensive measurement trap in the programme; see §6.1.
2. **Thirty-two capabilities are held by no job someone does.** There are 45 governed business roles
   and 3 compatibility roles (`admin`, `dispatcher`, `technician`). Excluding all three compatibility
   roles, 32 capabilities reach no governed business role at all. (The circulated figure of 21 is
   measured differently and both belong in the record — §6.2.)
3. **Nine of those thirty-two are ACTIVE and live in production right now.** The entire reorder
   approval chain — `reorder.request.approve`, `.reject`, `.cancel`, `.markReceived`, `.read.own`,
   `.create.system`, plus `reorder.purchaseOrder.void`, `inventory.action.create` and
   `inventory.analytics.read` — is held by `owner`, `admin` and `dispatcher` and by no governed
   business role. A Parts Manager can raise a reorder request today and cannot approve, reject or
   cancel one.
4. **The order-to-cash chain has a step in the middle that belongs to no job.** `salesOrder.fulfill`
   and `salesOrder.service` are held by `owner`, `admin` and `dispatcher` only. Executed in the
   sandbox — where the activation gate is lifted — `salesperson`, `generalManager` and
   `operationsManager` all resolve `DENY/noQualifyingGrant`. **This break survives activation**, which
   is why it ranks above several larger-looking problems. The only non-administrator who can advance a
   Sales Order is the dispatcher, who is deliberately excluded from billing authority a few lines away
   in the same file.
5. **Activation and administrator grant are the same act.** `WF-ADM-004`: activating any capability
   for an environment immediately grants it to every administrator and owner in the system. There is
   no way to turn something on for a business role without also turning it on for everyone with
   administrative access. This is why the activation decision in §3 cannot be taken first.
6. **A role built for a job cannot complete the job.** `report.definition.delete` is held by `owner`
   and `admin` only, so the `reportAuthor` role — the job built for exactly this — can create, rename
   and duplicate its own saved report definitions and cannot delete them (`WF-RPT-002`). The four
   `equipment.compatibility.*` ids are held by `owner` and `admin` only **and** are among the 17
   capabilities dead in every environment — the clearest case in the registry of a capability that is
   granted in the letter and reaches no job in the fact (`WF-EQP-005`).

**And there is a third gate under all of this. It is real, it is enforced, and it is the honest limit
of everything in this section.** P3-B2 states the inventory authority model as **three gates, not
one**: (1) the catalogue activation flag, which denies unconditionally; (2) the per-environment
activation override; and (3) a qualifying role grant — with the warning in its own capitals:
***"ACTIVATION IS NOT A GRANT. Declaring a Role grants nothing; a principal holds it only via a
governed, audited roleAssignment."***

**The third gate has since been executed against the shipped code and it behaves exactly as designed.**
`roleAssignments` is read per-request at nine or more sites and is the **sole** source of an ALLOW: no
assignment resolves `DENY/noQualifyingGrant`; a disabled assignment denies; an assignment whose
`accessVersionAtGrant` is stale denies. It is both read and written — the store is live infrastructure,
not a declaration, and an either/or framing of "declared versus live" does not hold for it.

**What that leaves genuinely open is narrower and should be stated exactly.** Every capability figure
in this brief — the 37, the 21, the 32, the 17 — describes what roles *hold*, verified through the
resolver. **What no lane has measured is whether any human being is actually assigned any of these
roles in any environment**, because that requires reading live Firestore and no lane reached for it.
P3-A2 flagged the same limit for four specific roles: *"whether any `inventoryPutAwayOperator` /
`inventoryBinAdministrator` / `inventoryStockRelocationOperator` / `inventoryLookupReader` role
assignment actually exists in a live environment — declarations were read; assignment data is
runtime."*

**The distinction to hold onto: capacity is proven, occupancy is unknown.** The roles can hold the
capabilities and the store can carry the assignment; whether anybody is in the seat is the single
highest-priority live-data measurement Design P2 should take. See §5.2 and cutover condition C6.

**The measurement consequence, which cost this programme more than the governance gap did.** A grant
cannot be read from the role file; it must be resolved. P3-A3 §2 states the rule that every lane
should have been working to: *"'no Role holds capability X' is not a claim any grep can support."* It
cites a finding withdrawn once already for exactly this reason (#1743, on `finance.visibility.*`). And
P3-A2 — in the same document that warns other lanes against the grep, three paragraphs earlier —
concluded that `equipment.compatibility.view` was ungranted by reading `governedBusinessRoles.ts:1471`.
Resolved at the integrated head, its holders are `owner` and `admin`. **This is not carelessness. It
is what happens every single time a grant is read from a role file instead of resolved through the
resolver**, and it happened to the lane that had just written the warning.

**One claim that was carried as the domain's highest-priority unknown has since been resolved, and the
answer is the reassuring one.** P3-A3 raised, as the most urgent re-measurement in Administration,
*whether `readGovernedList` resolves only against `COMPATIBILITY_ROLES`, which would make the 45
governed business roles declarations rather than live authority.* **Resolved by executing the shipped
resolver: it does not. `readGovernedList` does not exist at the integrated head at all** — it lives on
the divergent, unmerged branch `feat/rules-out-of-firebase` as
`functions/src/access/governedListReadService.ts:387`, confirmed not an ancestor of the integrated head
and contained by that branch alone. On that branch the finding is accurate (`:392` and `:535` both
default `deps.roles ?? COMPATIBILITY_ROLES`). **P3-A3 generalised a branch-local finding to the
mainline, and so did an earlier draft of this brief.**

**At the integrated head the 45 governed business roles are live authority.** Executed: 3 compatibility
roles plus 45 governed roles, 147 capabilities, 21 held only by `admin`/`owner`, 0 held by no role —
reproducing the programme's headline figures exactly. **47 of the 48 roles resolve ALLOW for something**;
the single inert one is `generalEmployee`, which declares zero permissions by design. And all 45
governed roles are grantable — every one appears in `trustedWriterCommands`' `ASSIGNABLE_ROLES`
allowlist, so **zero of them are unassignable.**

**This matters for how the rest of this brief should be read.** Every role-level number in it describes
a working system, not a model of one. The governance gaps in §2.2 are real gaps in a live authority
engine — which makes them worse, not better, than they would have been if the role layer had turned out
to be decorative.

**Two corrections to standing counts fall out of the same run.** The governed-role total is **45**, not
the 43 the reconciliation document states. And `trustedWriterCommands.ts:185`'s comment claiming "all
15" is stale — the literal beneath it carries all 45. (Both are §2.5's pattern again: the comment is
wrong and it understates what exists.)

**The merge hazard this creates, and it should be gated.** If `feat/rules-out-of-firebase` merges as it
stands, P3-A3's finding stops being branch-local and *becomes true of the mainline*. That branch must
not merge without the default resolved. It is cutover condition **C16**.

### 2.3 Cause three — the build outran the ruling, and the design record was never committed

**The claim.** EOS's largest category of breakage is not defects. It is halves. A decision was
correctly deferred on one side of a seam, and the other side shipped anyway. Thirty-five of the 86
workflows stop because the next step was never written; fifteen stop because a decision is pending;
and the twelve cross-domain seams P3-D identified are, without exception, this shape.

**The finding, in P3-D's own words:** *"Not one of these seams is a bug in either domain. Each is a
place where a decision was correctly deferred on one side and the other side shipped anyway."*

**The evidence that it is systematic.**

- **Deferred, then shipped anyway — named in the design, built regardless.** The coordinated-visit
  design says *"the consuming Field/Dispatch UI is deferred (data pipeline is inert until grants/
  deploys land)."* Two consuming surfaces shipped and are routed
  (`modules/service/CoordinatedVisitsWorkspace.jsx`, `modules/mobile/CoordinatedMissionView.jsx`,
  `App.jsx:505-511`). The result is two routes rendering a governed, honest, well-designed read over a
  projection **with no command on either route that moves it forward** (`WF-SVC-012`). The same shape
  recurs at `/financials/billing-queue`, `/financials/credits-adjustments` and
  `/administration/workflows`.
- **A design explicitly not authorised for implementation, with the unsafe path live in its place.**
  `docs/specifications/reorder-trusted-command-authority.md:3` reads *"gate: Owner decision — DESIGN
  ONLY, not authorized for implementation"*, and its own framing at `:19` calls it *"a Tier-2 authority
  change."* Meanwhile **eight of the ten reorder lifecycle transitions are direct client Firestore
  writes**. The safe version is designed and blocked; the unsafe version is in production.
- **Twenty routes over a design whose final status was never "ready for implementation."** The
  Financials design direction is APPROVED and its final status is
  `READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW` — **never `READY_FOR_IMPLEMENTATION`**. All
  twenty routes exist. P3-A3 calls this *"the single most misleading fact in my domain."*
- **Built and imported by nothing.** Six finance modules have zero importers anywhere in the codebase:
  `billingQueue.ts`, `forecasting.ts`, `costMargin.ts`, `financialAllocation.ts`,
  `inventoryCostEngine.ts` (425 lines), and `financialReconciliation.ts` — the last described by its
  own lane as *"a detector that is never run."*
- **Built and reachable by nobody.** The Sales Territory / Coverage authority is a complete entity —
  collection, commands, resolver — with no read capability for the object, no update command and no
  route. Administrator-initiated password reset is built end to end across 798 lines
  (`adminCredentialCommands.ts`), exported from `index.ts:225-227`, and activated in no environment at
  all. The accounting close model is built and has nowhere to store a period.

**And the other meaning of "never committed": most of the design record is not in the repository.**
This is the quietest and possibly the most expensive fact in the programme.

- **P3-A1:** Work Order and Technician Mobile — two of that lane's four domains — have **no
  recoverable design artifact at all**. Eight cited design sources were never committed to the
  repository at any commit on any branch.
- **P3-A3:** **twenty** `.dc.html` design artifacts that governed Sales, CRM, Financials and
  Administration were never handed to the repository and never existed on any branch — including the
  approved Account record visual authority. A later session cannot re-verify what Customer 360 was
  accepted against.
- **P3-A2:** thirty-two design canvases exist in the whole repository and **exactly two** are in
  Inventory/Warehouse/Purchasing/Scanner — *"two of roughly twenty-five routes in this domain have a
  design source at all."*

**The distinction that matters, and must not be lost.** Deferring a decision is not the failure. Some
of the best work in EOS is a recorded refusal to guess: `WF-FIN-009` (intercompany) is blocked by
FIN-BLOCK-004, an explicit Owner block, and P3-D calls it *"the registry's clearest example of a
workflow that is blocked correctly — a recorded refusal to guess, not a gap."* DECISIONS #143 forbids
inferring a Work Order's operating company from its technician, dispatcher, creator, customer or
location, and that refusal is correct. **The failure is shipping the other half of a seam whose
decision is still open, and then not recording that you did.**

**Why this is a cause.** Every one of the 106 open Owner questions is downstream of it. You cannot
engineer your way out of 15 workflows blocked on `OWNER_DECISION_PENDING`, and you cannot even
identify them reliably when the design that framed them is not in the repository. This is the cause
that makes Design P2 necessary rather than optional.

### 2.4 Cause four — production's condition is a setting, not a state, and the setting is welded to three other things

**The claim.** The gap between what EOS can do and what EOS does in production is, to a first
approximation, one configuration file. That makes it the highest-leverage item in the brief. It also
makes it dangerous, because activation is currently indivisible from three other effects.

**The measurement.** 109 of 147 capabilities are registered `active: false` — 74% of the catalogue.
`config/environments.json` carries **92** capability activation overrides for `platform-sandbox`,
**3** for certification, and **no `capabilityActivationOverrides` key at all** for
`taylor-parts-production`. The resolver denies on `active === false` plus no override **before**
checking grants (`resolveEffectivePermission.ts:264-265`), so the switch beats the grant every time.
Result: **37 of 147 capabilities are allowed to anyone anywhere in production, and not one of them is
commercial.**

**What is welded to the switch.**

1. **Administrator grant.** Activating anything grants it to every administrator and owner
   (§2.2, `WF-ADM-004`). There is no exclusion list.
2. **Latent defects that become live defects.** P2-D's `BLOCKS_CUTOVER` category exists for exactly
   this, and states it plainly: *"latent today, live on activation… Turning any of these on without
   the corresponding decision converts a latent defect into a live one."* Concretely: activating
   `report.*` exposes a row-scope defect — `reportExecutionService.ts:420` hardcodes the authorization
   target to `global` over an unfiltered collection scan, so a holder of an object capability would
   see every row and a grant at `ownAssignment` or `location` scope would not resolve at all.
   Activating `salesOrder.fulfill` exposes both a missing per-part reservation lock and an allocation
   path that is operating-company blind (`allocateSalesOrder.ts:117-121` builds its eligible pool from
   `status == ACTIVE` warehouses with **no company predicate**).
3. **Nothing about reachability.** Activation does not create a holder. `salesOrder.fulfill` resolves
   DENY for every governed business role in the sandbox, where it is activated.

**And there is a fourth switch layer that is not an authority layer at all.** Three compile-time
constants — `RECEIVING_TRANSPORT_READY`, `PART_MASTER_WRITE_READY`, `TRUCK_MANAGEMENT_WRITE_READY` —
are resolved per environment from `config/environments.json` through `vite.config.js:113`'s
`__APP_READINESS__` define. While one is false the client makes **zero callable attempts**: no
refusal, no error, nothing reaches the server. The repository states the distinction itself and is
worth quoting, because it is the clearest sentence anyone in this codebase has written about its own
governance: *"READINESS IS NOT AUTHORIZATION, and readiness true does not mean 'activated'"*
(`partMasterWriteReadiness.js`). This is a **release gate**. It has a different owner and a different
fix from an authority gate, and none of the programme's blocking vocabulary can express it.

### 2.5 Cause five — the repository cannot be trusted to describe itself

**The claim.** The artifacts a reader would naturally use to learn EOS's condition — code comments,
generated census artifacts, and quoted figures — are the least reliable artifacts in it. The design
documents, which a reader would naturally trust least, were right nearly every time. This inverts how
the next phase must read the codebase, and it is the reason several lanes produced false findings tonight.

**Code comments are the least reliable artifact class in this repository.**

- **Five comment blocks in `functions/src/index.ts` and one in `firestore.rules` assert that certain
  capabilities are "granted to nobody."** All are false, and the disproof was executed, not argued.
- **`field-ops-app-vite/src/modules/scheduling/SchedulingWorkspace.jsx:25`** still asserts at the
  integrated head that *"true 'reschedule' is NOT a deployed transition."* `rescheduleWorkOrderCallable`
  has been deployed and certified since 2026-08-27.
- **`field-ops-app-vite/src/access/reportAccess.js:30`** says the `report.definition.*` ids are "all
  active"; `permissionCatalog.ts:907-941` registers all five `active: false`. One is wrong and no
  reconciling decision record exists. (UNPROVEN which.)
- **`field-ops-app-vite/src/metadata/definitions/receivingOrder.js:18-20`** states that *"no function
  anywhere in this repository reads back a `receiving_orders` document by id, by query, or in bulk."*
  Two of the readers are by query and one is in bulk. P3-A2 flags the hazard exactly: a future reader
  who believes that sentence is free to change the stored shape and silently break part balances.
- **`functions/src/access/trustedWriterCommands.ts:185`** claims the assignable-role allowlist carries
  "all 15". The literal beneath it carries all 45. Stale in the same direction as every other stale
  claim in this repository: understating what exists.
- **Four more source comments repeat the stale "granted to no Role" claim** —
  `services/binCommandClient.js:4`, `services/stockMovementClient.js:4`,
  `hooks/useLocationDisplaySource.js:12`, and `docs/implementation-plans/
  bin-location-authority-and-scanning.md:99`.
- P3-A2's summary for its whole domain: *"Every 'granted to no Role' sentence written into this
  domain's design documents and source comments during August 2026 is now stale, and several were
  never true. Source comments repeating the stale claim should not be trusted."*

**The design documents were right, and in the one reverse case the design corrected the code.**
P3-A1 found `AvailableEquipment.jsx:17-25` recording that it *used* to assert
`inventory.serializedAsset.read` was "granted to no Role" and failed closed in every environment — and
records that the Equipment P1v2 design corrected the repository, *"the only case in this domain where
the design was ahead of the code comments."* P3-A1's pattern statement for the whole domain is worth
carrying verbatim: **"in this domain, the stale claim is always 'it does not exist.' Three documents
asserted absence; all three shipped. No document was found over-claiming a capability."**

**Generated artifacts age badly and are quoted as if they had not.** P2-D item 7g asserted that
administrator password reset had *"no server code implementing it,"* citing `capability-graph.json`'s
`serverReferenceCount: 0`. The command is 798 lines and both callables are exported. P2-D itself
elsewhere records that the capability graph is staler than its own stale-reference counter suggests.
The finding was wrong because the artifact was old, not because the reading was careless.

**Tests are registered and still cannot fail.** The guard that should catch the five unreachable
client gates is a tautology: `field-ops-app-vite/test/navCapabilityConvergence.test.mjs:147-151`
asserts that `GOVERNED_SURFACE_CAPABILITY_IDS ⊆ REPORT_CAPABILITY_REQUEST`, and
`REPORT_CAPABILITY_REQUEST` is **defined by spreading `GOVERNED_SURFACE_CAPABILITY_IDS` into it**. The
subset relation is true by construction, the test can never fail, and it reads component gates not at
all. It is registered in `suites.json:541` and it passes. The one real guard of this shape,
`dashboardComposition.test.mjs:460-477`, greps the *source* of one file for `has(ctx, "…")` call sites
and diffs them against the request — exactly the right idea, hardcoded to one file. Four
post-acceptance correctives to My Dashboard were fixes for this same defect class. Separately: 37
frontend `.test.mjs` suites are absent from `suites.json`, and **263** if `.test.jsx` is included.
Registration is not coverage, and in this repository passing is not evidence either.

**Numbers circulate without denominators, so the same fact reads as three different facts.** Every
contested figure in this programme is a denominator disagreement, not a factual one. P3-A3 was candid
about its own instance: its first measurement, `grep -c 'active: false'`, returned **119**; ten of
those hits were comment prose; the property count is **109**. Its proposed standing rule is the right
remedy and this brief adopts it:

> **A capability claim must state (a) the file, (b) the predicate that produced the number, and
> (c) the definition of the denominator. "Granted to no Role" is not a claim any grep can support and
> should be refused on sight.**

**One more pattern worth carrying, because it should change how a reader feels about bad news.**
P3-D §6.3 and P3-A1 §6 independently observe that **the direction of every stale claim in this
programme is understating what exists.** Three documents asserted absence; all three had shipped. The
role-holder counts were low every time (8 → 12 → 15). The capability denominators were low. Nothing in
the programme found a document over-claiming a capability. EOS is consistently better built and worse
switched-on than its own records say.

**The reliability order this implies, for the next phase:**

1. **The resolver, run.** The only thing in the programme with executed evidence behind it.
2. **Source code, read at a named commit.** Reliable, and the reason every citation here carries one.
3. **Design documents.** Right far more often than the code that implemented them.
4. **Generated census artifacts.** Accurate on the day they were generated and quoted long after.
5. **Code comments.** Assume stale until re-verified.

---

## 3. What Design P2 must decide, in order

### 3.0 How this order was chosen, and one caution

**The consolidated Owner-question set is 106** — 71 de-duplicated from P3-B3's 58 and P2-D's 20, plus
25 raised first by the consolidation lane, 6 restored from activity level, and 4 raised only by an
archaeology lane. They are all in the registry's JSON companion under `owner_questions`, with
provenance and cross-references. **This section does not restate them.** It names the thirteen that
gate the rest, groups the remainder, and says where to find them.

**The ordering principle is dependency, not severity.** The worst problem in EOS is that the business
cannot bill a customer. That is not the first decision, because the decision that fixes it — turning
capabilities on in production — currently also grants them to every administrator, and currently also
converts several latent defects into live ones. Decisions are ordered here by *how many other
decisions become answerable once this one is made*.

**A caution about the registry's `gates` numbers, because they will mislead if read directly.** The
registry records, for each question, how many of the 86 workflows have their break point waiting on
it. `OQ-ACT-05` — *which of the three authorization systems is the authority of record* — shows a
`gates` value of **1**. That is correct and it is not the point. It gates one workflow's break point
and it changes the *meaning of the answer* to roughly thirty other questions. **`gates` counts
workflows, not decisions.** The ordering below counts decisions.

---

### GATE 0 — Two decisions that must be made before the others mean anything

#### D1. Name the authority of record. `OQ-ACT-05`

**The question.** EOS decides authorization in three places: a legacy Firestore Rules role string
(44 sites, 22 collections), the governed capability engine (147 capabilities × 48 roles), and the
Postgres object and field policy store. `legacyAuthorizationSurface.ts:16-21` records a standing Owner
constraint against a third existing. **Which two survive, and which one is the authority of record?**

**Why first.** Almost every other authority decision in the set is conditional on this answer. If the
capability engine is the authority of record, then 44 Rules sites must be rewritten, the 21 disagreements
across the four capability tables must be reconciled, the three `rulesOnly` objects must become
capability-expressible or leave Administration, and the six capabilities named in code but absent from
the catalogue must be registered. If Firestore Rules is the authority of record, then the capability
model is advertising, the Administration screens are misleading users about what governs them, and
most of §2.1 is a labelling problem rather than an enforcement one. **The same evidence supports
opposite remedies depending on this answer**, and thirty-odd questions below inherit it.

**What it does not decide.** It does not decide who holds what. It decides where the answer lives.

**One thing that was a precondition on this decision no longer is.** P3-A3 raised *whether
`readGovernedList` resolves only against `COMPATIBILITY_ROLES`*, which would have made the 45 governed
business roles declarations rather than live authority and would have changed what D1 is choosing
between. **Resolved by execution: it does not, and the function does not exist at the integrated head**
— it is branch-local to the unmerged `feat/rules-out-of-firebase` (§2.2). **D1 is therefore a choice
between three working authorities, not between one real one and two facades.** That makes it a harder
decision and a cleaner one.

**What D1 is actually choosing between, stated precisely.** Each of the three authorities reads a
*different store* for the same principal's roles: Firestore Rules compares `users/{uid}.role` as a
string; the capability engine reads `roleAssignments` per request; the Postgres path uses a different
table again, `eos.user_role_assignments`. **Naming an authority of record therefore also names which
role store is the truth**, and reconciling the other two — or retiring them — is the work the decision
commits to.

#### D2. Decouple activation from administrator grant, or accept the coupling in writing. `OQ-ACT-03`

**The question.** `compatibilityRoles.ts:235-240` constructs the `admin` role as a curated list plus
every remaining catalogue id, and `owner` composes from it. Therefore **activating any capability for
any environment immediately grants it to every administrator and owner in the system.** The code
anticipates that internal-control exclusions would live in an explicit exclusion list at `:232-234`;
that list does not exist. Should activation and administrator grant be separated?

**Why before D3.** D3 is the single largest unlock in this brief and it is an activation decision.
Taken today, every capability it turns on is also an unreviewed grant of that capability to every
administrator. For a finance capability set that includes issuing invoices, applying payments and
crediting, that is a separation-of-duties question the business should answer deliberately rather than
inherit as a side effect. **This is the only decision in the set whose cost of being taken second is
irreversible in practice** — once the spine is activated it will not be deactivated to revisit this.

**What it does not decide.** It does not decide whether administrators *should* hold these
capabilities. It decides whether the system is capable of expressing that they do not.

---

### GATE 1 — The three decisions the commercial system waits on

#### D3. The production activation sequence for the opportunity-to-cash spine. `OQ-ACT-01` — 10 workflows

**The question.** What is the sequence and the gating condition for activating the commercial
capabilities in production — and is `platform-sandbox`'s 92-id array the intended production target,
or a superset that needs trimming?

**What it unblocks.** More than any other single decision: `WF-XD-001` (the full commercial spine),
`WF-FIN-001` (billing), `WF-FIN-003` (payment), `WF-SLS-001` (opportunities), `WF-CRM-005`
(Customer 360), `WF-RPT-001` (reporting), `WF-RPT-004` (goals), `WF-ADM-005` (email intake
configuration), `WF-EQP-002` (installation), `WF-INV-008` (truck loading).

**Why here and not first.** It depends on D2 for the reason above, and it must be taken *with* D5 —
see below — because activating a capability that no job holds converts a `CANNOT_START` into a
`BROKEN_MIDWAY` and calls it progress.

**What it must be taken alongside, from P2-D's `BLOCKS_CUTOVER` list.** P2-D's framing is exact:
*"latent today, live on activation… Turning any of these on without the corresponding decision
converts a latent defect into a live one."* Specifically, activating `report.*` exposes the
hardcoded-`global` row-scope defect at `reportExecutionService.ts:420`; activating `salesOrder.fulfill`
exposes both the missing per-part reservation lock (P2-D item 5) and the company-blind allocation pool
(P2-D item 1, and D8 below).

#### D4. The seventeen capabilities that can run in no environment at all. `OQ-ACT-02` — 7 workflows

**The question.** Seventeen capabilities are registered inactive **and** absent from every activation
array in the repository, including the sandbox: labour recording (`workOrder.labor.record` and
`.correct`), four of the five finance reach scopes, both coverage ids, three report fields,
administrator password reset, the four `equipment.compatibility.*` ids, and `equipment.model.manage`.
**For each one: awaiting security review, awaiting design, or abandoned?**

**Why here.** Two of the seventeen — labour record and correct — are the input side of the most common
revenue event in a field-service business. D12 (how a break-fix visit is billed) cannot be
operationalised until labour can be recorded somewhere. And the question is cheap: for most of the
seventeen the honest answer is probably "abandoned," and saying so retires the surfaces and the
questions attached to them.

**What it does not decide.** It does not activate anything. It classifies.

#### D5. Which named jobs hold the acts — and, separately, who holds the jobs. `OQ-SLS-05` and the 32-id set

**The question, in three parts.**

1. **Which governed business role allocates stock against a booked Sales Order, and which raises its
   service visit?** Today neither `salesOrder.fulfill` nor `salesOrder.service` is held by any
   governed business role. This break survives activation, so D3 does not fix it.
2. **Which job approves a reorder request?** Nine active, production-live capabilities — the whole
   reorder approval chain plus `inventory.action.create` and `inventory.analytics.read` — are held by
   `owner`, `admin` and `dispatcher` and no governed business role. This is broken **today, in
   production**, not on activation.
3. **The prerequisite nobody has done: map every job in the business to a governed role id, once,
   deliberately, against the resolver.** P3-D recorded this as a refusal rather than an omission and
   its reasoning should be adopted verbatim: *"Inferring a governed role id from a job title is the
   same class of error as inferring a grant from a grep: the answer looks obvious and the resolver is
   the only thing that knows."* The three activity libraries use three different naming systems for
   the same jobs (8, 14 and 18 distinct values), none of which is the repository's, and two named
   personas appear in two libraries with **different job titles** — the same modelled person is a
   Service Coordinator in one library and a Parts Manager in the other. **Nothing can be validated
   against jobs until this mapping exists.**
4. **And then check that anybody actually holds those roles.** Declaring a role grants nothing; a
   principal holds a capability only through a governed, audited role assignment, and **no lane
   verified that a single one of these role assignments exists in any environment.**

**Why alongside D3, not after.** Activating the spine without answering this produces an order that
can be booked and advanced by nobody with a business job title. That is a worse state than the current
one, because it looks like progress.

---

### GATE 2 — Two decisions that make built things reachable

Both are gated on D1 only, and both are cheap.

#### D6. The five surfaces nobody can ever reach, and the guard that cannot fail. `OQ-GATE-01` — 5 surfaces

**The question.** Five capability ids are gated in client components and absent from
`REPORT_CAPABILITY_REQUEST`, so the trusted feed is never asked and the gate denies for every
principal in every environment, permanently. Is the fix the five-id addition to the request set
(44 → 49, inside the feed's 100-id bound), and should the convergence guard be rewritten so it can
fail?

**Why it matters out of proportion to its size.** It costs the business the ability to rack a
warehouse, to move stock between bins with a scanner, to see which parts fit which machine, and to
read or configure the financial policy profile — and the test registered to catch this class asserts a
relation that is true by construction. Four post-acceptance correctives to one dashboard were fixes
for this same defect. **The engineering is an afternoon. The reason it is a decision and not a ticket
is that it needs D1's answer about whether client-side capability gating is the model at all.**

#### D7. The authorities that do not exist, and the objects that cannot have one

Four questions that are one decision once D1 is answered: **if the capability engine is the authority
of record, everything Administration governs must be expressible in it.**

- **Six capabilities are checked in code and absent from the catalogue** —
  `inventory.warehouse.status.set`, `inventory.cycleCount.close`, `financial.intercompany.classify`,
  `report.export`, `report.definition.share`, and the entire `budget.*` family behind five actions on
  two Financials pages. Register them or remove the references. (`OQ-INV-05`, `OQ-INV-06`,
  `OQ-FIN-17`, `OQ-RPT-02`.)
- **Three objects are not capability-expressible at all** — Equipment, Contacts and Customer Locations
  are marked `rulesOnly` with empty verb lists, and Administration renders them anyway. Give them real
  capabilities, or record honestly that they are Rules-governed. (`OQ-LEDGER-Q8`.)
- **The `rulesOnly` marker is dropped by the policy seed**, so inside the tenant policy store a
  Rules-governed object is indistinguishable from an unmodelled one. Carry the marker. (`OQ-ADM-02`.)
- **Employees has no capability row in any of the four tables** — create is a Node script under an
  `if false` Rules block, update is a governed audited callable, deactivate is two different
  mechanisms, and read is Rules-only. The most fundamental record in an access-control system is the
  one Administration cannot describe. (`OQ-LEDGER-Q7`.)

**Why after D6 and not before.** D6 is a bounded list of five. D7 is open-ended, and its scope is
entirely determined by D1's answer.

---

### GATE 3 — Two decisions that must be made before records are created at scale

These are here, ahead of the money decisions, for one reason: **every day they are not made, more
records are created that will have to be corrected later.**

#### D8. The operating-company cluster. `OQ-COMP-01` … `OQ-COMP-06` — 6+ workflows

Six questions, one decision area. They must be taken together because each answer constrains the
others.

- **May a Ventana Sales Order be fulfilled from a Taylor warehouse — or from a warehouse whose company
  nobody has recorded?** Today: yes to both, silently. `allocateSalesOrder.ts:117-121` builds its
  eligible pool with no company predicate. (`OQ-COMP-01`)
- **Does a Work Order carry its own operating company?** If yes: required at creation — refusing the
  19 of 30 that have no source — or inherited from its Sales Order, which covers 11 of 30? If no: how
  is a reservation attributed at all? **Creation is the only capture point that avoids a later
  backfill, and the create wizard does not ask.** (`OQ-COMP-02`)
- **What do four record families inherit their company from now?** Inventory transaction, inventory
  action, transfer and cycle count were declared to inherit from a stock location; the 2026-09-12
  ruling retired that hop and did not name a replacement. **This question is newer than every document
  that would answer it.** (`OQ-COMP-03`)
- Plus: what closes the "census gate" that `commercialCompanyScope.ts:27` names as the precondition for
  enforcing the company at all (`OQ-COMP-04`); what the correcting act is when a deal was booked to the
  wrong company and invoices have issued (`OQ-COMP-05`, and see D13); and whether a mixed-company
  purchase order is refused or split (`OQ-COMP-06`).
- **And the object underneath all of it: who creates a warehouse?** The ownership model calls a
  Warehouse the company boundary root. There is no registered warehouse write capability; the writer
  declares itself inert and unexported; every warehouse row in every environment came from a seed or an
  operator command line. The company boundary cannot be operationalised over an object the product
  cannot create. (`OQ-INV-06`.)

**Why before the money decisions.** Intercompany treatment, consolidated financial figures, margin by
company and the whole reconciliation question all presume a company on the record. There is one today
enforced in exactly **one** place in the entire system — AR cash application, which checks the company
and fails closed on a mismatch or a null.

#### D9. Record identity — adopt the standard for new records, or do not

**The question.** A record-identity standard has been designed and is **PROPOSED, not decided**. It
gives every first-class record one permanent, meaningless machine-generated id whose first four
characters name the object type, replacing the **seven** different id-generation strategies in use
today. It is explicitly forward-only: *"No existing identifier is rewritten by adopting this standard
as written… adopting it does not require migrating anything."*

**Why it is in Gate 3 despite being cheap.** Because the cost of deferring it is linear in time.
Every record created before the decision is a record in one of the seven old schemes. Adoption for new
objects costs nothing and blocks nothing.

**Three things it depends on, which are real work and should be scheduled as such.**

1. **Id generation is duplicated seven ways on the server and eight on the client** — five
   byte-identical private copies of the same `newId` helper plus two inlined variants and a bare
   `randomUUID()`. Centralising generation has fifteen insertion points, not one.
2. **Two objects cannot conform without a prior authority change.** Accounts and Equipment are still
   written client-direct under `firestore.rules`, and a client-direct create mints its id in the
   browser. They need a trusted create command first. **This is D1's answer arriving as an
   implementation prerequisite** — the two causes are the same cause.
3. **Audit event ids double as the idempotency mechanism** and cannot become random ids without
   replacing that mechanism first. The census calls this *"its own change with its own proof and
   probably its own quarter."*

**What must be decided separately and is not this decision.** *Which* existing objects ever convert,
and when. The census is explicit that some may never convert, and that conversion is *"object by
object, on that object's own schedule, never as a platform event."*

**One thing this standard does not fix, and must not be sold as fixing.** The Work Order number can
silently restart at `000001` if its counter document is lost, there is no unique constraint anywhere,
and the `counters` collection is unreadable by any client so no surface can see the collision. The
census states it plainly: *"This is a BUSINESS NUMBER defect, not a Record ID defect."* It is
independent, cheap, and should be fixed on its own.

---

### GATE 4 — The money decisions

Each is blocked on its own root, and all four are downstream of D3 and D8.

#### D10. What is the cost authority? `OQ-FIN-10` / FIN-BLOCK-003

Margin is **structurally unknown** — not missing data, an unruled authority — and the binding display
rule is that it must render as unknown rather than as zero. `inventoryCostEngine.ts` is 425 lines and
is imported by nothing. This gates inventory month end (`WF-INV-016`) and job margin (`WF-FIN-008`),
and nothing downstream of either can be computed until it is answered.

#### D11. Which system is the authority of record for financial figures — EOS or the accounting system? `OQ-FIN-19` / #145

**This is the question that collapses the most others.** If the accounting system is the authority of
record, then accounts payable (`OQ-FIN-18`), customer statements and dunning (`OQ-FIN-12`), the
accounting close cadence (`OQ-FIN-09`) and much of the reconciliation work (`WF-FIN-011`) leave EOS's
scope entirely and four or five open questions close with them. If EOS is, they all remain open and
several become build decisions. External reconciliation is blocked at the root until it is answered,
and `financialReconciliation.ts` is a divergence detector that is never run.

#### D12. How is a break-fix service visit with no Sales Order billed? `OQ-FIN-02` — 4 workflows

The most common revenue event in a field-service business has no path. The billing queue anchors on a
Sales Order (FIN-BLOCK-002) and a repair call has none, so the output end is blocked by design; and
labour cannot be recorded in any environment, so the input end is blocked by D4. **Steps one to five
of that path work. The two steps that turn work into money do not.** Depends on D4 and D11.

#### D13. Is there a correcting act? — six questions, one principle

Stated separately because it is one design principle, and ruling the six instances apart guarantees
re-asking it.

**EOS has no undo for anything commercial.** An invoice cannot be voided, and the database has the
columns, the projection has the state and reconciliation reads it (`OQ-FIN-01`). A customer, contact
or location created in error has no correcting act — delete is refused everywhere, no merge or void
command exists, and the field the design named for it appears in no code (`OQ-CRM-07`). A deal booked
to the wrong operating company cannot be reclassified: the company is deliberately immutable
downstream, invoices cannot be voided, and no intercompany record may exist (`OQ-COMP-05`). A unit
installed at the wrong customer stays there — install has no uninstall, return or replacement on
either path (`OQ-EQP-01`). A part consumption recorded twice from a scanner cannot be undone or
corrected, and there is no running total (`OQ-SCN-01`). A job handed from one technician to another
mid-execution leaves the execution record attributed to the first (`OQ-SVC-05`).

**The decision is the principle: for which acts does EOS owe the business a reversal, and what shape
does a reversal take — a compensating record, a governed void, or a refusal to allow the act to be
irreversible in the first place?** Answer that once and six questions close.

---

### GATE 5 — Decide these last, deliberately

Five workflows are `NO_IMPLEMENTATION`: the business runs the path and EOS models no part of it —
warranty (`WF-SVC-020`), pricing and price lists (`WF-SLS-005`), accounts payable (`WF-FIN-010`),
warehouse creation (`WF-INV-011`, which is also in D8), and Company Settings (`WF-ADM-008`). To these
add preventive-maintenance campaigns (`OQ-SVC-07`), customer hierarchy (`OQ-CRM-10`), sales credit
splitting (`OQ-SLS-11`) and reusable sales templates (`OQ-SLS-08`).

**These are scope questions, not unblocking questions.** Each creates new build; none of them unblocks
anything already built. They belong last, and saying so explicitly is useful — they are the most
visible gaps and therefore the most likely to be prioritised by their visibility.

**One of them carries a constraint with a deadline attached.** `OQ-SLS-08` records an unrelaxable
constraint from 2026-07: *a line storing ONE price cannot later carry both a transfer price and a
customer price, so intercompany pricing must be designed before quotes, orders and invoices are built
on it.* If D11 and the intercompany question (`OQ-FIN-06`) resolve toward EOS holding commercial
pricing, this one moves forward in the order.

---

### 3.6 The remaining questions, and where they are

Thirteen decisions are named above, covering roughly thirty of the 106 questions. **All 106 live in
the registry's JSON companion under `owner_questions`**, each with its full text, its provenance, its
references and the workflows it gates; the registry's Appendix A additionally gives, for each one, how
many of the 86 workflows have their break point waiting on it. The remaining questions group as
follows — the five groups already fully absorbed into Gates 0-4 (`OQ-ACT-*` 5, `OQ-COMP-*` 6,
`OQ-GATE-*` 1, `OQ-EQP-*` 1, `OQ-SCN-*` 1) are not repeated here:

| Group | Count | Character | Where it sits |
|---|---:|---|---|
| Finance (`OQ-FIN-*`) | 19 | Mostly downstream of D10/D11/D13; several close automatically when those are answered. | After Gate 4 |
| Sales (`OQ-SLS-*`) | 14 | Agreement lifecycle, pricing, credit, territory — mostly Gate 5 scope questions. | Gate 5 |
| Phase-2 ledger (`OQ-LEDGER-*`) | 12 | Mechanical residue and object-model questions; two are in D7. | After D1 |
| CRM (`OQ-CRM-*`) | 11 | Governed-writer questions, all shaped by D1; correcting acts are in D13. | After D1 |
| Service (`OQ-SVC-*`) | 10 | Operational design: handover, non-completion, offline conflict, PM. Largely independent. | Parallel track |
| Inventory (`OQ-INV-*`) | 9 | Three are in D7/D8; the rest are operational rulings. | After D1/D8 |
| Administration (`OQ-ADM-*`) | 8 | Policy-store questions; two are in D7. | After D1 |
| Reporting (`OQ-RPT-*`) | 5 | All wait on D3 and on D8's company answer. | After Gate 3 |
| Cross-domain (`OQ-XD-*`) | 4 | The seams. Each names its two sides. | Various |

**One standing recommendation to the programme, from P3-D, which this brief endorses.** The
nine-token blocking vocabulary should gain three more tokens — `RELEASE_NOT_AUTHORIZED`,
`NOT_CAPABILITY_EXPRESSIBLE` and `CAPABILITY_NOT_REGISTERED`. Each names a different owner and a
different fix, and collapsing them into the existing nine loses the distinction that tells a reader
whether the remedy is a config edit, a design decision, or a catalogue entry.

---

## 4. What must be true before any production cutover

Stated as conditions that can be checked, with the check named and the current measured value given.
None of these is an aspiration. Each is either true or false on a given day, and someone can run the
check and say which.

Nothing in this programme has been executed against production, so **every "today" figure below is a
measurement of the repository at integrated head `0ba8ab0d`, not of the running system.** Establishing
the same measurements against the running system is itself condition C13.

**Seventeen conditions. Two of them are merge gates rather than cutover gates and come first** — C16
(the branch that would make the governed role layer decorative) and C17 (services that silently narrow
their role set without recording it). Both are cheap, both are checkable today, and both get more
expensive the later they are taken.

| # | Condition | How it is verified | Today |
|---|---|---|---|
| **C1** | **At least one complete commercial path resolves ALLOW at every step, in production, for a named governed business role that is not `admin` or `owner`.** | Run the shipped resolver over all roles × all capabilities under the production activation set from the unmodified `config/environments.json`, and record the output for the named path. | **False.** 37 of 147 capabilities are allowed to anyone anywhere in production and not one is commercial. |
| **C2** | **At least one workflow has been run end to end, by a person or a test, and its output recorded.** | An executed run — not a code trace — with the command and the output preserved. | **False.** Zero of 86. Only 42 of 1,010 modelled activities have ever been executed, and all 42 are capability resolutions, which prove who may do a thing and never that the thing completes. |
| **C3** | **One authority of record is named in one document, and the number of enforcement sites obeying a different authority is zero — or each exception is listed and waived in writing, with a date.** | Count the Rules sites branching on `users/{uid}.role`; diff the four object-capability tables against each other. | **False.** 44 Rules sites over 22 collections; four tables disagreeing 21 times, 18 of them with no recorded rationale. |
| **C4** | **No capability id is gated in a client component and absent from the trusted request set — enforced by a guard that reads component source and is capable of failing.** | Extract every capability gate from `field-ops-app-vite/src` and diff against the resolved request set. Then mutate one gate and confirm the guard goes red. | **False.** Five ids. The registered guard asserts a subset relation that is true by construction and can never fail. |
| **C5** | **No capability id is checked in server or client code and absent from the catalogue.** | Diff every checked id against the 147-id catalogue. | **False.** Six confirmed, including one whose own source comment admits *"referenced by string only."* |
| **C6** | **Every capability that is active in production is held by at least one governed business role, and at least one real principal is assigned that role in the target environment.** | Resolve holders excluding all three compatibility roles; then read `roleAssignments` in the target environment and count live, enabled, current-`accessVersion` holders per role. | **False on the first half** — nine active, production-live capabilities including the whole reorder approval chain reach no governed business role. **Unmeasured on the second half, and this is the highest-priority live-data measurement in the brief.** The authority engine is proven to work: 47 of 48 roles resolve ALLOW, all 45 governed roles are grantable, and `roleAssignments` is the sole source of an ALLOW, read per request at 9+ sites. **Capacity is proven; occupancy is unknown.** |
| **C7** | **Every object Administration renders is either capability-expressible or explicitly marked Rules-governed, and the marker survives into the tenant policy store.** | Read `objectPermissionMap.js` for empty verb lists; read the seeded policy store for the `rulesOnly` marker. | **False.** Three objects have empty verb lists; the seed drops the marker, so a Rules-governed object is indistinguishable from an unmodelled one. |
| **C8** | **The applied-migration count in the target environment is measured by connecting to the database and reading its migration table, and recorded with the date and the connection used.** | Connect; read; record. | **Unmeasured.** `functions/migrations/` holds exactly 18 files. The circulating figure of "7 of 18 applied in nonprod" is inherited and **unverified by every lane including P3-D**, and does not appear in the Phase-2 decision ledger at all. |
| **C9** | **Firestore Rules have been evaluated by the emulator against the persona matrix and the results recorded.** | Run the emulator suites. | **False.** The emulator has never been run in this programme — no JRE on the machine, and port 8080 held by an unrelated process. **Every `RULES_DENY` finding in the registry is a reading of ruleset text, not an evaluation.** |
| **C10** | **Every record family that carries an operating company has a stated inheritance source and a creation path that captures it.** | For each family, name the source; open the create path and confirm it asks. | **False.** Work Orders carry no company at all and the create wizard does not ask (19 of 30 have no available source). Four record families lost their declared inheritance source on 2026-09-12 and have no replacement. The boundary is enforced in exactly one place in the whole system. |
| **C11** | **Every irreversible commercial act has a correcting act — or a written, dated acceptance that it does not, naming the act and who accepted the risk.** | Enumerate the acts; for each, name the reversal or the acceptance. | **False.** Invoice issuance, customer creation, company attribution, equipment installation, part consumption and technician handover have none. |
| **C12** | **A person holding exactly one governed business role — not `admin`, not `owner`, not `dispatcher` — can complete one full day of that job in the sandbox, demonstrated.** | Provision a principal with one role assignment, and work through that role's modelled activities. | **Not attempted.** No lane did this. The closest available evidence is modelled rather than executed: of the Controller's 30 modelled activities, 17 are blocked or unsupported. |
| **C13** | **Every claim in the cutover decision has been re-measured against the running target environment, not against the repository.** | Re-run each check above against the environment being cut over to. | **False by construction.** No lane made production contact, invoked a Cloud Function, evaluated Rules, connected to Postgres or reached the API service. |
| **C14** | **Every figure in the cutover decision states its file, the predicate that produced it, and the definition of its denominator.** | Read the decision document. | **False today across the programme.** Three live denominators exist for the same advertised-capability count, and one lane's own first measurement was wrong by ten because ten matches were comment prose. |
| **C15** | **No workflow is blocked on `OWNER_DECISION_PENDING` — or each remaining one carries a dated decision to defer, with the consequence of deferring stated.** | Read the registry. | **False.** 15 of 86. |
| **C16** | **The `feat/rules-out-of-firebase` branch has not merged with `governedListReadService.ts`'s role default unresolved.** | `git merge-base --is-ancestor`; then read `:392` and `:535` for `deps.roles ?? COMPATIBILITY_ROLES` and confirm every caller passes the governed set. | **True today, and fragile.** The branch is confirmed not an ancestor of the integrated head, so the mainline's 45 governed roles are live authority. **If that branch merges as it stands, the governed role layer becomes decorative on the governed-list read path** — P3-A3's withdrawn finding becomes true. This is a merge gate, not a cutover gate, and it comes first. |
| **C17** | **No deployed service silently narrows its role set to `COMPATIBILITY_ROLES` without a recorded decision.** | Grep every service for a `COMPATIBILITY_ROLES` default; for each hit, require either a caller that overrides it or a documented rationale at the site. | **False.** `recordChangeHistoryReadService.ts:284` and `employeeProfileCommands.ts:454` default to it and `administrationUsersCallables.ts` never overrides, denying 11 governed roles a capability they hold. `trustedWriterCommands.ts:1099-1110` does the same thing deliberately and says so — that is the shape the others must match. |

**Two conditions deliberately not included, and why.**

- *"All tests pass."* Tests pass in this repository while asserting nothing. The guard for the
  most expensive reachability defect is registered, green, and tautological, and 37 `.test.mjs` suites
  — 263 counting `.test.jsx` — are not registered at all. Passing is not evidence here; C4's mutation
  check is the shape that is.
- *"The capability count in production reaches some threshold."* Activation is not progress. Turning
  on a capability that no job holds moves a workflow from `CANNOT_START` to `BROKEN_MIDWAY` and
  changes nothing for the business. C1 and C6 measure the thing that matters.

---

## 5. What is honestly unknown

This section is the reason the rest of the brief can be trusted. It belongs in the document, not in an
appendix, and not only in the report that accompanied it.

### 5.1 What was actually executed — the complete list

**Two things have now been executed, and nothing else.** Both are capability resolution against the
shipped resolver; neither touched a running system.

**The first, by the consolidation lane.** Capability resolution: the shipped resolver,
`governedBusinessRoles.ts`, `compatibilityRoles.ts` and `permissionCatalog.ts` loaded directly from
the integrated-head worktree, evaluated for **all 48 roles × all 147 capabilities** under the
production and `platform-sandbox` activation sets from the unmodified `config/environments.json`. No
network, no Firestore, no Postgres, no deploy, no mutation, no production contact.

From that run, and only from it, these figures are proven: 147 capabilities; 45 governed business
roles plus 3 compatibility roles; 109 registered inactive; 92 sandbox activation overrides; 3
certification; **0 production**; **0** capabilities with zero holders; **21** held only by `owner` and
`admin`; **32** held by no governed business role; **17** dead in every environment; **37** allowed
anywhere in production. Plus catalogue membership: the six ids named in code and absent from the 147.

**The second, by a later lane, resolving the one finding this brief had carried as its highest-priority
unknown.** Executed against the shipped resolver at the integrated head: 3 compatibility roles + 45
governed business roles, 147 capabilities, 21 held only by `admin`/`owner`, 0 held by no role —
reproducing the first run's figures exactly and independently. Plus: **47 of 48 roles resolve ALLOW**
(the one that does not is `generalEmployee`, which declares nothing by design); **all 45 governed roles
appear in `ASSIGNABLE_ROLES`**, so none is unassignable; **`readGovernedList` does not exist at the
integrated head** and is branch-local to the unmerged `feat/rules-out-of-firebase`; and the
`roleAssignments` store is read per request at 9+ sites as the sole source of an ALLOW, denying on
absence, on disablement and on a stale `accessVersionAtGrant`. The eleven-role `audit.event.read`
denial in §2.1 was measured through the shipped service.

**The conclusion that follows, and it should be stated without hedging: the role layer is a working
system, not a model of one.** Every role-level figure in this brief describes live authority.

**Everything else in this brief is a reading of source at a named commit.** That is a good standard
and it is not the same standard.

### 5.2 What was never touched, stated plainly

- **No Cloud Function was invoked.** Not `issueInvoice`, not `applyPayment`, not `createOpportunity`,
  not `allocateSalesOrder`, not `transitionWorkOrder`, not `recordPutAway`, not `createBin`. Not one.
  Every authority path naming a command is a code trace.
- **No Firestore Rules were evaluated.** The emulator cannot run in this environment. Every
  `RULES_DENY` is a reading of ruleset text. `WF-CRM-001`'s "five of seven holders are refused" is an
  executed capability result set placed beside a *read* of `firestore.rules:22-24`.
- **No Postgres connection was made**, and the applied-migration count was not measured.
- **No HTTP request reached the Render API service.** Whether it is deployed is inherited from the
  programme brief and is unproven.
- **No test suite was run.** `node_modules` is absent in the lane worktrees.
- **No production contact of any kind was made, by any lane, at any point.** No deploy, no mutation,
  no read.
- **No role-assignment data was read in any environment.** The `roleAssignments` mechanism is proven to
  work and to be the sole source of an ALLOW; **whether any principal is assigned any of the 45 governed
  roles is unmeasured**, because it needs live Firestore and no lane reached for it. Capacity is proven;
  occupancy is unknown. **This is the highest-priority live-data measurement Design P2 should take**
  (C6).

### 5.3 Figures that are contested and remain unresolved

- **The advertised-capability denominator: three different live numbers.** The W1-C18 handoff says
  *30 of 58* and *seven objects inert on every verb*. P3-A3 re-measures the advertised union as **56**
  (the 58 conflates 49 CRED ids with 9 ids on a ban list, all nine of which are active), finds
  **twelve** objects inert rather than seven, finds Transfer Orders wrongly included and Dispatch
  Schedule wrongly omitted. P2-D item 7e measures the same territory again and gets **57 unique ids,
  of which 31–32 are inactive**. **All three are over different denominators and no lane states its
  denominator in the same terms as another. Unresolved.** This brief uses none of them; it uses the
  resolver's 147 and 109.
- **Whether the Sales Order state machine was supposed to have a `DRAFT` state.** An assessment
  document assessed `DRAFT → CONFIRMED → …`; the shipped lifecycle has no `DRAFT`; no decision record
  removing it was found. **Unproven whether the removal was deliberate.**
- **Which of `reportAccess.js:30` ("the `report.definition.*` ids are all active") and
  `permissionCatalog.ts:907-941` (all five registered inactive) is wrong.** One is. No reconciling
  decision record exists.
- **Whether four specified guards — disabled-user, missing-Employee-link, break-glass, and
  final-active-admin — landed in the merged administrator credential command.** P3-A3 marks it
  unproven.

### 5.4 Figures I could not trace to any input document

Both are in circulation in the programme and are stated here so nobody treats them as sourced.

- **"Nonprod is at 7 of 18 migrations."** It does not appear in the Phase-2 open decision ledger at
  all — that document does not mention nonprod migration status. It does not appear in any of the
  three archaeology documents. P3-D records it as *"inherited and unverified by every lane that has
  touched it, including this one,"* and P3-B3 flags it as programme-supplied. **What is verified is
  only that `functions/migrations/` holds exactly 18 files and which schema each creates.** The "7"
  has no source in this document set. If nonprod has advanced past 7, one workflow's blocking analysis
  changes.
- **"Roughly 80 code comments were corrected across 44 files."** The figure appears in none of the
  eleven input documents. **The phenomenon it describes is extensively evidenced** — §2.5 cites eleven
  specific false or stale comments individually, and two lanes state the pattern for their whole
  domain — but the count itself is unverified here and should not be quoted as sourced.

### 5.5 Judgements, not measurements

- **Every workflow state is a judgement.** `WORKS_WITH_GAPS` versus `BROKEN_MIDWAY` turns on whether a
  reasonable operator would call the outcome settled. Where the call was close, the registry states
  the fact and lets a reader disagree with the label.
- **The zero in `WORKS_END_TO_END` is not a measurement of failure.** It is the absence of a
  measurement of success, combined with a named gap in every path.
- **Activity-to-workflow mapping is nominal in places.** Where a record cites a range of activity ids,
  the block was mapped as a block.
- **Line citations outside P3-D's spot-verified set are as reported by the source lanes.** P3-D
  personally re-read about forty specific locations at the integrated head; the rest are inherited.
- **The five unreachable client gates were traced, not executed.** The conclusion is a reading of four
  list definitions diffed against every capability gate in the client source.

---

## 6. Seven claims you will hear, and what each actually measures

Read this before quoting any figure or finding from any EOS document. Each of the seven cost a lane a
false conclusion in a single night, several of them cost more than one lane, and the last one cost this
brief a wrong precondition on its first decision.

### 6.1 "No role holds capability X" — false, always, and not a claim a search can support

Zero of 147 capabilities are held by nobody. `compatibilityRoles.ts:235-240` spreads the entire
catalogue onto `admin` the moment a capability exists, and `owner` composes from `admin`, so there are
always at least two holders. A literal search of the role definition files reports **17 of 147** ids as
appearing nowhere; the resolver shows all 17 held by `owner` and `admin`.

**Two failure modes here, not one.** A search of the role files cannot see the derived grant at all. And
a *resolved* check that excludes only `admin` still returns zero, because `owner` remains — so the check
appears to prove the trap does not exist. The useful question is never "who holds it" but **"does any
job someone actually does hold it"**, and answering that requires excluding all three compatibility
roles and then checking that a real principal is assigned the role.

Multiple lanes reached a false conclusion through some variant of this in a single night — three are
demonstrable in the documents this brief consolidates, including one lane that had written the warning
against it three paragraphs earlier in the same document, and the programme reports six. A prior
finding had already been formally withdrawn for the same reason.

**The rule: grants must be resolved, not searched for.**

### 6.2 "21 capabilities are held only by admin/owner and by no governed business role" — two numbers, both real

The **21** is exact for what it measures: holders filtered to exclude `admin` and `owner`. But that
filter lets the third compatibility role, `dispatcher` — and `technician` — count as governed business
roles. They are not: the access model declares 45 governed business roles in one file and 3
compatibility roles in another.

Re-executed at the integrated head excluding all three compatibility roles, **the number is 32.**

**The eleven-id difference is the operationally important part, because nine of the eleven are ACTIVE
and live in production:** the whole reorder approval chain (`approve`, `reject`, `cancel`,
`markReceived`, `read.own`, `create.system`), plus `reorder.purchaseOrder.void`,
`inventory.action.create` and `inventory.analytics.read` — and `salesOrder.fulfill` and
`salesOrder.service`, which are inactive.

**Report both, with the reason they differ.** The record is: **0 ungranted · 21 held only by `owner`
and `admin` · 32 held by no governed business role.** The third is the one that answers *"can a job
someone does actually do this?"*

Note that the source document that produced the 21 also describes `salesOrder.fulfill` in prose as
held *"by no governed business role"* — a sentence that is false under the definition its own headline
figure uses. The headline and the finding were measured two different ways in the same document.

### 6.3 "There are four authority failure modes" — there are at least seven

The established vocabulary names four. All four are real. Three more were found and the vocabulary has
to flatten them, which hides what the remedy is and who owns it.

| # | Mode | What the remedy is |
|---|---|---|
| 1 | Capability registered inactive and the environment does not lift it | A config decision |
| 2 | Environment declines to activate an id it could | A config decision |
| 3 | Gated client-side and never requested from the trusted feed | A five-line code fix and a real guard |
| 4 | Held only by `admin`/`owner`, by no job someone does | A grant decision |
| **5** | **Compile-time release-readiness constant** — while false the client makes zero callable attempts; no refusal, nothing reaches the server | **A release authorisation.** The repository says it itself: *"READINESS IS NOT AUTHORIZATION, and readiness true does not mean 'activated'."* |
| **6** | **Not capability-expressible at all** — `rulesOnly` objects with empty verb lists that Administration renders anyway | **A modelling decision.** Distinct from both "ungranted" and "inactive". |
| **7** | **Named in code or design and absent from the catalogue** — six confirmed | **A catalogue entry, or a deletion.** |

Collapsing these into the existing four tells a reader to make a config change when the answer is a
design decision.

### 6.4 "The blocked-time ruling was implemented, so placement no longer respects PTO" — false

**The ruling was implemented.** `createTechnicianBlockedTime` no longer calls
`findBlockedTimeConflict` and no longer raises `BLOCKED_TIME_CONFLICT`. The function now carries the
ruling verbatim and collapses only an exact replay — same technician, same kind, both endpoints, same
note — returning the existing block id and writing nothing. Serialization is deliberately preserved.
The related arithmetic defect was fixed too: `blockedMinutesInBand` now merges overlapping intervals
before measuring, mirroring the server, and a cross-package test runs the same inputs through both.

**And the demotion must be stated narrowly.** "Zero hits for `BLOCKED_TIME_CONFLICT` in that file" is
exactly true of `schedulingCommands.ts` and **not** true of the tree. The tokens live on in
`errorMapping.ts`, `types.ts`, `availabilityModel.ts` and `placementPolicy.ts`, where they mean the
**placement** refusal — a job may not be *placed into* blocked time — which the ruling never touched
and which `placementPolicy.ts:98-105` still enforces.

**A reader who generalises "zero hits in that file" into "the concept is gone" will conclude that
placement no longer respects PTO. It does.**

### 6.5 "X of Y capabilities are advertised / inactive" — three live denominators, none reconciled

See §5.3. *30 of 58*, an advertised union of *56* with 30 inactive and 12 of 25 objects wholly inert,
and *57 unique ids with 31–32 inactive* are three measurements of overlapping but different sets, and
none states its denominator in the other's terms. **Unresolved.** Use the resolver's 147 and 109, or
state your own denominator.

### 6.6 "The activity libraries show N activities passing / executable" — they do not

**Only 42 of 1,010 modelled activities were ever executed**, all in one library, and all 42 are
capability resolutions — which prove who may do a thing and never that the thing completes. The other
660 in the two story-based libraries are explicitly `NOT_RUN` on every single row, by design: *"`PASS`
is reserved for an activity someone actually ran."*

**Two fields in those libraries look like verdicts and are not.** One library marks **105 of 330**
activities `EXECUTABLE_TODAY`; it means *a test for this could be written and run in this environment*.
Another marks **223 of 330** as having a unit-assertable core; same meaning. Neither is a run, and
neither says the workflow works. A reader skimming for green rows will find 328 of them and conclude
something false.

**A third field conflates two axes.** One library's seven-value `status` answers *how do we know?* and
*what state is it in?* on what looks like one scale, so 141 `IMPLEMENTED_UNEXECUTED` rows read as a
middling outcome when they are an epistemic statement about 141 perfectly ordinary built things.

### 6.7 "Lane X found Y in the code" — ask which branch

One of the most consequential findings this brief originally carried was *"`readGovernedList` defaults
its role set to `COMPATIBILITY_ROLES`, which would make the 45 governed business roles declarations
rather than live authority."* It was raised as the single highest-priority re-measurement in
Administration, and an earlier draft of this document made it a precondition on the first decision in
§3.

**The finding is accurate. It is accurate about a branch that has not merged.** `readGovernedList` does
not exist at the integrated head; it lives in `governedListReadService.ts:387` on
`feat/rules-out-of-firebase`, confirmed not an ancestor of the integrated head and contained by that
branch alone. On that branch, `:392` and `:535` both default `deps.roles ?? COMPATIBILITY_ROLES`
exactly as reported.

**The trap is generalisation from a working copy to the mainline**, and it is easy to fall into when
several lanes work in several worktrees over several branches at once. It is distinct from the stale-
comment trap (§2.5) and from the grep trap (§6.1): the reading was correct, the code was there, and the
conclusion was still false of the system.

**The rule: a code finding must state the commit or branch it was read at.** Every citation in this
brief carries the integrated head `0ba8ab0d` for exactly this reason. And note which way this one
resolved — the answer was **better** than the finding, which is the fifth time in this brief that a
programme claim turned out to understate what exists.

---

## 7. Closing

Three sentences that this brief exists to deliver.

**EOS is better built than its own records say and less operable than anyone assumed.** Every stale
claim found tonight understated what exists; the design work was right far more often than the code
that implemented it; and the honest measure of the system is not how much is missing but how little of
what exists can be reached by a person doing a job.

**The distance between what EOS can do and what EOS does is mostly decisions, not engineering.**
Thirty-five of 86 workflows stop because a next step was never written, and most of those were never
written because something was correctly not decided. Fifteen stop on an Owner decision outright. One
configuration file with no entry in it accounts for most of the rest.

**Almost nothing in this programme has been run.** Eighty-six workflows were mapped and none was
executed; 1,010 activities were modelled and 42 were run; two independent runs of one resolver proved
the authority engine works, and every other claim in this brief is a careful reading of source at a
named commit. What those two runs established is worth holding onto, because it is the best news in the
document: **the role layer is a working system, not a model of one** — 47 of 48 roles resolve, all 45
governed roles are grantable, and the assignment store is the sole source of an ALLOW. **What nobody
has measured is whether anyone is in the seat.** Capacity is proven; occupancy is unknown. **The first
thing Design P2 should buy itself is an environment that can run the emulator, invoke a callable, and
read a role assignment** — because until then, every number in this document, including the good ones,
is a statement about a repository rather than about a business.

---

## Appendix A — Source documents

All paths are read-only inputs; this lane modified none of them.

| Lane | Document |
|---|---|
| P3-D | `docs/architecture/eos-workflow-registry.md` |
| P3-D | `docs/architecture/eos-workflow-registry.json` — 86 workflow records, 106 owner questions, the executed-evidence block, the 11-id delta, the 6 uncatalogued ids |
| P3-D | `docs/architecture/eos-workflow-registry-schema-reconciliation.md` |
| P3-A1 | `docs/design/archaeology/service-scheduling-technician-equipment.md` |
| P3-A2 | `docs/design/archaeology/inventory-warehouse-purchasing-scanner.md` |
| P3-A3 | `docs/design/archaeology/sales-crm-financials-reporting-administration.md` |
| P3-B1 | `docs/scenarios/day-in-the-life/service-technician.{md,json}` — 330 activities, 33 stories |
| P3-B2 | `docs/scenarios/day-in-the-life/inventory-warehouse-purchasing.{md,json}` — 330 activities, 33 stories |
| P3-B3 | `docs/activities/p3b3-*.json` + `p3b3-sales-crm-finance-admin-activities.md` — 350 activities, 6 blocks |
| P2-D | `docs/architecture/phase2-open-decision-ledger.md` — 25 items, 20 distinct Owner questions |
| P3-0 | `docs/architecture/verenward-global-record-identity-standard.md` |
| P3-0 | `docs/architecture/verenward-object-code-registry-proposed.md` |
| P3-0 | `docs/architecture/record-id-migration-impact-census.md` |
| P2-N | Executed resolution of the `readGovernedList` / `COMPATIBILITY_ROLES` question, the `ASSIGNABLE_ROLES` and `roleAssignments` findings, and the eleven-role `audit.event.read` denial. Received as a coordinator correction to this lane; it settles §2.2's standing unknown and adds conditions C16 and C17. |

**Verification base.** All lanes branched from `d104cf49`; every defect carried into this brief was
re-checked by P3-D at integrated head `0ba8ab0d` on `integration/wave-1`. Six defects true at the lane
base and fixed at the head were demoted and appear nowhere in this brief as open.

---

*Lane P3-C. Consolidation only. No runtime code was changed, no design implemented, no production
contact made, no Owner question answered, nothing pushed.*
