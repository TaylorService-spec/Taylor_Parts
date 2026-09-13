# INT-A-CORRECTNESS — integration register for the post-Wave-1 program

**Lane:** INT-A-CORRECTNESS · **Mode:** CODE_WRITE (this document only) · **Single integration writer:** controller
**Baseline:** `64008d5ae0bdd9532909671b15a91122400accf1` = `ATLAS-BASE-2026-09-12-A` = `origin/main`
**Baseline verified against the live remote**, not only locally: `git ls-remote --heads origin main` → `64008d5a…`. `origin/main` is **unmoved**.
**Date:** 2026-09-13

## 0. What this document is, and is not

It is the **classification** of every branch this program produced, against the code that is actually on
`main` today. It decides what should be integrated, in what order, and what must not be.

It is **not** an integration. No branch is merged by this document. No `firestore.rules` change is
authorized by it. It executes nothing against any environment.

**Reliability order used throughout:** EXECUTED BEHAVIOUR > SOURCE + CONFIG RECONCILIATION > STATIC
SOURCE READING. Where a classification rests only on the third, it says so.

---

## 1. A correction to a blocker this program has been reporting

`gh auth status` reports no GitHub host, and this run has repeatedly recorded that as
**GITHUB_AUTH_REQUIRED** without qualifying it. That was too broad.

| Operation | Transport | Status |
|---|---|---|
| `git fetch` / `git ls-remote` / `git push` | SSH key | **WORKS** |
| PR create / PR list / PR state / CI status | GitHub REST API (token) | **BLOCKED** |

So the accurate statement is: **branch publication is available; pull-request and CI operations are not.**
Anything in this program that was deferred as "blocked on GitHub auth" when it only needed a push was
deferred on a wrong premise. Correcting it forward, not retroactively.

## 2. §17 — PR movement since the open-PR register

Re-run with the same API-free method the register used (`git ls-remote origin 'refs/pull/*/head'`):

| Measure | At the register | Now | Δ |
|---|---|---|---|
| `refs/pull/N/head` refs | 1,792 | **1,792** | **0** |
| Highest PR number | 1898 | **1898** | **0** |
| `origin/main` | `64008d5a` | **`64008d5a`** | **unmoved** |

**No new pull request has been opened and none has been force-pushed into existence.** The register's
dispositions therefore stand unchanged.

**Still unverifiable without the API:** whether any of the register's 71 candidates changed between
open and closed-unmerged. A close leaves the ref in place, so ref equality cannot detect it. This is
**UNPROVEN**, not "unchanged."

**The register's own caveat is restated because it is easy to misread:** `refs/pull/N/head` exists for
open, closed-unmerged *and* merged PRs. **71 is not an open-PR backlog and must not be quoted as one.**

---

## 3. Method

For every branch this program created:

1. `git merge-base --is-ancestor <branch> origin/main` → **ABSORBED** if true. This is ancestry, not
   content similarity, and it is the only test that proves absorption outright.
2. Otherwise, per file, `git diff origin/main..<branch> -- <file>` → **SAME-AS-MAIN** when empty
   (content already present by some other route), **DIVERGES** otherwise.
3. Rebase exposure measured as the intersection of *files the branch changed since its merge-base* with
   *files `main` changed since that same merge-base*. Set intersection, not a conflict simulation — it
   bounds the risk, it does not prove a textual conflict.
4. Supersession established by ancestry first; where two branches are independent and touch one file,
   by reading both versions of that file.

Docs-only branches are separated out rather than dropped: they are not correctness-integration
candidates, but several are the run's evidence and are listed in §8 so they are not silently lost.

---

## 4. The systemic integration hazard — read this before merging anything

**14 candidate branches each add a `node --test` glob to the same `functions/package.json` scripts
block.** That single file is the only overlap between `main` and almost every night-run branch:

