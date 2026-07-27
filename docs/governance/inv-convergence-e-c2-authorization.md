# INV-CONVERGENCE-E C2 — Owner Authorization Package (PartDetail cutover)

> **STATUS: AUTHORIZED — repository merge only (Owner, 2026-07-27).** The Owner
> authorization is recorded verbatim in §6 and in the append-only
> [`docs/DECISIONS.md` entry #49](../DECISIONS.md). **This authorizes NO deployment
> and NO production change**; the C2 Hosting deployment remains a separate gate.
> The merge is additionally **subject to Codex final drift/merge review** and does
> not proceed on this document alone.

| | |
|---|---|
| Gate | INV-CONVERGENCE-E **Stage C / C2** — PartDetail consumer source switch |
| Pull request | [#445](https://github.com/TaylorService-spec/Taylor_Parts/pull/445) (DRAFT) |
| Exact head under review | `53ec60020e98c8e8d8a79ee236ae835f56416442` |
| Functional commit | `94e322e5299e56e67fa8c8b99e46558d56a62502` |
| Base | `origin/main` @ `f97edf19a0027d8e0cc1ec591cbfc099e7a495c0` |
| Prepared | 2026-07-27 |
| Prepared by | INVENTORY workstream, this session |
| Authorization granted for | **Repository merge only.** Not deployment. |
| Authorized head | `abfb1a4718bba4e0be95f8b3449d6723a6c8da00` (Owner, 2026-07-27 — see §6) |

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
| **C2 — PartDetail cutover** | **this gate** | **AUTHORIZED for repository-only merge** (Owner, 2026-07-27, §6; `DECISIONS.md` #49) — **not yet merged**, pending Codex final drift clearance |

C2's own ordering precondition (C1 first) is satisfied: C1 is not merely merged, it
is live in production and verified.

## 3. What is being requested

**Authorization to merge PR #445 into `main` as a repository-only change.**

That is the entire request. Specifically **in scope**:

- merge the change (see the scope table below);
- delete the merged branch and synchronize `main`.

### 3.1 Scope as originally reviewed vs. current PR scope

The head and file count below changed as governance records were added. Both are
recorded so neither figure is read as describing the other.

| | Head | Files | Split |
|---|---|---|---|
| **As originally reviewed** (the request this package was drafted against; Codex CODE PASS) | `53ec60020e98c8e8d8a79ee236ae835f56416442` | **13** | 5 implementation/test + 8 evidence/governance |
| **Owner-authorized head** (§6) | `abfb1a4718bba4e0be95f8b3449d6723a6c8da00` | 14 | 5 implementation/test + 9 evidence/governance |
| **Current PR scope** | see §6 disclosure | **15** | **5 implementation/test + 10 evidence/governance** |

**Every post-review change is documentation-only.** The 5 implementation/test files
are unchanged throughout and remain **byte-identical to the Codex-passed head
`53ec600…`**; the growth from 8 → 10 evidence/governance files is this authorization
package, `DECISIONS.md` #49, and the `SPRINT_STATUS.md` update — i.e. the act of
recording the authorization itself.

The 5 implementation/test files: `src/domain/partDetailView.js`,
`src/domain/partsCatalogView.js`, `src/modules/inventory/PartDetail.jsx`,
`test/partDetailView.test.mjs`, `field-ops-app-vite/package.json`.

The 10 evidence/governance files: the six under
`docs/audits/inv-convergence-e-c2-partdetail-cutover/`, plus `.gitattributes`,
`docs/SPRINT_STATUS.md`, `docs/DECISIONS.md`, and this package.

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

> **RESOLVED (Owner, 2026-07-27, §6):** fresh live parity belongs to the separate C2
> Hosting deployment gate, following the C1 precedent, and is **not** required
> before this repository-only merge. This was flagged rather than resolved
> unilaterally, and the Owner has now decided it.

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
| Scope | **13 files as reviewed at `53ec600…`; 15 files currently** (5 implementation/test + 10 evidence/governance — see §3.1; all growth documentation-only). **Zero** Rules / Functions / Firebase config / Auth / Customer / production changes throughout |

**Design decisions approved by Codex** (and requiring Owner ratification in §6):

- **D-C2-1** — render the canonical normalized unit token (`EACH`) rather than the
  raw static token (`ea`). Verified for all 200 that rendered `== normalizeUnit(static)`;
  Stage A measured `UNIT_DIVERGENCE = 0`, so meaning is unchanged — only the token.
- **D-C2-2** — fail closed by blocking the **complete** PartDetail page (including the
  entire write surface) when canonical verification is denied, unavailable, or
  incomplete.

## 6. Owner authorization — GRANTED

**Granted by:** Owner (Rudy DiGiorgio) · **Date:** 2026-07-27 ·
**Authorized head:** `abfb1a4718bba4e0be95f8b3449d6723a6c8da00`

Verbatim:

> I authorize the INV-CONVERGENCE-E C2 PartDetail cutover to be merged into main as
> a repository-only change through PR #445 at current head
> `abfb1a4718bba4e0be95f8b3449d6723a6c8da00`.
>
> I ratify:
>
> - D-C2-1: canonical normalized unit tokens.
> - D-C2-2: fail-closed full-page blocking when canonical verification is denied,
>   unavailable, or incomplete.
>
> The docs-only delta after the Codex-reviewed code head is accepted, subject to
> Codex final drift review.
>
> Fresh live parity belongs to the separate C2 Hosting deployment gate, following
> the C1 precedent. It is not required before this repository-only merge.
>
> This authorization permits repository merge only. It does not authorize
> deployment, Firebase changes, Firestore or Auth mutation, identity/role/claim
> changes, Parts data migration, or any other production change.

**Head authorized vs. head reviewed.** The Owner authorized `abfb1a4…`, which is
**code-identical** to the Codex-reviewed head `53ec600…`; the delta between them is
one documentation file (+168 lines — this package in its PENDING form), with zero
code, test, or configuration change. Recording this authorization necessarily
advances the head again; that further delta is likewise documentation-only
(this §6 update plus `DECISIONS.md` #49) and is disclosed to Codex for the final
drift review the Owner made this authorization subject to.

**Live-parity timing — resolved by the Owner.** The ambiguity flagged in §4 is
settled: fresh live parity attaches to the **C2 Hosting deployment gate**, per the
C1 precedent, and is **not** required before this repository-only merge.

**Recorded in:** `docs/DECISIONS.md` entry **#49** (append-only; #46 not edited).

**Remaining condition before merge:** Codex **final drift/merge review**. The merge
does not proceed on this authorization alone.

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
the gap §6 exists to close — and §6 now closes it with a head-bound Owner
authorization recorded in `DECISIONS.md` #49.

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
