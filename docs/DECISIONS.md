# Decisions Log

Append-only record of Tier 1 decisions (per `docs/DelegationCharter.md` Section 3) that a future session would need to know: date, decision, reason, alternatives rejected. Small enough to skim weekly. ADR-worthy decisions get a full ADR instead and a one-line pointer here.

Do not edit or delete past entries — if a decision is superseded, log a new entry that says so and leave the original in place.

---

## 1. Charter adopted

**Date:** 2026-07-11
**Decision:** `docs/DelegationCharter.md` is in effect, governing this and future sessions. Claude holds Tier 1 decision authority (implementation, sprint scoping/sequencing, documentation maintenance, ADRs consistent with existing ones); Tier 2 items are escalated as `needs-decision` GitHub issues assigned to `@TaylorService-spec`; Tier 3 (commercial/spending/credentials) is never delegated.
**Reason:** Owner instruction, to shift Rudy's role from decision relay to exception handler.
**Alternatives rejected:** None — this is the founding entry.

## 2. ROADMAP.md's Sprint 2.1.4 status was stale

**Date:** 2026-07-11
**Decision:** Corrected `docs/ROADMAP.md`'s "Sprint 2.1.4 — not yet begun" line. Reality (confirmed via `docs/SPRINT_STATUS.md` and merged PR history): Sprints 2.1.1 through 2.1.10 are all merged and live, including Sprint 2.1.4 itself (Reorder Review & Decision, PR #69). Of the three named candidates the stale text offered (Review & Approval, Procurement Handoff, Receiving), the first is what Sprint 2.1.4 already built, and the second is effectively what Sprint 2.1.10 (Purchase Order Foundation) already built. Only **Receiving** remains genuinely unbuilt — explicitly out of scope in every Sprint 2.1.5–2.1.10 entry and listed as "Future Expansion" in `PlatformCapabilityModel.md`.
**Reason:** Charter's standing rule: "If reality contradicts the docs, that's a finding: fix the doc in the same PR or log it in DECISIONS.md." The stale line would have caused a future session (or this one, taken literally) to re-scope already-shipped work.
**Alternatives rejected:** Silently re-interpreting "Sprint 2.1.4" as the next real sprint without correcting the doc — rejected because it leaves the same trap for the next session that reads `ROADMAP.md` cold.

## 3. Next Inventory Management sprint scoped as Receiving (Reorder Request closeout)

