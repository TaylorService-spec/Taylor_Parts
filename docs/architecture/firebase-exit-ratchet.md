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
`scripts/firebaseExitGuard.mjs` compares the baseline against the tree on every change and
enforces one rule:

> **The set of files depending on a business-runtime class may only shrink. It may never grow.**

A file already in the baseline for a class is tolerated there -- the guard does not force a
migration to happen in any particular change, and does not fail a PR for leaving an existing
dependency untouched. What it refuses is a **new** file, or an existing file crossing into a
**new** class it was not already recorded against.

This is a ratchet, not a gate: it can only turn one direction. Every PR that removes a baseline
entry moves the ratchet forward permanently -- there is no mechanism in the guard to add an entry
back once it is gone, short of editing the baseline file itself, which is a deliberate, reviewable
change to the floor, not something a feature PR does incidentally.

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