| Branch | Files it changed since merge-base | Files also changed on `main` since then |
|---|---|---|
| `night/p2c1-parity` | 2 | **0** |
| `night/p2c2-adc-failclosed` | 14 | 1 — `functions/package.json` |
| `night/p2f-nonprod-blockers` | 8 | 1 — `functions/package.json` |
| `night/p2g-capability-request-blindness` | 8 | 1 — `field-ops-app-vite/test/suites.json` |
| `night/p2h-report-scope-bound` | 4 | 1 — `functions/package.json` |
| `night/p2i-stale-authority-claims` | 56 | 1 — `functions/package.json` |
| `night/p2j-onhand-derivation` | 7 | 1 — `functions/package.json` |
| `night/p2k-finance-detectors` | 7 | 1 — `functions/package.json` |
| `night/p2l-functions-test-registration` | 4 | 1 — `functions/package.json` |
| `night/p2m-sandbox-project-resolution` | 10 | 1 — `functions/package.json` |
| `night/p2n-governed-role-resolution` | 2 | 1 — `functions/package.json` |
| `night/p30-identity-standard` | 3 | 1 — `functions/package.json` |
| `night/p30b-business-numbers` | 21 | 1 — `functions/package.json` |
| `atlas/p30b-identity-verification` | 4 | 1 — `functions/package.json` |

This is the good news and the trap in the same table. Even `night/p2i-stale-authority-claims`, which
changes **56 code files**, overlaps `main` on **one** — and that one is a test-registration line, not
business logic. Semantic conflict risk across the night run is far lower than its size suggests.

**The trap.** `node --test` resolves each positional argument as path-or-glob and takes the **union** of
what matches. It errors only when the union is **empty** *and* one argument was a literal path.
**A non-matching argument is silently dropped when any other argument resolves.** So a
`functions/package.json` whose merged test script names a glob for files that did not land will
**pass, reporting success, having run fewer tests than it claims.**

**Therefore, mandatory after every merge into this sequence:** assert that each glob in the merged test
script matches at least one file. A merge is not verified by a green test run; it is verified by a green
test run *plus* proof that the run covered what the script names. `night/p2l-functions-test-registration`
exists to ratchet exactly this, which is why it is sequenced early in A1.

**A second `p2l`-specific hazard:** `functions/test-registration-baseline.json` is a recorded baseline.
It must be **regenerated after rebase**, never merged as-is, or it ratchets against a tree that no
longer exists.

---

## 5. INTEGRATION A1 — normal correctness

No `firestore.rules` change. No migration. No credential or environment-authority change. These may
proceed as ordinary correctness work once each is rebased and re-proven.

| Order | Branch | What it fixes | Code files | Rebase exposure | Evidence grade |
|---|---|---|---|---|---|
| A1-1 | `night/p2l-functions-test-registration` | Test-registration ratchet — closes the silently-dropped-glob hole that every later merge depends on | 4 | `functions/package.json` | EXECUTED (own lane) |
| A1-2 | `fix/crash-diagnostics-flake` | Crash-id test flake, reproduced at 30/4000 = 0.750%, fixed by `Object.defineProperty` injection; 200/200 deterministic after | 2 | **none** — based on `main` | **EXECUTED, reproduced and re-proven** |
| A1-3 | `post/eng-a-audit-read` | Record-change-history read service default role catalogue | 4 | **none** — based on `main` | EXECUTED (own lane) |
| A1-4 | `post/eng-c-parity-vacuity` | The inventory capability parity harness could pass **vacuously**; adds classification + vacuity tests | 5 | **none** — based on `main` | EXECUTED (own lane) |
| A1-5 | `night/p2c1-parity` | Inventory capability **grant migration CLI** (a different file from A1-4 — see §6.2) | 2 | **none** | EXECUTED (own lane) |
| A1-6 | `night/p2n-governed-role-resolution` | Governed-role binding test. **Test-only** — 237 added lines, no `src` change | 2 | `functions/package.json` | EXECUTED (own lane) |
| A1-7 | `night/p2k-finance-detectors` | Finance detector wiring + financial reconciliation | 7 | `functions/package.json` | EXECUTED (own lane) |
| A1-8 | `night/p2j-onhand-derivation` | On-hand **sign authority** unified to one source; `cycleCountExpectedQuantity.ts` now **refuses** an impossible negative rather than clamping it to 0 | 7 | `functions/package.json` | EXECUTED (own lane) |
| A1-9 | `night/p2f-nonprod-blockers` | Administration object drift, technician identity trap, repo graph | 8 | `functions/package.json` | EXECUTED (own lane) |
| A1-10 | `night/p2g-capability-request-blindness` | Client gates a capability it **never requests** — 153-line `shellCapabilityGates.js` + 249-line coverage test | 8 | `field-ops-app-vite/test/suites.json` | EXECUTED (own lane) |
| A1-11 | `atlas/p30b-identity-verification` | Record-id standard + property tests. Supersedes `night/p30-identity-standard` | 4 | `functions/package.json` | EXECUTED (own lane) |
| A1-12 | `rpt/client-outcome-honesty` | **The reporting chain HEAD** — false-empty honesty, audit-context injection, row-scope bound, client outcome contract. 21 code files | 21 | **none** — based on `main` | EXECUTED (own lane) |

