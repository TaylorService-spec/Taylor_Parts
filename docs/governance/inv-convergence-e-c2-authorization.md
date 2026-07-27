# INV-CONVERGENCE-E C2 — Owner Authorization Package (PartDetail cutover)

> **STATUS: PENDING — NOT AUTHORIZED. DO NOT MERGE PR #445 ON THE STRENGTH OF THIS
> DOCUMENT.** This package is *prepared for* Owner review. It records no
> authorization. §6 is deliberately unsigned; only the Owner may complete it, and
> the merge gate stays closed until §6 is filled in and a DECISIONS entry is
> appended. No AI session may self-certify the authorization this package requests.

| | |
|---|---|
| Gate | INV-CONVERGENCE-E **Stage C / C2** — PartDetail consumer source switch |
| Pull request | [#445](https://github.com/TaylorService-spec/Taylor_Parts/pull/445) (DRAFT) |
| Exact head under review | `53ec60020e98c8e8d8a79ee236ae835f56416442` |
| Functional commit | `94e322e5299e56e67fa8c8b99e46558d56a62502` |
| Base | `origin/main` @ `f97edf19a0027d8e0cc1ec591cbfc099e7a495c0` |
| Prepared | 2026-07-27 |
| Prepared by | INVENTORY workstream, this session |
| Authorization requested for | **Repository merge only.** Not deployment. |

---

## 1. Why this package exists

`docs/DECISIONS.md` entry **#46** satisfied the *live pre-cutover parity* gate for
build `73d9e1b`, but its **Effect** clause is explicit that satisfaction of that gate
is not itself cutover authority:

> **Stage A remains diagnostic and non-authoritative; this does NOT authorize a
> consumer source switch or a PartsList/PartDetail cutover.** … Successors (each
> separately gated): D (approved-ten disposition) and B (operational-role Rules) —
> both prerequisites — then C1 (PartsList) → **C2 (PartDetail)** cutover, each
> requiring live parity immediately before the switch.

The Codex review of PR #445 (2026-07-27, at head `53ec600…`) returned
**CODE PASS — GOVERNANCE HOLD** for exactly this reason: the separate C2
authorization #46 requires is **not linked in the repository or the PR**. This
document creates that linkage so the authorization, once given, is recorded against
a specific PR and a specific head rather than living only in conversation.

## 2. Prerequisite chain — status

| Gate | Required by #46 | Status |
|---|---|---|
| Stage A — live pre-cutover parity | prerequisite | **SATISFIED** — DECISIONS #46, build `73d9e1b`, 190 canonical + 10 governed exclusions, 0 divergences |
| Stage D — approved-ten disposition | hard prerequisite for cutover | **DECIDED** — the ten remain visible as `STATIC_ONLY_EXCLUDED`, routes preserved |
| Stage B — operational-role `parts` Rules | hard prerequisite for cutover | **DEPLOYED + VERIFIED** |
| **C1 — PartsList cutover** | must precede C2 | **MERGED + DEPLOYED + VERIFIED LIVE** (PR #441 → `3827ce37`; Hosting gate closed via PR #443 → `f97edf1`) |
| **C2 — PartDetail cutover** | **this gate** | **CODE COMPLETE, AWAITING THIS AUTHORIZATION** |

C2's own ordering precondition (C1 first) is satisfied: C1 is not merely merged, it
is live in production and verified.

## 3. What is being requested

**Authorization to merge PR #445 into `main` at head `53ec60020e98c8e8d8a79ee236ae835f56416442`, as a repository-only change.**

That is the entire request. Specifically **in scope**:

- merge the 13-file change (5 implementation/test, 8 evidence/governance);
- delete the merged branch and synchronize `main`.

Explicitly **NOT** in scope and **NOT** requested here:

- any deployment of any kind (Hosting, Rules, Functions, indexes) — the C2 Hosting
  deployment remains a **separate future gate** with its own authorization;
- any Firestore, Firebase Auth, identity, role, claim, or production-data mutation;
- any Parts data migration, rename, restructure, deletion, or rewrite;
- any change to the Customer or Auth streams;
- retirement of the static catalog or the Functions mirror (Phase F).

## 4. What merging actually changes in production

**Nothing, immediately.** Merging PR #445 changes repository state only. The C2
behavior reaches users only when a future, separately-authorized Hosting deployment
ships a build containing it. This mirrors C1 exactly: C1 merged (PR #441) and went
live only at its own later Hosting gate (PR #443).

**Live-parity timing.** #46 requires live parity "immediately before the switch." The
C1 precedent placed that requirement at the **deploy** gate, not the merge — C1's
merged record states a fresh live parity re-run "belongs to the future C1 DEPLOY
gate." This package follows that precedent and asks for **merge only**, leaving the
live-parity-immediately-before re-run as a condition of the future C2 deploy gate.
*If the Owner or Codex reads #46 as attaching that requirement to the merge instead,
this package should be rejected and a live C2 parity run performed first.* Flagged
deliberately rather than resolved unilaterally.

## 5. Verification state at the authorized head

Independently confirmed by Codex at head `53ec600…`, and re-confirmed by this session
immediately before preparing this package (no drift: local head == `origin` head ==
`53ec600…`; base `origin/main` still `f97edf1`):

| Check | Result |
|---|---|
| Codex review verdict | **CODE PASS** — no actionable code, correctness, security, or regression findings |
| C2 suite `test/partDetailView.test.mjs` | 34 / 34 |
| C1 regression `test/partsCatalogView.test.mjs` | 23 / 23 |
| Full client chain, lint, typecheck, build | pass |
| `verify:build-base` | 12 / 12 |
| GitHub Vite checks | both pass; PR `MERGEABLE` / `CLEAN` |
| Evidence checksums (`sha256sum -c`) | OK |
| Sensitive scan | CLEAN |
| Scope | 13 files; **zero** Rules / Functions / Firebase config / Auth / Customer / production changes |

**Design decisions approved by Codex** (and requiring Owner ratification in §6):

- **D-C2-1** — render the canonical normalized unit token (`EACH`) rather than the
  raw static token (`ea`). Verified for all 200 that rendered `== normalizeUnit(static)`;
  Stage A measured `UNIT_DIVERGENCE = 0`, so meaning is unchanged — only the token.
- **D-C2-2** — fail closed by blocking the **complete** PartDetail page (including the
  entire write surface) when canonical verification is denied, unavailable, or
  incomplete.

## 6. Owner authorization — TO BE COMPLETED BY THE OWNER

> This section is intentionally blank. It is not filled in by any AI session.

```
I authorize the INV-CONVERGENCE-E C2 PartDetail cutover to be MERGED into main
as a repository-only change, at PR #445, exact head
53ec60020e98c8e8d8a79ee236ae835f56416442.

I ratify design decisions D-C2-1 (canonical unit token) and D-C2-2 (fail-closed
full-page block).

I understand this authorizes NO deployment and NO production, data, Rules,
Functions, Auth, or identity change, and that the C2 Hosting deployment remains a
separate gate requiring its own authorization.

Owner: ______________________    Date: ______________
```

**On completion:** this file's status header is updated to AUTHORIZED with the
Owner's verbatim statement and date, an append-only entry is added to
`docs/DECISIONS.md` recording the C2 authorization against this head, and PR #445
returns to Codex for **final drift/merge review** before any merge occurs.

## 7. Prior authorization on record — scope and limits

For completeness and to avoid overstating what already exists, the Owner
authorization that produced this work is quoted verbatim:

> "Approved: begin repository-only C2 PartDetail cutover from current origin/main."
> … "Do not merge without Codex review." (Owner, this workstream, 2026-07-27)

**What it covered:** *beginning* repository-only C2 implementation work from
`origin/main`, and it expressly withheld merge pending Codex review.

**What it does not cover:** it was given **before PR #445 existed**, so it is not
bound to head `53ec600…`; it is not recorded in the repository; and it does not by
itself satisfy the separately-gated C2 cutover authorization that DECISIONS #46
requires. Codex having now returned CODE PASS discharges the "not without Codex
review" condition, but **does not** supply the #46 authorization. That is precisely
the gap §6 exists to close.

## 8. Rollback

Revert the single functional commit `94e322e`. Pure code revert, **zero data effect**,
no migration — C2 performs no writes of any kind. C1 is unaffected and does not need
reverting (the shared-guard extraction is behavior-neutral; C1's 23/23 pass before and
after).

## 9. Evidence

`docs/audits/inv-convergence-e-c2-partdetail-cutover/` — README, diff-scope, parity,
test-summary, rollback, SHA256SUMS (`sha256sum -c` OK, `-text` EOL pinned, sensitive
scan CLEAN). Parity there is **offline and fixture-based**; it is not a live parity
run, and is not offered as one.
