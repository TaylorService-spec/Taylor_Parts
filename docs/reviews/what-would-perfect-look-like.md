---
artifact_type: review
gate: Persona UX Gap Analysis (What Would Perfect Look Like)
status: Accepted — Blueprint input (finalized 2026-08-05)
verification_note: "Live-environment verifications recommended in this review are governed by Blueprint rulings R2/C4 — build proceeds repository-only; live checks are separately authorized and are NOT a prerequisite to the repo work."
date: 2026-08-05
owner: Claude Code
method: 6-persona fan-out workflow + synthesis
addressed_to: Owner, Claude, ChatGPT
---

# What Would Perfect Look Like
### A persona-based UX gap synthesis for Taylor_Parts Field Ops
**Addressed to: the Owner, Claude, and ChatGPT**

---

## 1. Executive Summary — the five biggest things between this app and "perfect"

Across all five working personas plus first-run, the same structural truth repeats: **the spine of each persona's job is well-built, but it is surrounded by placeholders, demo props, and parallel data models that make the product feel half-finished and, in places, actively misleading.** The five highest-order problems:

1. **The organizing dimension of the whole business — Taylor vs Ventana operating company — has zero code.** A grep of `field-ops-app-vite/src` for `operatingCompanyId | isNationalAccount | Ventana` returns nothing; it exists only in `docs/design/` and `docs/specifications/`. This is *the* defining capability for both the Owner and the Accounts/Sales persona, and it is entirely absent. Every account, work order, and report is one undifferentiated dataset.

2. **Identity and access management is not in the product at all.** There is no `owner`, `sales`, or `parts_associate` security role (`domain/constants.js ROLES` = admin/dispatcher/technician only). Provisioning runs through a CLI script (`functions/scripts/provisionEmployeeAccess.js`). The Parts Associate persona is literally locked out of the Inventory domain they own; Owners and salespeople get over-granted to admin/dispatcher. Governance — an explicit Owner mandate — has zero in-app levers (`Roles & Permissions` is a `PlaceholderPage`; the real matrix is hardcoded in `ROLE_NAV_ACCESS` and `firestore.rules`).

3. **Two parallel data models (`fieldops_jobs` vs `fieldops_wos`) are silently diverging, and demo state masquerades as real.** Control Tower stats count `fieldops_jobs` while the Dispatcher Board dispatches on `fieldops_wos` (`ControlTower.jsx` L59-67 vs `DispatcherBoard.jsx` L49) — the monitoring screen and the board can show different realities. The `PartsScanner` "Technician Workspace" writes to in-memory `demo/InventoryContext` that evaporates on reload, presented to both technicians and parts associates as if it saves work.

4. **The write-loops that matter don't close.** "Mark Received" and every human inventory action are explicitly **"log only — does not update stock"** (`PartDetail.jsx`). The dispatch/create engine depends on Cloud Functions that in-repo docs say are undeployed (`WorkOrderWizard.jsx` L20-24, blocked on the Blaze decision, issue #15). If still true, the polished Dispatcher Board is a read-only mirage. **This must be verified against the live project before any UX work is prioritized.**

5. **First impressions are placeholders.** The default post-login landing (`/dashboard` → "My Dashboard") is a not-built-yet stub for admin *and* dispatcher (`App.jsx DashboardIndex`). ~40 nav sub-items exist but the majority route to `PlaceholderPage` ("This area isn't built yet"), visually indistinguishable from the handful of real screens. The highest-authority and the newest users both open on the emptiest screen.

---

## 2. Cross-cutting recommendations (ranked by leverage)

These recur across multiple personas and are deduped here. Fixing them moves several personas at once.

**C1 — Ship the operating-company dimension (Taylor/Ventana). [Owner, Accounts/Sales | High]**
Land Option A from the LOB wireframe: an immutable `operatingCompanyId` (TAYLOR|VENTANA) stamped at Account creation, kept strictly separate from `isNationalAccount` per `docs/BusinessEntityModel.md`. Surface a company scope switcher in `AppHeader` and company badges/columns on Accounts, Work Orders, and Operations. This is the single prerequisite unblocking cross-company oversight (Owner) and the entire national-accounts/Ventana sales story.

