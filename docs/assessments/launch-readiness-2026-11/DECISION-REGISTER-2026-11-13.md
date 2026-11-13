# EOS Launch Decision Register

Issued: 2026-11-13 (America/Phoenix) · Inputs: [LAUNCH-READINESS-AUDIT-2026-11-13.md](LAUNCH-READINESS-AUDIT-2026-11-13.md), the 34 proposed decisions, the Owner's strategic direction of 2026-11-13, DECISIONS #233/#234, `docs/governance/owner-commercial-spec-rulings-2026-10-20.md` (#2182), and the controller log. Nonprod is at UAT-R2.5 (`e4a4d95b`, released 2026-11-13).

**This is a register, not an authorization.** Each "Recommended decision" is a proposal. Rows marked **CONFIRM** need an explicit Owner answer before anything happens: commercial, legal, security-policy, permission, spend or production authority. Nothing in this register widens permissions, lifts a hold, buys a service, changes production or touches a legal agreement on its own.

## Owner direction applied

- **Goal:** Taylor and Ventana operating in EOS, then continuous evolution. Launch is **not** gated on finishing every planned specification.
- **Priority order:**
  1. Essential employee workflows and Codex acceptance.
  2. Security, identity, company isolation and audit.
  3. Production architecture, backups, monitoring and support.
  4. Controlled migration and Firebase retirement.
  5. Repeatable onboarding and deployment.
  6. Commercial and legal.
- **Impact classes:**
  - **BLOCKER:** go-live cannot happen without it.
  - **ENABLER:** needed soon after go-live, or to operate safely at scale.
  - **ENHANCEMENT:** continuous evolution. Not a launch gate.

## Resolved since the audit (no decision needed)

| Item | Resolution |
|---|---|
| #2200 Work Order company boundary | Merged `52b6ce18` after security review; released to nonprod in R2.5 |
| #2231 / #2232 release candidate (was item 29) | Released in R2.5 (`e4a4d95b`) |
| #2215 Warehouse Manager reorder read (was item 27) | Owner approved PARTS-404 / RO-02 on 2026-10-21 (controller log). Remaining step: normal review, CI and merge under standing rules |

## Register

### 1. Essential workflows and acceptance

