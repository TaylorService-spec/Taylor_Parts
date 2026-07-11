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