**C2 — Verify Cloud Function deployment, then reconcile to ONE dispatch/inventory model. [Dispatcher, Technician, Parts Associate, Owner | High]**
First: run `firebase functions:list` against live to confirm `createWorkOrder`/`transitionWorkOrder`/`updateWorkOrderExecutionData` deployment status and correct the stale `WorkOrderWizard.jsx` comment. Then retire or reconcile the legacy `fieldops_jobs` path (`Dispatch.jsx`, `Jobs.jsx`) so Control Tower, the board, and the technician dashboard all read `fieldops_wos`. This kills the monitoring-vs-board discrepancy, the stray technician "create job" form, and the demo scanner in one architectural decision.

**C3 — Build real in-product identity & access management. [Owner, Parts Associate, Accounts/Sales, New User | High]**
An Employee/User admin screen over the `employees` collection (`employmentStatus` lifecycle, `operationalRoles[]`, user-link status) wrapping the same logic as `provisionEmployeeAccess.js`, plus the Issue #100 least-privilege Inventory route so a `technician + PARTS_ASSOCIATE` reaches exactly their assigned reorder work without an admin over-grant. Retire the name+phone `Technicians.jsx` form. Add a read-first `Roles & Permissions` mirror of `ROLE_NAV_ACCESS`.

**C4 — Close the inventory write-loop (receive → ledger → on-hand). [Parts Associate, Technician | High]**
Promote `inventory_actions` and "Mark Received" from audit-note-only to trusted, Cloud-Function-applied ledger writes so on-hand actually moves. Let `ExecutionCapture` record ad-hoc (unplanned) parts, and back the one scanner with the real ledger so a floor scan and a desk decision see the same number. One inventory truth, not two.

**C5 — Distinguish shipped from unbuilt, and give every persona a real landing. [New User, Owner, Dispatcher | High/Medium]**
Add a "Coming soon" treatment (or hide) to `PlaceholderPage`/`future` nav items — the `legacyKey`/`future` flags already exist. Replace the "My Dashboard" stub with role-aware homes (Owner: cross-company health + pending approvals; dispatcher: the board; technician: assigned work). Make the "No access" screen actionable (signed-in email, named contact, "Check again" button).

**C6 — Resolve opaque IDs to human names everywhere. [Dispatcher, Technician | Medium]**
Customer/location show as raw `customerId` on the Dispatcher Board queue, preview, Work Orders list, and technician cards (`WorkOrderQueue.jsx` L69, `TechnicianWorkOrderDetail.jsx` L32). Only the standalone detail pages resolve names via `useAccount`/`useLocation`. Join/denormalize account+location names (and, for technicians, a tap-to-navigate address and tap-to-call phone) into every list row.

**C7 — Make the analytical/reporting surfaces real. [Owner, Accounts/Sales | Medium]**
The entire Reporting domain and the Financial Summary are placeholders/permanently-unconfigured. Stand up at least the Executive rollup reusing `Operations.jsx` analytics, and ship the provider-neutral forecast surface (with an honest "not connected" state) from the account-commercial-profile spec.

---

## 3. Per-persona findings

### Owner / Admin (resolves to `admin`)
**Verdict:** Lands on a placeholder and, the moment they turn to their actual job — governance and cross-company oversight — the platform is almost entirely nav scaffolding.
- **Cross-company oversight [High]** — no `operatingCompanyId` anywhere in `src`; grep empty. → C1.
- **Employee & access management [High]** — no in-product create/link/revoke; real path is `provisionEmployeeAccess.js`; `Administration→Employees` = legacy `Technicians.jsx`. → C3.
- **Roles & Permissions / governance [High]** — placeholder; real model hardcoded in `domain/constants.js ROLE_NAV_ACCESS` + `firestore.rules`. → C3.
- **Audit logs [Medium]** — `PlaceholderPage` despite existing append-only data (`inventory_actions`, `reorder_purchase_order_voids`, `reviewDecision` history). Build a reader.
- **Executive reporting [Medium]** — eight dead Reporting nav links. → C7.
- **Best to-dos:** real cross-company landing dashboard; Company Settings first (unblocks multi-tenant + the operatingCompany dimension); read-only permission matrix mirror.
- **Perfect vision:** A command surface where Taylor and Ventana can be viewed together or scoped by one switch — health tiles, pending approvals, recent governance events — with fully in-product employee/role provisioning and legible, auditable governance, gated to an elevated owner tier rather than shared with every dispatcher-adjacent admin.