| # | Decision | Recommended | Existing Owner ruling | Needs Owner? | Impact | Immediate next action | Lane |
|---|---|---|---|---|---|---|---|
| D1 | Day-1 scope | Day-1 is the proven employee workflows: service and dispatch, technician, parts, warehouse, purchasing and receiving, CRM, F-1 invoicing, administration. Q-1 quotes, D-1 delivery, W-1 warranty and T-1 territories become **post-launch enhancements**, built in the order already ruled. REC break-glass is designed before go-live. | #2182 rulings set the build **order** (Finance → Reservations → Quotes → Delivery → Warranty → Territories → Recovery) but not a Day-1 cut | **CONFIRM** (product scope) | BLOCKER (defines the gate) | Owner confirms the Day-1 list | — |
| D2 | Target go-live window | Owner sets a target month. Engineering reports the critical path against it. | none | **CONFIRM** | BLOCKER | Owner names a month | — |
| D3 | Close nonprod UAT on R2.5 | Run Codex tests 9 and 10, R2.3 Parts zero-403 and Access-explained on R2.5. Do the owed live walks: TW4/TW5, rebill, settlement, General Manager, Office Manager, Dispatcher UI. | Codex acceptance is an established gate | No (repo/UAT work) | BLOCKER | Hand the Codex plan in the R2.5 manifest to Codex; schedule persona walks | L1 |
| D4 | Ventana in Day-1 and FIX-VEN (#2216) | Yes. Approve the nonprod-only key binding so Taylor↔Ventana isolation can be tested live. | #234 O-9 keeps Taylor and Ventana isolated; FIX-VEN is Level 3 | **CONFIRM** (configuration) | BLOCKER | Owner approves #2216, then a Ventana persona fixture and cross-company test | L1 |

### 2. Security, identity, isolation and audit

| # | Decision | Recommended | Existing Owner ruling | Needs Owner? | Impact | Immediate next action | Lane |
|---|---|---|---|---|---|---|---|
| D5 | New-person onboarding | Build a governed "create login-ready person" operation: Principal plus membership plus login account, audited, Administrator-only. Hand over by setup code now; add email invite once D6 is decided. | Owner 10-30: "fine with a code if proven; expects emailed invite" | **CONFIRM** (security model) | BLOCKER | Owner approves the design direction, then a design note and implementation | L2 |
| D6 | Outbound email provider | Microsoft 365 through Taylor's tenant, or a transactional provider. Owner's choice. | D-5 / #54: provider deferred | **CONFIRM** (vendor and spend) | ENABLER (invites, resets) | Owner picks | — |
| D7 | Authenticator (MFA) policy | Required for everyone. New login accounts default to required. | Pending (WORK-QUEUE B) | **CONFIRM** (security policy) | BLOCKER | Owner confirms, then flip the default and add a server check | L2 |
| D8 | Moving real employees off Firebase sign-in | Fresh enrollment in EOS (Administrator issues each person's setup code). No Firebase account migration tool. | #234 O-1 zero Firebase; identity cutover separately gated | **CONFIRM** (identity cutover) | BLOCKER | Owner confirms the approach; the cutover itself stays a separate approval | L2 |
| D9 | Identity provider (D-2) | EOS native login now; SSO later as an additional binding. | `eos-native-identity.md` D-2 awaits confirmation | **CONFIRM** | ENABLER | Owner confirms | — |
| D10 | Security headers and scanning | Add CSP and frame-ancestors on web and API, and HSTS on the API. Turn on Dependabot security updates and CodeQL default setup. | none | Headers: No. Scanning: **CONFIRM** (repo setting, admin action) | ENABLER (security hygiene) | Lane builds the headers PR. Owner enables scanning or authorizes it. | L2 |
| D11 | Database tenant backstop (RLS) | Defer. It is not a Taylor blocker under dedicated deployments (#234 O-9). Required before any shared multi-tenant use. | #234 O-9 dedicated deployments | No (defer) | ENHANCEMENT (for L1) | Record as a Phase-0 item for shared SaaS | — |
| D12 | Recovery break-glass (REC) | Design both secondary-Owner resilience and an operator recovery ceremony. Keep the Firebase production break-glass until the ceremony is accepted. | #2182 REC OD-1 (design both); OD-14 | No (design only) | BLOCKER (design before go-live) | Lane writes the design | L2 |
| D13 | #2210 SAL-01 security hold | Keep the hold until the Owner lifts it. | Owner hold 2026-10-21 | **CONFIRM** to lift | ENHANCEMENT | Owner: lift or keep | — |

### 3. Grant and permission baseline

These are all **CONFIRM** rows: permission changes, never automatic.

| # | Decision | Recommended | Existing ruling | Impact | Immediate next action | Lane |
|---|---|---|---|---|---|---|
| D14 | 228 grants with no governed command | Authorize the registry/catalog design. Grant nothing new in the meantime. | GRID-APPLY recorded them, not applied | ENABLER | Owner: authorize the design | L2 |
| D15 | 48 self-approval exemptions | Drop, except where an Owner rule already exempts the protected Owner. | Owner 10-20: protected Owner needs no second approver | ENABLER | Owner: confirm the list | L2 |
| D16 | 12 grid rows that conflict with code rules | Correct the grid to match code; the server stays authoritative. | none | ENABLER | Owner: confirm | L2 |
| D17 | Sales Manager `audit.event.read` | End the 2 scoped assignments. | none | ENABLER | Owner: confirm | L2 |
| D18 | Systems Administrator keys | Revoke the superseded `reorder.request.read.queue`. Revoke the 3 part-cost keys unless finance needs them (#230). | #230 field groups | ENABLER | Owner: confirm both | L2 |
| D19 | `admin` role's business capabilities (DQ-210-A) | Trim to administration plus the protected-Administrator standing (#223). Execute after D3 so acceptance isn't disrupted. | #222/#223 Administrator full authority by standing | ENABLER | Owner: confirm the trim set | L2 |
| D20 | Role renames and 32 non-job roles | Apply the 3 renames. Review the 32 after go-live. | #2225 display names merged | ENHANCEMENT | Owner: approve renames | — |

### 4. Production architecture, backups, monitoring, support

| # | Decision | Recommended | Existing Owner ruling | Needs Owner? | Impact | Immediate next action | Lane |
|---|---|---|---|---|---|---|---|
| D21 | Production EOS environment for Taylor | Design the dedicated production deployment now: blueprint, production-mode fences, environment registry entry. Deployment remains a separate approval. | #234 O-9 principle; production separately gated | Design: No. Deploy: **CONFIRM** | BLOCKER | Lane drafts the blueprint and fence changes (no deploy) | L3 |
| D22 | Backups | Backup policy plus a restore rehearsal in nonprod. Upgrade the Render Postgres plan only if point-in-time restore requires it. | none | Rehearsal: No. Plan upgrade: **CONFIRM** (spend) | BLOCKER | Lane writes the policy and rehearsal script; Owner approves any plan change | L3 |
| D23 | Monitoring and alerting | Choose an error-tracking and uptime vendor within a monthly cap. Add structured logs with request and company ids. | none | **CONFIRM** (vendor and spend) | BLOCKER | Owner sets the cap; lane adds structured logging now (no vendor needed) | L3 |
| D24 | Support and on-call | Name the go-live support owner, the escalation path and severity levels. | C1-SUPPORT-01 OPEN | **CONFIRM** | BLOCKER | Owner names the people; lane drafts a one-page runbook | L3 |

### 5. Migration and Firebase retirement

| # | Decision | Recommended | Existing Owner ruling | Needs Owner? | Impact | Immediate next action | Lane |
|---|---|---|---|---|---|---|---|
| D25 | Production Firestore data | Export and archive before any Firebase project retirement. Migrate only Day-1 opening data. | Historical copies held. OD-F1-12: no historical invoice copy; numbering stays seedable | **CONFIRM** | BLOCKER (for cutover) | Owner answers | — |
| D26 | Opening-data source and sign-off | Owner and Taylor name the source per data set and the person who signs off reconciliation. | C1-DATA-01 / C1-INV-01 OPEN | **CONFIRM** | BLOCKER | Owner names them | — |
| D27 | Migration rehearsal | Rehearse on a read-only export loaded into nonprod only. | Production action not authorized | **CONFIRM** (production read) | BLOCKER | Owner authorizes the export; lane prepares rehearsal tooling | L3 |
| D28 | Firebase code removal from `main` | Continue replace → verify → remove. Remove the unscoped legacy Firestore Work Order callables once confirmed undeployed or replaced. Deleting `firestore.rules` comes last. | 10-19 rule: replace, verify, remove; `main` EOS-only; destructive retirement held | Code removal: within the rule. Resource retirement: **CONFIRM** | ENABLER | Lane continues serialized removals under the rule | L3 |

### 6. Onboarding repeatability, commercial, legal

| # | Decision | Recommended | Existing Owner ruling | Needs Owner? | Impact | Immediate next action |
|---|---|---|---|---|---|---|
| D29 | Second customer horizon | State whether one is expected within 6 months, and the industry. That decides when de-coupling starts. | #234 O-9 | **CONFIRM** | ENHANCEMENT (for L1) | Owner answers |
| D30 | Taylor pricing (C1-COMM-01) | Subscription plus implementation fee, priced on the dedicated-deployment floor plus operations. | none | **CONFIRM** (commercial) | BLOCKER for the contract, not for software | Owner decides |
| D31 | Customer agreement: MSA, DPA, SLA (C1-CONTRACT-01) | Counsel drafts, Owner approves. | none | **CONFIRM** (legal) | BLOCKER for the contract | Owner engages counsel |
| D32 | Legal entity in LICENSE / OWNERSHIP | Owner and counsel only. Agents change no wording. | `OWNERSHIP.md` §7 | **CONFIRM** (legal) | ENABLER | Owner with counsel |
| D33 | Repository privacy | Keep deferred to final delivery. Recommend revisiting before production go-live. | #233 deferred | **CONFIRM** if changing | ENABLER | Owner: keep or change |
| D34 | Close #2127 (folded into #2200) and stale PRs | Close #2127 and the 6 stale PRs from triage. | Controller: "Owner's call" | **CONFIRM** | Housekeeping | Owner: approve closures |

## Three engineering lanes

These include the controller's existing lanes; this register adds no fourth.

| Lane | Scope (rows) | Priority | Runs without the Owner now |
|---|---|---|---|
| **L1: Workflows and acceptance** | D3, D4 (after approval); defects from Codex and persona walks | 1 | Codex hand-off on R2.5, owed persona walks, defect fixes |
| **L2: Security, identity and isolation** | D5, D7, D10, D12, D14–D19 (after approvals) | 2 | Headers PR (D10), REC design (D12), onboarding design note (D5) |
| **L3: Production, operations and migration** | D21–D24, D27, D28 | 3–5 | Production blueprint design (D21), backup policy and rehearsal script (D22), structured logging (D23), support runbook draft (D24), Firebase removals under the rule (D28) |

Commercial and legal rows (D29–D33) are Owner/counsel work and have no engineering lane.

## The Owner answers that unblock the most

In order: **D1, D2, D4, D5, D7, D8, D21-deploy, D23, D24, D25–D27.**

Answers can be shorthand, for example `D1 yes, D2 Feb, D4 yes, D7 everyone`.