**A1-8 is a behaviour change, not a refactor, and must be reviewed as one.** Clamping a negative
on-hand to `0` made every unit a counter physically finds read as *surplus* against an expected `0`;
reconciliation then posts an `ADJUSTED` for the whole counted quantity and "corrects" the ledger toward
a figure the clamp invented. The branch refuses instead. That is the right call — but it converts a
silent wrong answer into a visible refusal on a live operator path, and somebody will see a new error.

**A1-12 ordering is not negotiable.** Reporting is the **only** domain with production capability
activations, so it is the only chain whose behaviour a production user can currently reach. It goes
last in A1 so that the test-registration ratchet (A1-1) is already guarding the merge that matters most.

## 6. Supersession — do not merge these

| Branch | Superseded by | Basis |
|---|---|---|
| `post/eng-e-report-scope` | `rpt/client-outcome-honesty` | **strict ancestor** — proven by `merge-base --is-ancestor` |
| `rpt/false-empty-and-audit` | `rpt/client-outcome-honesty` | **strict ancestor** |
| `night/p2h-report-scope-bound` | `rpt/client-outcome-honesty` | independent, not an ancestor. Both create `functions/src/reporting/reportRowScope.ts`: **236 lines** on `p2h`, **358** on the chain. Content subsumed |
| `night/p30-identity-standard` | `atlas/p30b-identity-verification` | **strict ancestor** |
| `atlas/guard-admin-firestore` | `post/eng-b-firebase-guard` | independent, not an ancestor — see §6.1 |

### 6.1 `scripts/firebaseExitGuard.mjs` — three versions, and a number that disagrees

| Ref | Lines | Base |
|---|---|---|
| `origin/main` | 406 | — |
| `atlas/guard-admin-firestore` | 474 | `33945090` (**pre-merge**) |
| `post/eng-b-firebase-guard` | 577 | `64008d5a` (**`main`**) |

`eng-b` is a strict refinement of the same design, not a rival one: same header, same namespace-form
bypass analysis, plus `.mjs` in `SCAN_EXTENSIONS` (without which `integrations/` was walked but every
file in it was invisible to the classifier — a bypass, not a filter), plus `integrations` as a third
scan root, plus `categoryOwnsPath`. **`eng-b` wins on both correctness and base.**

**A discrepancy to resolve during the A2 merge, not to paper over:** `atlas/guard-admin-firestore`
documents a **369-entry** baseline; `post/eng-b-firebase-guard` documents **366 guarded entries**. Two
values for one measured baseline. Only one can be right for the tree being merged, and the number is
load-bearest — it is what the ratchet compares against. **Re-derive it on the rebased tree; adopt
neither figure on the strength of its comment.**

This file is also where this program's **third branch-provenance violation** occurred: "12 categories /
roots are not a per-file filter" were read from PR #1898 and reported as facts about `main`. Both
statements were true of the branch and false of the product. Hence the re-derivation requirement above.

### 6.2 A correction to this lane's own first pass

An earlier pass of this classification listed `night/p2c1-parity` and `post/eng-c-parity-vacuity` as a
conflicting pair on `functions/scripts/inventoryCapabilityParityHarness.js`. **Wrong.** `p2c1` does not
touch that file at all — its two files are `inventoryCapabilityGrantMigrationCli.js` and its test. The
pair is independent and both are needed. Recorded because the error came from matching on lane *topic*
instead of on the file set, which is exactly the mistake this register exists to prevent.

## 7. INTEGRATION A2 — Firebase guard / migration safety / environment authority

**Separated from A1 deliberately, and must not be smuggled into a normal correctness change.** Each of
these changes what the system is *permitted to reach*. A reviewer approving a test fix is not thereby
approving a change to credential fencing.

