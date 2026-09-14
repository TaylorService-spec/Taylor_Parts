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

## Two shapes of the same dependency, and both are fenced

A dependency class is reached through two source shapes, and a fence that only knows the first one
is not a fence.

The **subpath** form names the class: `from "firebase-admin/firestore"`, `from
"firebase/firestore"`. That is what `matchesSpecifier` matches.

The **namespace** form names only the package root and so has no forbidden specifier at all:

```ts
import admin from "firebase-admin";                      // specifier: "firebase-admin"
await admin.firestore().collection("workOrders").get();  // same Firestore persistence
```

Confirmed empirically at main `64008d5ae0bdd9532909671b15a91122400accf1`, not inferred: a file of
that shape written under `functions/src` produced **zero** violations from a real ratchet run
(`--previous-baseline` against the committed baseline, exit 0), while the identical file written
with the `/firestore` subpath produced one violation (exit 1). Fifteen shapes were equally
invisible -- namespace import, aliased namespace, `require()`, chained
`require("firebase-admin").firestore()`, dynamic `import()`, `admin.app().firestore()`, the
`admin.firestore.FieldValue` sentinel namespace, a destructured handle, a reassigned alias, and the
frontend compat mirror (`firebase`/`firebase/app` plus `firebase.firestore()`,
`firebase/compat/firestore`, `firebase/compat/functions`).

The namespace form is matched by a category's optional `matchesSource`, as a **conjunction**: a bare
package-root import **and** a Firestore/Functions access expression in a **comment- and
string-blanked** view of the source. Both halves carry weight.

- The blanking is what keeps this from becoming the keyword scan the guard's header rejects:
  `admin.firestore()` reads identically in code and in prose, and this repository contains both.
- The access-expression half is what **preserves the identity carve-out**.
  `functions/src/eosApi/server.ts` imports the bare `firebase-admin` root -- dynamically, because
  the package is CJS -- purely for `app.auth().verifyIdToken()`. Importing the root is not the
  violation; persisting business data through it is.

`matchesSource` is consulted **only when `matchesSpecifier` did not match**, which makes
classification a strict superset of the specifier-only behaviour by construction: no committed
baseline entry can be lost or reclassified by adding it. The baseline is unchanged at **366** guarded
entries (55 + 55 + 184 + 72).

## The transitional shim boundary: growth is fenced, existence is not

The guard is a **direct-import** fence. A Firestore handle obtained in one module and re-exported
from it is invisible to the guard in every module downstream -- those modules reach Firestore
without naming a single forbidden specifier.

**Owner ruling:** approved transitional Firestore re-export shims **may remain temporarily**, and
recursively marking every existing consumer a violation is explicitly not the remedy. It would
produce hundreds of findings that identify no new authority.

`scripts/firebaseShimBoundary.mjs` holds the distinction the ruling requires. The dependency **is**
fenced at the shim: each shim is a guard baseline entry, it cannot move, and no new one can join it.
What was unfenced is the **growth of the consumer set** -- nothing stopped a new business module from
reaching Firestore through `import { db } from "../firebase/firebase"` and appearing nowhere in this
ledger. So the ratchet governs growth:

- the registry is **derived from the code** (a module that carries a guard-fenced Firestore
  dependency *and* exports a binding that hands Firestore/Functions authority across its boundary),
  never hand-listed -- a hand list goes stale silently, and a stale allow-list is a bypass;
- every consumer observed today is recorded in `docs/architecture/firebase-shim-consumer-census.json`
  and tolerated;
- the census is **shrink-only**: a new consumer fails, a removed one is the ratchet working, and a
  stale entry fails for exactly the reason a stale baseline entry does;
- a consumer that *also* imports the fenced dependency directly is **not** censused here -- it is a
  guard baseline entry and that ratchet already governs it. The two fences compose rather than
  double-governing one file.

**Insulation is not a shim.** A read hook, a query service, or a domain command that uses Firestore
internally and returns *data* hands no authority across its boundary, and its callers are not
consumers. Holding that line is the whole difficulty: three successive over-wide rules discovered
190, 65 and 21 "shims" before the current one, which discovers **4** with **5** tolerated consumers.

**Retirement happens with the underlying Firebase exit, not separately.** A module leaves the
registry automatically when it stops carrying a guard-fenced Firestore dependency, and its census
section must be deleted in the same change -- the stale-entry check enforces that. There is no
separate shim-retirement milestone to schedule, and none should be created.
