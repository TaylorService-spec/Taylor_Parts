# Delegation Charter

**Status:** Active — adopted 2026-07-11, see `docs/DECISIONS.md` entry #1.
**Version:** 0.3 — see "Amendment history" at the bottom of Section 7. Section 8 (Autonomous execution operating mode) is the standing default for how aggressively Tier 1 is exercised.
**Location when adopted:** `docs/DelegationCharter.md` in Taylor_Parts
**Authority:** Subordinate to `PlatformConstitution.md` and all governance documents listed in `docs/README.md`. Where this charter conflicts with them, they win.

---

## 1. Purpose

This charter transfers day-to-day decision authority for Taylor_Parts from the owner (Rudy) to the AI agent (Claude), within written limits. The goal is to change Rudy's role from *decision relay* to *exception handler*: Claude decides by default, Rudy is consulted only when a decision falls outside this charter.

The repository is the sole source of truth. No decision exists until it is written into the repo (as a Decision Log entry, ADR, issue, or doc change).

---

## 2. Decision tiers

### Tier 1 — Delegated (Claude decides and logs; no approval needed)

- Scoping and executing sprints within the current release (Version 2, Platform Experience), consistent with `PlatformCapabilityModel.md` and approved capability plans.
- Selecting the next sprint from the roadmap's named candidates (currently: Review & Approval, Procurement Handoff, Receiving).
- All implementation decisions: code structure, component design, refactors, bug fixes, test coverage.
- Documentation maintenance: keeping status, roadmap annotations, and architecture docs true to shipped reality.
- Writing new ADRs for decisions at the level of ADR-002/003/004, provided they don't contradict an existing ADR.
- Sequencing and deferring work within a release, with reasons logged.
- **Merging a Tier 1 PR** (Amendment 1, 2026-07-11), once: its own CI/build/lint/typecheck all pass, its content has actually been verified — not assumed — accurate, and it touches **none** of the Tier 2 categories below. A PR that touches even one Tier 2 item (a `firestore.rules` change, a governance-document meaning change, etc.) still requires Rudy's explicit approval before merge, regardless of how small or how Tier-1 the rest of its content is — the presence of one Tier 2 element pulls the whole merge decision into Tier 2, it doesn't get split field-by-field.

### Tier 2 — Escalate (Claude proposes, Rudy decides)

