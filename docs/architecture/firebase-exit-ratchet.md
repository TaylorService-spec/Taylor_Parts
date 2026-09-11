# Firebase Exit: the Ratchet

Target runtime: `Browser -> Vercel -> Firebase Auth token -> Render EOS API -> EOS authorization -> PostgreSQL`.
Firebase remains permitted only as **IDENTITY_ONLY** (sign-in, and Firebase UID correlation to an
EOS Principal/Employee). Everything else Firebase currently does for this repository --
Firestore reads/writes, Firebase Functions callables, firebase-admin Firestore persistence,
Firebase Functions server business runtime -- is **BUSINESS_RUNTIME** and must trend to zero.
See `docs/architecture/firebase-exit-manifest.json` for the full classification, migration
states, and dispositions.

## The mechanism

`docs/architecture/firebase-exit-baseline.json` is a deterministic, committed snapshot of every
live-runtime file currently using one of the four business-runtime dependency classes.
`scripts/firebaseExitGuard.mjs` enforces one rule:

> **The set of files depending on a business-runtime class may only shrink. It may never grow.**

That rule is enforced by two independent checks, both of which must pass:

1. **Exact match** (`evaluateGuard`) -- the candidate baseline must describe **exactly** the
   forbidden dependencies observed in the candidate source tree, in both directions:
   - a file using a forbidden dependency the baseline doesn't record is a **violation**;
   - a baseline entry the current scan no longer observes is a **stale entry**.

   A stale entry is **not informational and is not tolerated** -- it must fail the check until
   the baseline is edited to shrink in lockstep. The baseline is a floor precisely because every
   entry in it is required to describe a real, currently-observed dependency; an entry that
   outlived the dependency it once recorded is a live bypass, because the guard would otherwise
   let that file reintroduce the dependency later without ever tripping a violation. The baseline
   must shrink exactly when, and only when, source removal happens -- never ahead of it (that
   would forbid tolerated files that still need it) and never behind it (that's the stale-entry
   bypass).

2. **Ratchet** (`evaluateRatchet`) -- the candidate baseline is compared against the **previously
   accepted baseline** (the PR base commit, or the pre-push commit on `main`). For every
   business-runtime class, candidate paths must be a subset of previous paths: additions are
   forbidden, deletions are allowed. This check exists because the exact-match check above only
   ever looks at the *candidate* baseline against the *candidate* tree -- a single PR could add a
   new forbidden dependency **and** add the same path to the baseline in that same PR, and the
   exact-match check alone would see a baseline that matches its own tree and pass. Comparing
   against the previously accepted baseline is what closes that bypass. The first/bootstrap
   baseline (no previous baseline exists) has nothing to ratchet against, so this check is
   skipped for it -- but the exact-match check still applies in full.

A file already in the baseline for a class is tolerated there -- the guard does not force a
migration to happen in any particular change, and does not fail a PR for leaving an existing
dependency untouched. What it refuses is a **new** file, or an existing file crossing into a
**new** class it was not already recorded against, or an **abandoned** baseline entry left behind
after the dependency it recorded was removed.

This is a ratchet, not a gate: it can only turn one direction. Removing both a source dependency
and its baseline entry in the same PR moves the ratchet forward permanently -- there is no
mechanism in the guard to add an entry back once it is gone, short of editing the baseline file
itself in a change that also reintroduces the dependency in source, which the ratchet check
verifies against the previously accepted baseline.

## Why the baseline is a floor, not a to-do list

The baseline is not scoped as "the order to migrate in" or "the wave plan." It is scoped as "the
most Firebase business-runtime dependency this repository is allowed to have, starting now."
Nothing here decides which domain migrates first, or when -- see the (currently empty)
`domainMigrationWaveModel.waves` in the manifest. That scheduling is a separate decision made by
the engineers doing the migration work, recorded in the manifest once made.

## What is deliberately not fenced

`firebase/auth`, `firebase-admin/auth`, and `firebase-admin/app` are IDENTITY_ONLY and are not
part of the guard's `FORBIDDEN_CATEGORIES`. A file that imports only these never trips the fence,
no matter how many of them it imports -- that is correct, not a gap: identity is the one Firebase
capability this architecture keeps on purpose.
