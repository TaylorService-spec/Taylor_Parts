# INV-CONVERGENCE-E C2 — Hosting deployment gate, PREPARATION evidence

> **STATUS: PREPARATION ONLY — NOTHING DEPLOYED, NOTHING AUTHORIZED TO EXECUTE.**
> This package accompanies the runbook
> [`docs/operations/inv-convergence-e-c2-hosting-deploy-handoff.md`](../../operations/inv-convergence-e-c2-hosting-deploy-handoff.md)
> for Codex review. **Production deployment requires a separate, explicit Owner
> authorization** naming the exact commit, granted after this runbook passes review.

| | |
|---|---|
| Gate | INV-CONVERGENCE-E **C2 Hosting deployment** (separate from the merged C2 repository gate) |
| Merged C2 source | `2d08e2e495448e6f0bb523a58675c195a805c13e` |
| Project / scope | `taylor-parts` · **Hosting only** |
| Prepared | 2026-07-27, Inventory session |
| Production access used | **None.** No credentials, no live reads, no deploy, no mutation. |

## What the Owner asked for, and where it is

| Requirement | Where |
|---|---|
| Fresh live parity immediately before deployment | Runbook **Step 5** + `field-ops-app-vite/scripts/c2LiveParity.mjs` |
| Exact authorized build/commit correspondence | Runbook **§0.1** + **Step 7**; `bundle-correspondence.txt` |
| Hosting-only scope | Runbook **§1**, **Step 2**, **Step 6** (`--only hosting`) |
| Pre/post Rules and Functions unchanged verification | Runbook **Step 4** (baseline) + **Step 9** (diff) |
| Read-only production persona verification | Runbook **Step 8a/8b** — read-only, no writes |
| Direct PartDetail browser verification where technically available | Runbook **Step 8a/8b**, with **§8c** stating exactly what the browser does and does not establish |
| Rollback target and procedure | Runbook **Step 3** (pin) + **Rollback** section (pinned-version Console or exact clone; `hosting:rollback` prohibited) |
| Automatic evidence sanitization and checksums | Runbook **Step 10** — scripted governed scanner + `SHA256SUMS.txt`, not a manual review |

## The new capability: fresh live parity (Step 5)

Decision #46 requires live parity "immediately before the switch"; DECISIONS #49 placed
that requirement on **this** gate rather than the repository merge. C1 had no such
in-runbook check — it relied on the earlier Stage A parity. C2 adds a real one.

`field-ops-app-vite/scripts/c2LiveParity.mjs` runs in the operator's authenticated
environment immediately before `firebase deploy`, and a non-`PASS` **blocks the deploy**.

- **Deterministic run boundary (Stage A §A.1):** the operator captures **one** immutable
  canonical payload; the checker is a pure function of that frozen file plus the in-repo
  static catalog. It performs **no network I/O**, holds **no credentials**, and never
  writes. No temporal skew between the compared models is possible.
- **Exercises the real shipped code path** — `buildPartDetailView`, `selectPartLedger`,
  `buildPartsCatalogRows` — against live canonical data, and reuses the app's own
  governed REST→view mapping (`toPartListView`). It is not a parallel reimplementation.
- **Deterministic `runId`** derived from the capture's SHA-256 (no clock, no randomness),
  so a re-run on the same capture reproduces the same result.
- **Records provenance:** payload sha256, static-catalog sha256, capture start/end, and
  full counts.

### Fail-closed behavior — proven, not asserted

`field-ops-app-vite/test/c2LiveParity.test.mjs` (**15/15**, offline) proves every path:

| Live condition | Result | Exit | Deploy |
|---|---|---|---|
| complete capture | `PASS` (190 canonical + 10 excluded = 200 details ready) | 0 | proceed |
| denied canonical read | `BLOCKED_PERMISSION` | 1 | **STOP** |
| unavailable / read error | `BLOCKED_UNAVAILABLE` | 1 | **STOP** |
| paginated (truncated) capture | `BLOCKED_INCOMPLETE_INPUT` | 1 | **STOP** |
| malformed JSON / unexpected shape | `BLOCKED_INCOMPLETE_INPUT` | 1 | **STOP** |
| **empty** canonical result | `BLOCKED_INCOMPLETE_INPUT` — never "success" | 1 | **STOP** |
| Part omitted or duplicated | `BLOCKED_*` | 1 | **STOP** |
| canonical unit divergence | `FAIL_PARITY` | 1 | **STOP** |