| Order | Branch | What it changes | Code files | Why A2 |
|---|---|---|---|---|
| A2-1 | `post/eng-b-firebase-guard` | Firebase-exit guard + shim boundary; widens the fence to `integrations` and `.mjs` | 5 | Changes what the guard **forbids**. Widening a fence can fail builds that previously passed |
| A2-2 | `post/eng-d-environment-fence` | Operator-script environment fence — `projectTargetGuard.js`, 7 scripts fenced, 234-line test | 11 | **This is the fence the Owner ruled must never be weakened.** Merging it is the only way to stop weakening it by omission |
| A2-3 | `night/p2c2-adc-failclosed` — **RESIDUE ONLY** | 4 scripts `eng-d` does not reach | 4 of 14 | see §7.1 |
| A2-4 | `night/p2m-sandbox-project-resolution` | `sandboxTargetGuard.js` + 3 backfill/repair CLIs fenced to sandbox | 10 | **Data-migration CLIs.** An unfenced backfill CLI is the highest-consequence unguarded surface in the repo |

### 7.1 `night/p2c2-adc-failclosed` is PARTIALLY superseded — the residue is real and verified

For the 7 files both branches touch, `post/eng-d-environment-fence` wins: it is based on `main`
(`p2c2` is based on `d104cf49`, pre-merge) and its fence is larger
(`generatePasswordResetLink.js`: `main` 69 lines → `p2c2` 128 → **`eng-d` 148**).

But `p2c2` covers **4 files `eng-d` never touches**, and every one of them is unfenced on `main` today:

| File | On `main`? | Fence markers on `main` | Touched by `eng-d`? |
|---|---|---|---|
| `functions/scripts/environmentTargetShared.js` | **absent** | n/a | no |
| `functions/scripts/operatorAccessCommand.js` | yes | **0** | no |
| `functions/scripts/productionFoundationVerification.js` | yes | **0** | no |
| `functions/scripts/inventoryCapabilityParityHarness.js` | yes | **0** | no |

Searched for `EOS_TARGET_ENV`, `requireExplicitEnvironment`, `projectTargetGuard`, `assertTarget`,
`environmentTargetShared` — **zero matches in all three files that exist.**

So: **three operator scripts on `main` right now resolve their target environment with no explicit
fence**, and the branch that would fence them is the one being superseded on its other files. Merging
only `eng-d` leaves that hole open. **Port the residue onto `eng-d`; do not merge `p2c2` whole, and do
not discard it either.**

`operatorAccessCommand.js` and `productionFoundationVerification.js` are named for what they do. This is
the single most consequential finding in this register.

**UNPROVEN:** that the absence of those five markers means those scripts are genuinely unfenced. It is
a static negative over one marker set — they could fence by a spelling not searched. Verify by execution
before acting, per the reliability order. The finding is strong enough to act on and not strong enough
to state as executed fact.

## 8. TIER-2 HOLD — Owner decision required, not a correctness merge

| Branch | Code files | Why held |
|---|---|---|
| `night/p2i-stale-authority-claims` | 56 | Changes **`firestore.rules` and `field-ops-app-vite/firestore.rules`** (13+/2- each), **`permissionCatalog.ts` ×2 mirrors** (123+/48-), **`functions/src/index.ts`** (53+/29-), `compatibilityRoles.ts`, `governedBusinessRoles.ts`. This is the capability and Role surface |
| `night/p30b-business-numbers` | 21 | Changes **`firestore.rules`** (11+/0-) and the numbering authority of **9 business domains** at once (WO, invoice, opportunity, sales order, sales agreement, transfer, receiving, reorder). Includes `backfillOperationalNumbering.mjs` — a **data-migration script** |

Both are **held, not rejected.** Both contain real fixes. Neither may move without the Owner's Tier-2
authorization, and `p30b` additionally implies a production data migration that is prohibited outright
under the standing rulings.

`p2i` carries a further reason for care: it edits `permissionCatalog.ts` in **both** mirrors, and the
48 removed lines are `main`'s content the branch has not seen. On a 123+/48- change to the capability
catalogue, "rebase and re-run the tests" is not sufficient review.

## 9. Discarded

| Branch | Why |
|---|---|
| `scratch/p1b-integration-dryrun` | A rehearsal branch. **7 of its 11 code files are byte-identical to `main`** (absorbed via the P1-B impl branches); the 2 that diverge do so mostly by *lacking* `main`'s content. Nothing to integrate |