### Dispatcher (`DISPATCHER`)
**Verdict:** The dispatch half is genuinely strong (live 3-pane board, real tech-recommendation engine, clean 4-step wizard); the monitoring and scheduling halves are incoherent or missing.
- **Monitoring/data coherence [High]** — Control Tower tiles count `fieldops_jobs`; board runs `fieldops_wos` (`ControlTower.jsx` L59-67 vs `DispatcherBoard.jsx` L49). → C2.
- **Undeployed Cloud Functions [High]** — `WorkOrderWizard.jsx` L20-24 says not deployed; would break dispatch + create at runtime. **Verify first.** → C2.
- **Scheduling [High]** — `Service→Scheduling` placeholder; "Schedule" is a bare status flip, no datetime, no `scheduledStart`, no calendar. The planning half of the job is unexpressible.
- **Reacting to change [Medium]** — only feed is session-only (`DispatcherActivityFeed` "this session"); Notifications is placeholder. Persist an exception/alert center.
- **Opaque customer IDs [Medium]** → C6. **Territory recommendation stub [Medium]** — `scoreTerritoryMatch()` returns a flat constant yet is displayed as a real factor (`technicianRecommendationEngine.ts` L130-136); hide it or land geo data.
- **Surface fragmentation [Medium]** — 5+ overlapping Service destinations across two models; designate one canonical workspace.
- **Best to-dos:** default landing to the board; add "New WO" + "open detail" from the board/preview; one authoritative model.
- **Perfect vision:** One live command surface on one model — coherent counts, named customers, geography-aware recommendations whose every factor is real, fluid dispatch, a real scheduling calendar for future/time-windowed work, and push exceptions that survive refresh.

### Technician (mobile)
**Verdict:** The dashboard spine (`TechnicianDashboard` → lifecycle actions → `ExecutionCapture`) is the one genuinely good, correctly-scoped real-backend flow — surrounded by a dead `FieldMode.jsx`, a demo scanner, and a stray create-a-job form.
- **Job detail — location & customer [High]** — cards/detail show `Customer: {customerId}`, no address/map/phone (`TechnicianWorkOrderDetail.jsx` L32). → C6, extended with tap-to-navigate/tap-to-call.
- **Parts consumption fractured & partly fake [High]** — scanner writes in-memory `demo/InventoryContext` and lists `fieldops_jobs`; `ExecutionCapture` can't record unplanned parts (`ExecutionCapture.jsx` L31). → C4.
- **No offline/PWA [High]** — `MobileStrategy.md` commits "PWA-First"; no manifest/service worker exists (`public/` = 404.html + favicon only). Add installable offline shell + queued writes.
- **Conflicting screens [Medium]** — `Jobs.jsx` create-form + dead imported `FieldMode.jsx` (special-cased to render `PartsScanner`, `App.jsx` L98-103). → C2.
- **Self-service status & day view [Medium]**; **photo/signature capture on Complete [Medium]**; **scanner scope vs promise [Medium]**; **weekly stats [Low]**.
- **Best to-dos:** ordered "today" timeline; status toggle; photos + signature at Complete; one real scanner.
- **Perfect vision:** The phone *is* the job — an ordered day with named customer, tap-to-navigate address, tap-to-call; the clean lifecycle capturing photos, ad-hoc parts, and signature; one offline-first PWA with one parts-used truth.