A `BLOCKED_*` is never reported as an empty catalog, "190 missing", or a parity failure.
Every non-PASS still writes its evidence file **and** exits nonzero, so the runbook's
`set -euo pipefail` halts. A Step 5 stop needs **no rollback** — nothing is deployed yet.

> **Operator note captured in the runbook:** do not pipe the checker into `tee`/`tail`
> without `pipefail` — a pipeline returns the last command's status and would mask a
> nonzero parity exit. (Observed during preparation; the runbook block avoids the pipe.)

## Improvements over the C1 Hosting gate

1. **Direct browser verification of PartDetail.** C1's per-persona rendered behavior was
   *inferred* from bundle equality plus live REST reads — Codex correctly flagged that as
   not directly observed. C2's ratified decisions are **visible**: D-C2-1 shows as the
   canonical unit token (`EACH`, not `ea`) and D-C2-2 shows as a fully blocked page with
   **no write surface**. Step 8 observes both per persona.
2. **§8c states the limits honestly** — `CANONICAL_MATCH` / `STATIC_ONLY_EXCLUDED` have
   no visible UI label; the 190+10 composition is proven by Step 5 and the governed
   tests, not by the browser. No one is asked to "see" an invisible classification.
3. **Archive retention is stated up front** (C1 lesson): a Cloud Shell tarball is mutable
   and not repository-retained; the **committed sanitized transcription** is the
   repository-review evidence, and the archive is a pointer with a stated limitation.
4. **Rollback prohibits `hosting:rollback`** from the outset and pins the target version
   in Step 3, naming the expected C1 release as the rollback state.

## Local preflight (credential-free)

Full results in `local-preflight.txt`:

| Gate | Result |
|---|---|
| Full client chain (`npm test`) | **exit 0**, 168 assertions |
| `test/c2LiveParity.test.mjs` | **15/15** |
| `test/partDetailView.test.mjs` | **34/34** |
| `test/partsCatalogView.test.mjs` | **23/23** |
| `npm run lint` | exit 0 — pre-existing warnings only, **zero** findings in new files |
| `npm run typecheck` | exit 0 |
| `npm run build:firebase` | exit 0 |
| `npm run verify:build-base` | **12 passed, 0 failed** |
| `dist/index.html` GitHub-Pages host paths | **0** |
| `firestore.rules` Git/LF sha256 @ `2d08e2e` | `cf6681c6…2bc381` — **identical to C1's recorded value → C2 changed no Rules** |

## Deploy-commit resolution

The C2 code merged at `2d08e2e`, but the parity tool ships in this preparation PR, so the
operator must clone a commit containing it. `AUTHORIZED_COMMIT` is therefore **the merge
commit of this preparation PR**, to be pinned in the deployment authorization.

**This does not change what ships:** builds from `2d08e2e` and from this branch produce a
**byte-identical** `dist/` (verified; see `bundle-correspondence.txt`). Those Windows-built
hashes are corroborating only — Step 7's Cloud Shell manifest equality is the governing
check.

## Limitations (stated plainly)

- **No production access was used or is held by this session.** Every live value in the
  runbook is a placeholder the operator fills; nothing here reports a live observation.
- The parity tool's self-test uses a **synthetic REST capture** built from the committed
  production read-back — it proves the tool's logic and fail-closed behavior, **not** the
  current live state. Only Step 5, run by the operator, does that.
- The recorded `dist/` hashes are Windows-built and non-authoritative (above).
- Step 8 browser verification depends on the operator's governed personas being available
  and on the app's rendering; §8c bounds what it can establish.
- This package proves the runbook is **ready for review**. It does not certify a
  deployment, and no deployment has occurred.

## Files

| File | Purpose |
|---|---|
| `README.md` | this summary |
| `local-preflight.txt` | captured credential-free preflight results |
| `bundle-correspondence.txt` | deploy-commit resolution + byte-identical build proof + Rules hash |
| `SHA256SUMS.txt` | checksums of the files above |