**A note on this branch's own paperwork.** `docs/integration/w1-integration-rehearsal.md:21` on this
lineage reads "The tree goes from 7 migrations to 18." That is a true statement about two git trees. It
was re-voiced overnight as the live measurement **"7 of 18 migrations,"** propagated through the whole
run, and appears in **no** input as a measurement. It is **withdrawn and must never be reused.**
Verified: **7 pre-merge, 18 at baseline, 5 schemas, 54 tables, 3 views.**

## 10. Absorbed — proven ancestors of `origin/main`

`integration/wave-1` · `impl/p1b-part-tracking-contract` · `impl/p1b-company-custody-schema` ·
`impl/p1b-inventory-import-mapping` · `impl/p1b-employee-truck-crosswalk` ·
`docs/p1b-reference-authority-census` · `night/p2e-scheduling-union` ·
`auto/control/firebase-exit-1fdef0b7-20260911T202025Z`

Plus the **32 `impl/w1-*` branches**, all 32 proven ancestors of `64008d5a` and recorded in
[`../atlas/ATLAS-BASE-2026-09-12-A.md`](../atlas/ATLAS-BASE-2026-09-12-A.md) — 33 merge commits, zero
squashes.

## 11. Evidence branches — not correctness candidates, not to be lost

Zero code files; these are the run's findings. Listed so that classifying them as "not integration
material" does not read as "discard."

`phase3/operational-reality-evidence` (8) · `emp/own-synthesis` (25) ·
`archaeology/recovered-design-evidence` (67) · `night/p3b3-activities-sales` (14) ·
`post/p3-wf-registry` (3) · `night/p3d-workflow-registry` (3) · `rpt/p0-blast-radius` (3) ·
`atlas/eng-impl-reporting-company-scope` (2) · `atlas/p3arch-source-unavailable` (2) ·
`post/p3-fb-census` (2) · `night/p3b1-activities-service` (2) · `night/p3b2-activities-inventory` (2) ·
`emp/accountability` · `emp/experience` · `emp/information` · `emp/performance` · `emp/role-map` ·
`emp/work-matrix` · `own/design-reconciliation` · `own/e2e-census` · `post/p3-mig-reality` ·
`night/p2b1-runtime-census` · `night/p2b2-rules-browser` · `night/p2b3-functions-transport` ·
`night/p2c3-nonprod-readiness` · `night/p2d-decision-ledger` · `night/p3a1-archaeology-service` ·
`night/p3a2-archaeology-inventory` · `night/p3a3-archaeology-sales` · `night/p3c-design-master-brief` ·
`phase2/firebase-retirement-census` · `phase2/nonprod-activation-readiness`

Four extension lanes were writing when this register was compiled and are therefore not classified
here: `ext/own-decision-packet`, `ext/own-engineering-gap`, `ext/ux-honest-absence`, `ext/ux-kpi-drill`.

---

## 12. Totals

| Class | Branches |
|---|---|
| INTEGRATION A1 — normal correctness | **12** |
| INTEGRATION A2 — guard / migration / environment authority | **4** (one residue-only) |
| TIER-2 HOLD — Owner decision | **2** |
| SUPERSEDED — do not merge | **5** |
| DISCARDED | **1** |
| ABSORBED — proven ancestors | **8** + the 32 `impl/w1-*` |
| Evidence-only | **32** + 4 in flight |

**16 branches carry code that `main` does not have and should.** Two more carry code `main` should
probably have but cannot receive without an Owner ruling.

## 13. What this register does NOT establish

- **That any A1 or A2 branch still passes.** Every "EXECUTED (own lane)" grade is evidence from that
  lane's own tree at its own base. After rebase onto `64008d5a` each must be **re-proven**, unpiped —
  a test run read through `| tail -3` reports the exit code of `tail`, which this program has already
  got wrong once and acted on.
- **That the rebase exposure in §4 will not conflict.** It is a set intersection. It bounds risk; it
  does not simulate a merge.
- **That the `p2c2` residue scripts are unfenced.** §7.1 is a static negative over one marker set.
- **Whether the 71 PR candidates are open or closed-unmerged.** Needs the API. Still **UNPROVEN**.
- **The correct `firebaseExitGuard` baseline count** — 369 and 366 both appear in committed comments.
- **Any production state whatsoever.** Nothing here was executed against any environment.