### Parts Associate / Inventory Operator (`technician` + `operationalRoles:[PARTS_ASSOCIATE]`)
**Verdict:** The reorder-request lifecycle is genuinely strong and complete — but the intended user can't reach it, and their other four named jobs are hollow.
- **Role activation / access [High]** — `PARTS_ASSOCIATE` is an eligibility tag, not an access grant; `ROLE_NAV_ACCESS[technician]` has no `inventory`, so `isDomainVisible` is false. The whole Sprints 2.1.6-2.1.11 workflow is dead-ended for the real assignee. → C3 (Issue #100).
- **Receiving stock [High]** — "Mark Received" explicitly "does not update stock" (`PartDetail.jsx`). → C4.
- **Stock adjustment/correction [High]** — Inventory Action Log is "log only". → C4.
- **Purchase orders [Medium]** — Purchasing domain all `PlaceholderPage`; only real capture is free-text supplier + PO# + one qty. Wire Supplier/PO backends.
- **Warehouse ops [Medium]** — 6 of 7 Inventory tabs are title-only stubs; deliver Transfers + Cycle Counts. **Part master [Medium]** — static 200-row `data/partsCatalog.ts`, no edit UI; make it Firestore-backed + editable.
- **Scanner persistence mirage [Medium]** → C4. **Queue ergonomics [Low]**; **low-stock alerting [Low]**.
- **Perfect vision:** Sign in as themselves onto a focused "My Purchasing" workspace; receiving actually moves ledger stock; POs draw from a real supplier master; an editable part master feeds live analytics; all seven tabs lead somewhere; one inventory model behind desk and scanner; low-stock pushes to the operator.

### Accounts / Sales (incl. National Accounts / Ventana)
**Verdict:** A competent customer directory with a permanently-empty financial panel and no notion of which company an account belongs to — everything that defines the persona is documented but unbuilt.
- **LOB identity & national-account routing [High]** — `operatingCompanyId`/`isNationalAccount`/`salesChannel` have zero code; `AccountForm`/`accounts.js` persist only name/status/relationship/tags/external IDs. → C1.
- **Sales pipeline / quotes-orders-invoices / forecasting [High]** — no Opportunity/Quote/Order/Invoice entities; `FinancialSummarySection.jsx` pinned to `UNCONFIGURED`, can only ever say "Sales data source not connected." → C7.
- **No sales role or account ownership [High]** — no sales role, no `accountOwner`; salesperson gets the full ops console, no "my accounts" scoping. → C3.
- **Customers sub-nav dead-ends [Medium]** — 4 of 5 tabs are stubs; contacts/locations exist only inside `AccountDetail`. **Account→WO detour [Medium]** — no "Create WO for this customer". **Contacts/Locations add-only [Medium]** — no edit/dedupe. **Commercial context [Medium]** — Phase 1 of commercial-profile spec needs no Rules change; ship it. **Thin list [Low]**.
- **Perfect vision:** A sales-scoped "My Accounts" home, each row badged Taylor/Ventana and Retail/National; live Commercial Profile + honest Financial Summary; quote→order→correctly-branded document driven by the transaction's operating company; editable contacts/locations; one-click WO from the account.

### New User / First-Run
**Verdict:** A bare, unbranded door that opens — for two of three roles — onto a "not built yet" stub, with no way to tell real features from placeholders.
- **First screen after login [High]** — `/dashboard`→"My Dashboard" is a stub for admin/dispatcher (`App.jsx DashboardIndex`). → C5.
- **Discoverability of a mostly-stubbed platform [High]** — ~40 sub-items, majority `PlaceholderPage`, indistinguishable from real ones. → C5.
- **Unprovisioned / no-role account [High]** — `resolveEmployeeSession()` returns `role:null` (the normal just-created state) → terminal "No access" with no link/retry/refresh. → C5.
- **Sign-in [Medium]** — no forgot/set-password, no branding, one generic error. **Partial-provisioning half-states [Medium]** — role vs `employeeId` vs `technicianId` links set out-of-band, no unified status. **Empty states [Medium]**; **header/loading polish [Low]**.
- **Perfect vision:** A guided handoff from provisioning — role-aware landing that says "you're provisioned, here's who you are, here's what you can do now," shipped-vs-coming-soon nav, Taylor/Ventana-branded sign-in with working password recovery, and an actionable no-access screen.

---

## 4. What perfect looks like (platform north-star)

Perfect Taylor_Parts is one coherent operations OS where **every persona signs in as themselves and lands on a surface that already knows their job.** The business's real backbone — Taylor dealership and Ventana national accounts — is a first-class, filterable dimension stamped at creation and never guessed at print time, so an Owner can compare the two companies at a glance and a salesperson works a book badged by company and channel. Access is managed *in the product*: employees are created, linked, and role-scoped from an Owner-gated screen, and governance is legible — a faithful mirror of the permission matrix the platform actually enforces, backed by an audit reader over trails that already exist. There is exactly **one** operational truth: one dispatch model where the board and the monitoring tiles agree, one inventory ledger where a receive on the floor and a decision at the desk see the same number, no demo state pretending to persist. The technician's phone *is* the job — named customer, tap-to-navigate address, offline-first, proof-of-work captured at Complete. The dispatcher plans the week on a real calendar and gets pushed the exceptions instead of scrolling for them. And a brand-new hire is walked in, not dropped into a half-built shell: branded sign-in, an actionable path when access is still pending, and a nav that honestly separates what ships today from what's coming. The bones already exist for most of this — the work is finishing the loops, retiring the parallel models, and making identity, company, and governance real.

---

## 5. Suggested priority order (for debate)

1. **Verify Cloud Function deployment status** and reconcile the stale `WorkOrderWizard` comment. *(Dispatcher, Technician, Parts Associate — High)* — gates whether the "polished" screens actually work; cheap to check, outranks all UX work.
2. **Operating-company dimension (Taylor/Ventana), Option A.** *(Owner, Accounts/Sales — High)* — the one prerequisite unblocking cross-company oversight and the national-accounts story.
3. **Close the inventory write-loop (receive → ledger; ad-hoc parts; one scanner).** *(Parts Associate, Technician — High)* — turns a cosmetic terminal state into real stock truth and kills the demo mirage.
4. **In-product identity & access + Issue #100 least-privilege Inventory route.** *(Owner, Parts Associate, Accounts/Sales, New User — High)* — retires the CLI, unlocks the locked-out persona, no over-grants.
5. **Reconcile to one dispatch model; fix Control Tower coherence.** *(Dispatcher, Owner — High)* — one authoritative operation.
6. **Role-aware landings + shipped-vs-coming-soon nav + actionable no-access.** *(New User, Owner, Dispatcher — High/Medium)* — fixes first impressions cheaply using flags that already exist.
7. **Scheduling surface (datetime + calendar/timeline).** *(Dispatcher — High)* — the largest missing pillar of the dispatch mandate.
8. **Offline-first PWA for the technician shell.** *(Technician — High)* — the one place resilience matters most has none.
9. **Resolve opaque IDs to names + tap-to-navigate/call.** *(Dispatcher, Technician — Medium)* — high-frequency daily friction, low cost.
10. **Executive reporting rollup + provider-neutral Financial/forecast surface (honest empty state).** *(Owner, Accounts/Sales — Medium)* — replaces eight dead links and a permanently-empty panel.
11. **Commercial Profile (Phase 1, no Rules change) + editable Contacts/Locations + account→WO one-click.** *(Accounts/Sales — Medium)* — low-risk, high-value account maintenance.
12. **Purchasing/Warehouse real backends (Suppliers, line-item POs, Transfers, Cycle Counts) + editable Firestore part master.** *(Parts Associate — Medium)* — fills the five dead Inventory tabs.
13. **Persistent exception/notification center + low-stock alerts.** *(Dispatcher, Parts Associate — Medium)* — turns polling into push.
14. **Audit Logs reader over existing append-only trails.** *(Owner — Medium)* — data exists; only the read UI is missing.
15. **Photos + signature capture; self-service status + day timeline; weekly stats; sign-in branding/polish.** *(Technician, New User — Medium/Low)* — field-service table stakes and first-impression polish.