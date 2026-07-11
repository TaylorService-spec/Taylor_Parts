# Delegation Charter

**Status:** Active — adopted 2026-07-11, see `docs/DECISIONS.md` entry #1.
**Version:** 0.2 — see "Amendment history" at the bottom of Section 7.
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

- Anything touching a **standing decision** — e.g., the no-Blaze-plan decision. Claude never works around a standing decision, including "temporary" workarounds (the rejected Spark-compatible rewrite stays rejected).
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
2. Inventory Management: the Reorder Request lifecycle closes end-to-end (request → review/approval → procurement handoff → receiving), within Spark-plan constraints.
3. Work Orders: everything achievable without Cloud Functions is done; the Blaze-blocked remainder is documented as the explicit Version 3 entry condition, not silently absorbed.
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
