# W1-C28 — Firebase Exit Guard scan coverage: handoff and open registrations

Branch: `impl/w1-guard-coverage` · Subject: `scripts/firebaseExitGuard.mjs`, `scripts/firebaseExitGuard.test.mjs`

## What this lane changed

`scripts/firebaseExitGuard.mjs` scanned only `field-ops-app-vite/src` and `functions/src`, and only
`.js/.jsx/.ts/.tsx`. `integrations/` — the standalone ChatGPT/MCP intake service, written entirely in
ESM `.mjs` — was scanned by no category and matched by no extension, so a module there could have
imported `firebase-admin/firestore` and the ratchet would never have seen it. The lane:

1. made `category.root` a genuine **per-file filter** (`categoryOwnsPath` / `categoriesForPath`), so a
   file is only ever classified against the categories whose root contains it;
2. added `.mjs` to `SCAN_EXTENSIONS`;
3. defined the four business-runtime classes once and crossed them with all three roots, so every
   class is fenced at every root.

The committed baseline was **not** touched: 369 guarded entries before, 369 after.

## Registrations this lane could NOT make (do-not-edit files)

These are real follow-ups, not nice-to-haves. Each needs an owner with edit rights on the file named.

### 1. `.github/workflows/firebase-exit-guard.yml` — path filter does not include `integrations/**`

The workflow is path-filtered:

```yaml
paths:
  - "field-ops-app-vite/src/**"
  - "functions/src/**"
  - "docs/architecture/firebase-exit-baseline.json"
  - "docs/architecture/firebase-exit-manifest.json"
  - "scripts/firebaseExitGuard.mjs"
  - "scripts/firebaseExitGuard.test.mjs"
  - ".github/workflows/firebase-exit-guard.yml"
```

`integrations/**` is absent from both the `pull_request` and the `push` filter. The guard now scans
`integrations/`, but **a PR that touches only `integrations/` will not trigger the workflow at all** —
which is precisely the case this change exists to catch. Until `- "integrations/**"` is added to both
filter lists, the new coverage is enforced only when a PR happens to also touch one of the paths
already listed.

`.github/workflows/**` is on this lane's do-not-edit list, so the one-line addition to each of the two
`paths:` blocks is left to the CI owner.

### 2. `docs/architecture/firebase-exit-manifest.json` — `BUSINESS_RUNTIME.baselineKeys` lists only four keys

The manifest is the authority for which baseline keys must trend to zero. It lists:

```
frontend.firestore_client, frontend.firebase_functions_client,
server.firebase_admin_firestore, server.firebase_functions_server
```

The guard now enforces twelve keys — the same four dependency classes at each of the three roots. The
eight additional keys (`frontend.firebase_admin_firestore`, `frontend.firebase_functions_server`,
`server.firestore_client`, `server.firebase_functions_client`, and the four `integrations.*`) are all
**empty** today and are ratchets pinned at zero, so nothing is mis-enforced; but the manifest's key
list is now narrower than what is actually fenced. It should be widened to the twelve for the two
documents to agree.

`docs/architecture/firebase-exit-manifest.json` is on this lane's do-not-edit list.

Note also `domainMigrationWaveModel.description` in the manifest defines a baseline file's domain as
"the first path segment beneath `field-ops-app-vite/src` or `functions/src`". That sentence will need a
third clause if an `integrations/` entry ever appears — it cannot today, because the set is empty and
any entry would be a violation to migrate off rather than a baseline row to add.

### 3. `docs/architecture/firebase-exit-baseline.json` — no `integrations` section

Deliberately not added. `baselinePathsFor` reads a missing section or key as the empty set, so the new
categories work without it, and adding empty arrays would have meant editing a do-not-edit file for no
enforcement gain. If a future change legitimately needs an `integrations` section, note that adding a
**path** to it would be caught by `evaluateRatchet` as a forbidden same-change baseline addition — which
is the intended behaviour.

## Not done / out of scope

* No SQL, no migration, no deploy.
* Firestore-emulator suites were not run: port 8080 on this host is held by an unrelated uvicorn
  service and the Admin SDK retries forever, so those suites hang rather than fail. Nothing in this
  change touches Firestore at runtime.
* `functions/` `npm audit` reports pre-existing advisories from `npm ci`. Untouched — unrelated to
  this lane.
