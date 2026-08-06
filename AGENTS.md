# Session Handoff Protocol

Last updated: 2026-07-14 23:34:06 -07:00 (America/Phoenix)

Use delta-only handoffs across Customer, Inventory, Platform, and Coordination sessions.

- Treat repository documents, merged pull requests, issue comments, and review history as the durable record of completed work and evidence.
- Do not repeat historical implementation details, completed validation matrices, or standing governance rules in each new authorization.
- Include only the current objective, exact starting state, newly changed scope, required gates, merge authority, stop conditions, and final reporting requirements.
- Begin every handoff with `Issued: YYYY-MM-DD HH:mm:ss Z (America/Phoenix)` and the exact relevant commit head. The commit head is authoritative; the timestamp helps identify stale instructions.
- Reference the authoritative repository document, issue, pull request, or prior evidence instead of copying it into the handoff.
- Restate prior evidence only when a new result changes it or when it is necessary to authorize a safety-sensitive action.
- Preserve newer work by integrating current `main`; never allow an older handoff to overwrite newer code or decisions.
- If the current head, file surface, project state, or governing decision differs from the handoff, stop and report the discrepancy before acting.

Keep handoffs short enough to scan once. Project history belongs in the repository, not in repeated session prompts.

# Operating mode — default autonomy (MANDATORY)

Operate autonomously through repo-only implementation work; Rudy is the exception handler, not an approval relay. **Do NOT stop for routine merge, documentation, exact-head, review-routing, or cleanup approvals.** For reversible repo-only work within an already-approved architecture with all required checks passing: implement the approved design, fix review findings, run verification, update user docs / execution records / `DECISIONS.md`, open PRs, complete governed review, merge approved Tier-1 PRs under the exact-head guard, clean branches/worktrees, and continue into the next already-directed section. Make small implementation decisions that have one reasonable governed answer, log the reasoning, and continue.

**STOP and ask the Owner only for genuine boundaries** (authoritative list: `docs/DelegationCharter.md` §8.3): a material product/architecture decision with multiple valid directions; a security/authorization-model change; a `firestore.rules` or other protected-policy change; a capability grant/revoke/role/access-administration action; a production deploy, Hosting release, Functions deploy, or live verification; a migration, destructive cleanup, production write, or rollback; spending/billing/vendor commitment; an irreversible action; crossing a clearly parallel-owned surface without a handoff; tests failing with a cause not safely resolvable within the approved design; uncertain evidence or an unproven zero-consumer/deletion claim; conflicting authoritative artifacts with no safe precedence; or scope that broadens beyond the approved direction.

Return at meaningful milestones, not after every PR — report what was done, what merged, verification performed, decisions made under governance, blocked items, and the next recommended lever (not routine approval questions). The human operator still executes all production-credentialed commands; the Owner still decides protected/material boundaries. **Full policy: `docs/DelegationCharter.md` §8 (Amendment 2).**

# Engineering model — deliver capabilities, not PRs

The unit of delivery is a **completed business capability**, not a commit/PR/section. Work moves through **DESIGNED → SANDBOX (emulator, synthetic data, no prod credentials) → INTEGRATION → RELEASE CANDIDATE → OWNER EXPERIENCE REVIEW → PRODUCTION (human operator executes) → OPERATIONALLY VERIFIED → RETIRED**; production is never the exploratory test environment and promotion is serialized. Multiple agents may work concurrently in isolated sandboxes — declare each assignment (capability, agent, role, branch/worktree, base commit, owned/shared paths, lifecycle stage) in [`docs/engineering/ACTIVE_WORKSTREAMS.md`](docs/engineering/ACTIVE_WORKSTREAMS.md): one active writer per owned path, no silent edits to reserved shared files, reviewers use repo evidence not chat memory. Be token-disciplined: reason once and persist, read artifacts before asking, targeted diff review over broad rediscovery, review depth by risk, report deltas. **Sequence by evidence, not by checklist:** at each capability/program boundary reassess the next item from current repo/architecture/production/risk/product evidence (priority order: active risk → blocking dependencies → reliability/recoverability → product value → high-leverage reuse → roadmap default); a new issue interrupts active work only when its risk/value materially exceeds the switch cost; record the reason + evidence and preserve deferred work. **Full model (incl. §1a Evidence-based sequencing): [`docs/engineering/AI_ENGINEERING_OPERATING_MODEL.md`](docs/engineering/AI_ENGINEERING_OPERATING_MODEL.md).**

# Ownership (MANDATORY posture)

**Founder and Product Owner: Rudy DiGiorgio.** Enterprise Operations OS is developed under his direction using AI-assisted engineering tools. Claude, ChatGPT, Codex (and their providers) are **development tools/delegated agents** — they own no company, product, equity, or authorship of record, and cannot license/assign/transfer IP or bind the Owner. Never describe an AI as an owner, founder, officer, legal author, or company principal, or use wording like "Claude's platform"/"AI-founded". Use "developed under the direction of Rudy DiGiorgio using AI-assisted engineering tools." A `Co-Authored-By:` AI trailer records the tool used, not IP ownership. Legal-entity/IP-transfer/trademark/patent decisions are Owner/counsel only — never performed via repo wording. **Full policy: [`docs/OWNERSHIP.md`](docs/OWNERSHIP.md) · [`LICENSE`](LICENSE).**
