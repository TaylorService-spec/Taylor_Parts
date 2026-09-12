# Local branch inventory — post-Wave-1 classification

**OBSERVED AT:** `64008d5ae0bdd9532909671b15a91122400accf1` (post-Wave-1 main) · 2026-09-12

Every branch below is **local-only**; none exists on `origin`. All are preserved in a verified
`git bundle` (1,603 refs, `git bundle verify` reports a complete history) at
`/home/rudy2/.local/share/eos-bundles/eos-local-branches-20260912T163327Z.bundle`.

## Method, and a correction to an earlier pass

Each branch is diffed against **its own `merge-base` with post-Wave-1 main**, not against a single
assumed base. An earlier pass diffed everything against `d104cf49` and reported
`atlas/guard-admin-firestore` and `atlas/p3arch-source-unavailable` as touching **107 code files each** —
an artefact of the wrong base, since both branched from pre-merge main (`33945090`). Their true deltas
are **2 files each**. The corrected figures are below.

Classification is by **what the branch actually changes**, not by its lane's purpose. A lane whose job was
analysis may still have landed executable code — `night/p2i` is documentation work by intent but touches
**54 code files**, because correcting a false comment edits source.

## EVIDENCE CORRECTION — 14 branches, consolidated into this branch

| Branch | Files | Content |
|---|---:|---|
| `atlas/p3arch-source-unavailable` | 2 | historical-acceptance register; Parts North Star authority correction |
| `night/p2b1-runtime-census` | 1 | Firebase BUSINESS_RUNTIME census |
| `night/p2b2-rules-browser` | 1 | Rules + browser direct-Firebase authority census |
| `night/p2b3-functions-transport` | 1 | Functions business-transport census |
| `night/p2c3-nonprod-readiness` | 1 | nonprod activation readiness |
| `night/p2d-decision-ledger` | 1 | Phase-2 open-decision ledger |
| `night/p3a1-archaeology-service` | 1 | Service/Scheduling/Technician/Equipment archaeology |
| `night/p3a2-archaeology-inventory` | 1 | Inventory/Warehouse/Purchasing/Scanner archaeology |
| `night/p3a3-archaeology-sales` | 1 | Sales/CRM/Financials/Reporting/Admin archaeology |
| `night/p3b1-activities-service` | 2 | Service corpus + evidence-tier corrections |
| `night/p3b2-activities-inventory` | 2 | Inventory corpus + device/coverage tag reconciliation |
| `night/p3b3-activities-sales` | 14 | Commercial corpus, tier downgrades, new `diff` transcript |
| `night/p3c-design-master-brief` | 1 | Design P2 master brief (INPUT, not implementation authority) |
| `night/p3d-workflow-registry` | 3 | EOS Workflow Registry + schema reconciliation |

## EXECUTABLE FIX — 14 branches, DELIBERATELY EXCLUDED from this evidence branch

Per Owner ruling: executable fixes stay in separate focused branches and must be reapplied or
reconciled against post-Wave-1 main. **None may be blind-cherry-picked here.**

| Branch | Files | Code | Disposition |
|---|---:|---:|---|
| `atlas/guard-admin-firestore` | 2 | 1 | **SUPERSEDED** — reimplemented by lane ENG-B at post-Wave-1 main. Do not merge; Wave 1 restructured the guard. |
| `night/p2c1-parity` | 3 | 1 | production refusal in the grant CLI — overlaps lane ENG-C/ENG-D surface; reconcile |
| `night/p2c2-adc-failclosed` | 16 | 11 | environment fences — **superseded in scope by lane ENG-D**, which is re-measuring at main |
| `night/p2f-nonprod-blockers` | 10 | 2 | repo-graph build-state fix, `ciSuiteCoverage` recursion, governance row |
| `night/p2g-capability-request-blindness` | 8 | 5 | client capability-request union (mode-3 fix) |
| `night/p2h-report-scope-bound` | 5 | 2 | report row-scope / tenancy bound |
| `night/p2i-stale-authority-claims` | 58 | 54 | ~80 false authority comments + a holder-register ratchet |
| `night/p2j-onhand-derivation` | 7 | 2 | cycle-count floor + client sign-authority import |
| `night/p2k-finance-detectors` | 8 | 3 | finance detector registry + comment corrections |
| `night/p2l-functions-test-registration` | 4 | 1 | test-registration ratchet |
| `night/p2m-sandbox-project-resolution` | 10 | 4 | sandbox target guard (3 broken CLIs) |
| `night/p30b-business-numbers` | 21 | 12 | business-number collision defence, 8 allocators |
| `night/p30-identity-standard` | 6 | 1 | `recordId.ts` + standard |
| `night/p2n-governed-role-resolution` | 3 | 0 | **test/CI/registration only** — governed-role binding proof |

## IDENTITY PROTOTYPE — NOT AUTHORIZED

`atlas/p30b-identity-verification` (7 files, 1 code) — carries four real defect fixes in
`functions/src/identity/recordId.ts` plus 32 new property tests. **Its runtime/registry implementation
must NOT become canonical.** The standard is **NOT READY TO FREEZE**. Durable evidence from this lane may
be consolidated; the implementation may not be adopted.

## SUPERSEDED

`night/p2e-scheduling-union` — zero delta against main. The lane withdrew its own implementation after
the integration writer shipped the same fix; its value was the adversarial review, already acted on.

## LEGACY LOCAL — DISPOSITION PENDING

Four branches, last committed **2026-08-19**, predating this program. **Not ours, not integrated, preserved
in the bundle.** Owner instruction: do not spend time on them now.

| Branch | Commits |
|---|---:|
| `integration/button-primitive` | 62 |
| `integration/sweep-r1-fixes` | 42 |
| `integration/visual-transformation` | 23 |
| `integration/style-elimination` | 14 |

## MERGED

`integration/wave-1` — absorbed into `main` at `64008d5a`. The remote branch was auto-deleted on merge.
