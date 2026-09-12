# ATLAS OBSERVATION BASELINE — ATLAS-BASE-2026-09-12-A

| | |
|---|---|
| **Baseline id** | `ATLAS-BASE-2026-09-12-A` |
| **Repository** | `TaylorService-spec/Taylor_Parts` |
| **Branch** | `main` |
| **Commit** | `64008d5ae0bdd9532909671b15a91122400accf1` |
| **State** | **POST-WAVE-1 MAINLINE** |
| **Pinned (UTC)** | 2026-09-12 |
| **Pinned by** | Program controller, on Owner instruction |

## What this commit is

The merge of PR **#1898** (`integration/wave-1`) into `main`, by **merge commit** — no squash, no rebase.

```
64008d5ae0bdd9532909671b15a91122400accf1
  parent 1  33945090d66d2287fe0cdc362c80ad6e4e311067   (main before the merge)
  parent 2  0ba8ab0d1bd7d83e7d1d0a529d8626fea06f92f0   (authorized integration head)
```
Subject: `Merge pull request #1898 from TaylorService-spec/integration/wave-1`

## Verified at pin time

- `origin/main` == `64008d5ae0bdd9532909671b15a91122400accf1`; local `main` updated to match exactly.
- Both merge parents are the two expected SHAs — confirmed by `git rev-list --parents -n1`.
- **32/32** Wave-1 source heads (PRs #1866–#1897) are ancestors. Zero not-ancestors, **zero missing objects**.
- `0ba8ab0d` is an ancestor of this commit.
- **33 merge commits** in `33945090..64008d5a` — the 32 source merges plus this PR merge. **Zero squashes.** Provenance intact.

## What this baseline IS

An **observational snapshot**: the exact tree against which Atlas code-derived findings dated 2026-09-12 were read.

## What this baseline IS NOT

It is **not** an eternal "current EOS" claim. Post-merge P2 fixes are already in flight on lane branches
(`post/eng-a-audit-read`, `post/eng-b-firebase-guard`, `post/eng-c-parity-vacuity`,
`post/eng-d-environment-fence`). **Any Atlas family opened after a further merge MUST pin and cite its own
baseline** — the exact tree actually reviewed for that family.

## Governing rule

> **A CORRECT CODE READING FROM THE WRONG BRANCH IS STILL A FALSE STATEMENT ABOUT THE PRODUCT.**

Every Atlas code-derived finding must carry `OBSERVED AT: <SHA or baseline id>`.

This rule is not theoretical. It has produced two real errors in this program:

1. A lane read `readGovernedList` resolving only against the three compatibility Roles, concluded the 45
   governed business Roles were declarations rather than live authority, and a design brief inherited it.
   The code was real — but it lives **only** on the unmerged branch `feat/rules-out-of-firebase`. At mainline
   the opposite is true: the governed Roles **are** live authority. A correct reading, a false product fact.
2. The controller briefed a worker that the Firebase guard "has 12 categories (4 classes x 3 roots)" and that
   "roots select which directories are walked, not a per-file filter" — **two facts from two different
   branches in one brief**, the second inverted by Wave 1. The rule now binds the controller's own briefs.

## Standing prohibition carried into every Atlas pass

`feat/rules-out-of-firebase` **must not be merged as-is** — it would reintroduce compat-only role resolution.
Reconcile anything useful from it against post-#1898 mainline instead.
