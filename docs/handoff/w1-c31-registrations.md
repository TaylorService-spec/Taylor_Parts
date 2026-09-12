# W1-C31 — Ownership model substrate: registrations

Branch `impl/w1-ownership-model`. Scope: `functions/src/ownership/` only — the ownership
substrate, never the objects that depend on it.

## 1. Tests: already registered, nothing to add

The three gates this lane ships were added to **`functions/test/ownershipModel.test.mjs`**
deliberately, rather than to a new file, because that file is already named by both halves of the
gate and a new file could only be wired in by editing two SHARED files this lane must not touch
(`functions/package.json`, `.github/workflows/**`).

| Requirement | Where it is already named | Status |
|---|---|---|
| npm script | `functions/package.json:157` — `"test:ownership"` names `test/ownershipModel.test.mjs` | already registered |
| workflow paths filter | `.github/workflows/eos-ownership-model-tests.yml:39` — `functions/test/ownershipModel.test.mjs` | already registered |
| workflow run step | `.github/workflows/eos-ownership-model-tests.yml:98` — `run: npm run test:ownership` | already registered |
| workflow source trigger | `.github/workflows/eos-ownership-model-tests.yml:22,59` — `functions/src/ownership/**` | already registered |

Both files this lane changed under `functions/src/ownership/` are covered by the `functions/src/ownership/**`
trigger, so any future edit to the matrix or the derivation module fires these gates. **The gates run.**

## 2. One registration someone else must make

The census gate reads a measured evidence artifact:

    sb-evidence/ownership-census-sandbox-postbackfill-2026-08-30.txt

That path is **not** in `.github/workflows/eos-ownership-model-tests.yml`'s `paths:` filter (which
lists `config/ownership/**` but no `sb-evidence/**`). Editing `.github/workflows/**` is outside this
lane's ownership, so it is recorded here rather than done.

- **Consequence today: none for correctness.** The gate fires on every `functions/src/ownership/**`
  change, which is the direction that matters — a matrix that starts claiming storage it does not
  have is caught.
- **The uncovered direction:** an edit to the evidence file alone would not re-run the gate. The
  evidence is a frozen historical measurement and should not change; if a *new* census is ever
  recorded, whoever owns the workflow should add `sb-evidence/ownership-census-*.txt` to the
  `paths:` filter of the `ownership-authorities` job, and the gate's `CENSUS_EVIDENCE` constant in
  `functions/test/ownershipModel.test.mjs` should be repointed to the newer measurement.

## 3. Migration

**None.** Nothing in this lane touches persistence. Migration id `1760400000000` was reserved for
this lane and is **unused** — it remains available.

## 4. Not done, deliberately

- **No backfill was run, and no operating company was stamped on any record.** Two families are
  recorded as having *no* company storage (`fieldops_wos`, 0 of 30) — that is a finding, left as a
  finding.
- `ownershipBackfillRules.ts` is **unchanged**. Its `stock_locations` rule (`:99`) and `trucks` rule
  (`:100`) are both left in place — see the PR body for the reasoning on each.