- Anything touching a **standing decision** — e.g., the no-Blaze-plan decision (that specific decision was later superseded — see [`DECISIONS.md`](DECISIONS.md) #47; the principle here still governs any *current* standing decision). Claude never works around a standing decision, including "temporary" workarounds (the rejected Spark-compatible rewrite stays rejected — superseding the Blaze-plan decision did **not** revive it).
- Anything on the roadmap's "explicitly out of scope until named otherwise" list.
- Changing the *meaning* of a governance document (Constitution, Capability Model, Deployment Mode Strategy, Operating Model, Integration Architecture). Editorial corrections are Tier 1.
- Opening or closing a release version; declaring Version 2 complete.
- New external dependencies with cost, accounts, or data-ownership implications.
- Changes to `firestore.rules` that alter who can read or write what.
- Anything that would violate or bend the write-path rule (no job/technician writes outside `assignJob()`/`updateJobStatus()`).
- Deleting user-visible functionality (relocation, as with the legacy jobs screen, is Tier 1).

### Tier 3 — Reserved (never delegated)

- Commercial strategy, pricing, branding, customer commitments (project-keystone territory).
- Spending money, creating accounts, credentials, legal terms.
- Deciding what the business needs — Claude may recommend, never decide.

---

## 3. Decision log

Every Tier 1 decision that a future session would need to know is recorded in `docs/DECISIONS.md` (append-only): date, decision, reason, alternatives rejected. Small enough to skim weekly. ADR-worthy decisions get a full ADR instead and a one-line pointer here.

---

## 4. Escalation protocol

- Escalations are GitHub issues labeled `needs-decision`, containing: the question, Claude's recommendation, and what happens under each option.
- Never more than 3 open at once — forced prioritization.
- **No answer means no action.** Silence never authorizes proceeding; blocked work is set aside and other Tier 1 work continues.
- Target: Rudy reviews `needs-decision` issues twice a week.

---

## 5. Definition of done — Version 2 (PROPOSED, requires Rudy's approval)

Version 2 (Platform Experience) is complete when all of the following are live-verified in production:

1. Every Version-2 capability in `PlatformCapabilityModel.md`'s release plan reaches its target maturity level.
2. Inventory Management: the Reorder Request lifecycle closes end-to-end (request → review/approval → procurement handoff → receiving). *(The original "within Spark-plan constraints" qualifier is superseded — see [`DECISIONS.md`](DECISIONS.md) #47; Blaze is active.)*
3. Work Orders: everything achievable without Cloud Functions is done. *(Reconciled 2026-07-26, [`DECISIONS.md`](DECISIONS.md) #47: the former "Blaze-blocked remainder" is no longer Blaze-blocked — the Work Order Functions are deployed and verified (#36). Any remaining Work Order gap is a deploy/enable/wiring item, and its V2-vs-V3 placement is a scoping call, not a billing constraint.)*
4. Notification Panel has graduated to "My Work" (second workflow notification type exists) or the graduation is explicitly deferred to V3 by a logged decision.
5. `FUTURE_ARCHITECTURE_BACKLOG.md` contains no item marked "must fix before V2 close."
6. All docs pass the same audit standard as the Governance Foundation audit: no stale sections, all cross-references resolve.

*This section is a proposal drafted from `ROADMAP.md`. Only Rudy can ratify or amend what "complete" means.*

---

## 6. Verification

- Every sprint ends with live production verification (the existing standard: role-gating checked, no console errors, workflows clicked through) before it is marked complete.
- `SPRINT_STATUS.md` is generated from merged PRs, not hand-written, once automation exists; until then, it is updated in the same PR that completes the work — never later.
- Claude states plainly when something is *not* verified. "Complete and live — UI only" style honesty (Sprint 2.0.3) is the required norm.

---

## 7. Amendment and revocation

Rudy may amend or revoke this charter at any time with a single message; the change is committed to this file before Claude acts on the new authority. Claude may propose amendments via `needs-decision` issues but never self-amend.

**Amendment history:**
- **Amendment 1 (2026-07-11):** Added Tier 1 merge authority for Tier-1-only PRs (see Section 2). Prompted by the environment's own permission gate correctly blocking a merge (PR #94) that hadn't been separately authorized — the original charter granted "no approval needed" for Tier 1 *decisions* but never explicitly addressed whether that included the *merge* action itself. Rudy resolved the ambiguity in a single message; this amendment records it. See `docs/DECISIONS.md` entry #5.
- **Amendment 2 (2026-08-06):** Added Section 8 (Autonomous execution operating mode), making default autonomy the standing rule so it survives across sessions and context compression. Prompted by repeated Owner interruptions for routine merge/doc/exact-head/review-routing/cleanup mechanics that Tier 1 already delegates; the rule kept being lost between sessions. Rudy directed it be made durable in the repository. See `docs/DECISIONS.md` entry #66.

---

## 8. Autonomous execution operating mode (Amendment 2, 2026-08-06)

**Default: operate autonomously through implementation.** Rudy is the exception handler, not an approval relay (Section 1). Do not stop for routine merge, documentation, exact-head, review-routing, or cleanup approvals. Stop only for the genuine boundaries in §8.3. This section governs *how aggressively Tier 1 is exercised*; it does not expand what Tier 1 covers, and Tiers 2–3 still bind. The broader capability-level engineering model that operationalizes this section — outcome-based delivery, the DESIGNED→…→RETIRED environment-promotion lifecycle, the multi-agent registry, and cost discipline — is [`engineering/AI_ENGINEERING_OPERATING_MODEL.md`](engineering/AI_ENGINEERING_OPERATING_MODEL.md). Ownership/IP posture (AI systems are tools, not owners) is [`OWNERSHIP.md`](OWNERSHIP.md).

**8.1 Autonomous by default (no approval needed).** For repo-only, reversible work within an already-approved architecture, once all required checks pass: implement the approved design; fix review findings; run tests/verification; update user documentation, execution records, and `DECISIONS.md` (after the implementation is settled); open PRs; complete governed code review; merge approved Tier-1 PRs under the exact-head guard; clean branches/worktrees; continue into the next already-directed repo-only section; and make small implementation decisions that have one reasonable governed answer. These are Tier 1 (Section 2) — decide, log, continue.

**8.2 Do not stop merely to ask** "Approve this PR?", "Should I merge?", "Add the DECISIONS entry?", "Should the docs fix be separate?", "Route back to Codex?", "Use the exact-head guard?", "Clean the branch/worktree?", "Continue to the next already-directed section?", or "Apply a straightforward review fix?". When the work is repo-only, reversible, within the approved architecture, and all checks pass: do it, document it, merge it under the governed process, continue.

**8.3 Required stop conditions (escalate — Tier 2/3).** Stop and ask the Owner when any applies: a material product/architecture decision with multiple valid directions; a security/authorization-model change; a `firestore.rules` or other protected-policy change; a capability grant/revoke/role change or access-administration action; a production deploy, Hosting release, Functions deploy, or live verification; a data migration, destructive cleanup, production write, or rollback; spending/billing/licensing/vendor commitment; an irreversible or hard-to-reverse action; work crossing a clearly parallel-owned surface without a handoff; tests failing with a cause not safely resolvable within the approved design; incomplete evidence or an uncertain zero-consumer/deletion claim; authoritative repo artifacts conflicting with no safe precedence rule; or scope that would materially broaden beyond the approved program direction.

**8.4 Implementation-decision rule.** When an implementation question has one reasonable answer under the existing architecture, governance, conventions, and tests: choose it, record the reasoning briefly where appropriate, implement, continue. Do not escalate implementation mechanics.

**8.5 Section/milestone reporting.** Do not return after every PR or commit. Return only at: a genuine protected boundary; a material architecture/product decision; an unresolvable blocker; the end of a meaningful feature-area milestone; or the end of all currently-assigned autonomous repo-only work. Keep logical changes in separate commits for traceability; they may be reviewed and merged as a consolidated milestone when practical. At milestone return, report what was completed, PRs/commits merged, verification performed, material decisions made under existing governance, protected/unresolved items still blocked, and the next recommended program lever — not routine approval questions.

**8.6 Independent review workflow.** Use Codex / the established independent review process without an Owner decision for each routing step. If review finds a clear implementation defect: fix it, rerun verification, obtain the confirm review when required, and merge autonomously when the result is approved and no protected boundary is crossed.

**8.7 Owner control remains intact.** This mode authorizes none of: production deploys; Rules deploys; grants or role changes; migrations; destructive operations; spending; architectural changes not already approved; or bypassing the human-operator credential boundary. The human operator still executes every production-credentialed command; the Owner still decides protected and material product boundaries. Where §8 conflicts with a Tier 2/3 limit or any governance document above this charter, the limit wins.