**Date:** 2026-07-11
**Decision:** Scoped the next Inventory Management capability sprint as an audit-only **Receiving / Reorder Request closeout** step: a new terminal `ORDERED` → `RECEIVED` transition on the Reorder Request lifecycle, paired with a logged-only receipt note (same posture as Sprint 2.1.9's `inventory_actions`), explicitly not touching the `inventory_transactions` ledger. Numbered **Sprint 2.1.11** (continuing the existing sequence; `docs/capabilities/InventoryManagementPlan.md` only formally planned through 2.1.3, sprints 2.1.4–2.1.10 were scoped ad hoc afterward via `ROADMAP.md`/`CLAUDE_CONTEXT.md`, same pattern continues here). Full scope and acceptance criteria: GitHub issue (see `ROADMAP.md`/`SPRINT_STATUS.md` for the link once opened).
**Reason:** Only remaining named candidate not yet built (see entry #2). Checked against both standing constraints before committing:
- **Write-path rule** (`PROJECT_ARCHITECTURE.md`, `docs/architecture/SYSTEM_AUTHORITIES.md`): `inventory_transactions` is the Work-Order-driven, Admin-SDK-only ledger (ADR-003) — a client-direct write updating real stock counts would violate this. Scoping the receipt as a logged-only note (mirroring `inventory_actions`' existing `RECEIVE_STOCK` type) keeps the sprint on the client-direct-write side of that boundary, same as every 2.1.x sprint before it.
- **No-Blaze standing decision**: a trusted, ledger-updating Receiving write would require a Cloud-Function-mediated path, which needs Firebase Blaze (issue #15, not enabled). Scoping this sprint as audit-only avoids that dependency entirely; reconciling the audit note against real stock stays on `FUTURE_ARCHITECTURE_BACKLOG.md`'s existing backlog item (apply `inventory_actions` to `inventory_transactions` once Blaze is enabled) rather than being pulled into this sprint.
**Alternatives rejected:**
- Building real stock-count-updating Receiving now — rejected, would require a Cloud Function and Blaze, both blocked; would be Tier 2 (new deployment dependency) even if it weren't blocked outright.
- Starting Zero-history reorder sprint's PR 4 (Rules tightening) instead — rejected for this slot: it has an explicit precondition (PR #92 deployed, confirmed live, confirmed zero legacy-shape writes since) that hasn't happened yet; not a scoping choice, a hard blocker.
- Starting the Parts/Purchase Order Assignment Adoption sprint (`EmployeeAssignmentPicker` wiring) instead — rejected for this slot: explicitly marked "not to begin until Phase 3 fully lands" and needs a fresh Specification (the old one was never committed to the repo).

## 4. Correction to entry #3 — the `firestore.rules` change within Sprint 2.1.11 was mis-scoped as Tier 1

**Date:** 2026-07-11
**Decision:** Entry #3 above scoped all of Sprint 2.1.11, including its `firestore.rules` change (a new assignee-only `ORDERED` → `RECEIVED` write path), as a single Tier 1 decision. That was wrong: `docs/DelegationCharter.md` Section 2 lists "Changes to `firestore.rules` that alter who can read or write what" as Tier 2 (escalate) unconditionally — it does not carve out an exception for changes that follow an existing pattern or don't touch the Blaze-blocked ledger. The write-path-rule and no-Blaze checks in entry #3 were the right checks for *architectural* fit, but they don't substitute for the charter's separate, blanket Tier 2 reservation on Rules permission changes. The rest of Sprint 2.1.11's scope (domain function, UI, tests, doc updates) remains correctly Tier 1 — only the Rules change itself needed escalation.
**Caught by:** the environment's own permission classifier, at commit time, before anything was pushed to any remote branch. The implementation (rules + domain function + UI + tests + docs) was already fully written and its Rules tests passing (32/32 on a fresh emulator) when this was caught; it was stashed uncommitted on `sprint-2.1.11-receiving` rather than discarded, so no work is lost pending the decision.
**Reason:** Charter Section 4's escalation protocol — filed as `needs-decision` issue #97, assigned to `@TaylorService-spec`, with the specific Rules diff, the recommendation, and what happens under each option (approve / reject-or-modify / no response).
**Alternatives rejected:**
- Committing and opening the PR anyway, treating the classifier's block as a technicality — rejected outright; the charter's Tier 2 list is unconditional on this category, and working around a permission gate defeats the entire point of adopting the charter this session.
- Quietly reworking the rules change to look like a "read-only" or "narrower" change to avoid triggering the same review — rejected; the classifier's concern is the category of change (who can write what), not its size, and gaming that would be acting in bad faith toward the charter I was just asked to operate under.

## 5. Charter amended — Tier 1 now includes merging a Tier-1-only PR

**Date:** 2026-07-11
**Decision:** After PR #95 merged (Rudy's explicit approval) and issue #97 was approved, I attempted to merge PR #94 (docs-only, already verified accurate against live GitHub state earlier in the session) as ordinary Tier 1 "documentation maintenance." The environment's permission classifier blocked it: Rudy's prior "Approve" covered PR #95 and issue #97 specifically, not PR #94, and the charter's Tier 1 language ("Claude decides and logs; no approval needed") had never explicitly said whether that extended to the merge action itself, as opposed to the underlying decision to do the work. Asked Rudy directly; Rudy chose "Tier 1 PRs can be merged without asking" (as opposed to requiring an explicit approval every time). `docs/DelegationCharter.md` Section 2 amended accordingly (Amendment 1) **before** acting on the new authority, per the charter's own Section 7 requirement — then PR #94 was merged under it.
**Reason:** Charter Section 7 — Rudy amended the charter with a single message (an answered clarifying question, functionally the same as a direct instruction); the amendment is recorded here and in the charter's own "Amendment history" per that section's process.
**Alternatives rejected:**
- Treating Rudy's earlier general "3. ok" (in response to a status summary) as blanket merge authorization retroactively covering PR #94 — rejected; that "ok" acknowledged a plan/status update, not a specific merge request, and stretching it would have been the same "assume authorization from context" mistake flagged in `feedback_verify_before_recommending` (assistant memory).
- Leaving Tier 1 merge authority ambiguous and asking case-by-case forever — rejected once Rudy was asked directly and gave a clear standing answer; re-asking the same resolved question every time would just be noise.

## 6. PR #81 (Employee Foundation governance docs) corrected and merged under Tier 1 merge authority

**Date:** 2026-07-11
**Decision:** While `sprint-2.1.11-receiving` (PR #98) was blocked pending Rudy's manual Firestore Console spot-check (see the check requested in this session — not yet reported back as of this entry), picked up PR #81 as other Tier 1 work per the charter's "blocked work is set aside, other Tier 1 work continues" rule. PR #81's four governance docs (Assessment/Specification/Implementation Plan/Architecture Review for Employee Foundation) sat open through the entire span of PRs #82-#85 merging — the Architecture Review's "PR 4 remains not started" language and "does not extend to PR 4 in advance" caveat were accurate when written but stale for merge as-is (PR #85 merged 2026-07-10, before this correction). Corrected the review doc (PR 4/#85's actual merge, Implementation Plan status "in progress" → "complete", an explicit note naming the documentation-lag itself) and the three other docs' frontmatter (`status: Draft` → `Approved`, `related_pr` populated — all three were already functionally approved in prose, frontmatter just never reflected it) before merging, per the standing "fix the doc in the same PR, don't commit an already-stale record" rule (see entry #2 for the same pattern applied to `ROADMAP.md`).
**Reason:** Docs-only, no Tier 2 category touched (no `firestore.rules`, no governance-*meaning* change — this is correcting historical-record accuracy of an already-approved initiative, not re-deciding anything). Merged under the Amendment 1 Tier 1 merge authority (entry #5) once corrected, build/content verified.
**Alternatives rejected:**
- Merging PR #81 as originally written, stale PR-4 status included — rejected; would commit a governance record that's wrong about its own subject on arrival, the same trap `ROADMAP.md`'s stale "Sprint 2.1.4" line was (entry #2).
- Waiting for Rudy's spot-check result before touching anything else this session — rejected; the charter explicitly instructs continuing other Tier 1 work while something is blocked, not going idle.
