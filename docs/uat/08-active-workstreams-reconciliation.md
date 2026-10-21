# ACTIVE_WORKSTREAMS reconciliation (2026-10-21)

> **Requires #2201 merged** before the Codex handoff is used. Read-only reconciliation of `docs/engineering/ACTIVE_WORKSTREAMS.md` against `git log origin/main --since=2026-10-19` (35 commits, head `835e5982`) and the open lanes (DWO #2200, CLC #2199, HAR #2201). Evidence files are the controller's, under `D:/eos-lanes/evidence/`.

## 1. Classification vocabulary

- **implemented**: the code is on `main`.
- **CI-proven**: a test suite (offline or real-Postgres) covers it in CI.
- **live-proven**: observed on deployed nonprod with database and audit readback, in an evidence file.
- **cross-company live-proven**: proven live with two companies. **Nothing is**: `ventana` is unkeyed in nonprod and holds no records, so no live cross-company proof can exist yet (that is what the Ventana fixture plan and the Codex cross-company pass are for).
- **blocked**: cannot be proven or used until a named gate clears.
- **not built**: no code on `main`.

## 2. Merged since 2026-10-19

| PR | Commit | What | Class | Evidence / gate |
|---|---|---|---|---|
| #2194 | `835e5982` | Q-1a operating-company authority on Commercial (12 review items) | implemented, **CI-proven** | `commercialCompanyAuthority{,Breadth,}Postgres` suites (DECISIONS #Q-1a-company). Live: no. **Cross-company live: blocked** (Ventana key and fixtures) |
| #2195 | `78736004` | FU-2 rebill trigger (`prepareBillingPackage`) and server-derived Issue eligibility | implemented, CI-proven | `fu2PrepareBillingPackagePostgres`; not live-evidenced |
| #2198 | `9688e5e9` | FU-3 B delegated-exemption access view | implemented, CI-proven | `authorityImpactPreview` UI suite; ADMIN-3b subtest |
| #2197 | `5f542723` | CI registration of `reorderConsumersDeniedVsAbsent` | implemented (CI wiring) | workflow edit |
| #2196 | `a2183807` | R1 tag recipe (docs) | docs | - |
| #2193 | `1732a445` | SAE-2 delegated self-approval exemption (7 keys, no grants, Owner-only) | implemented, CI-proven | `saeDelegatedExemptionPostgres`; live: not evidenced (negatives are in the Codex plan) |
| #2192 | `4876712b` | FU-1 low follow-ups | implemented, CI-proven (UI suites) | - |
| #2191 | `174ba281` | S1c holders: `salesOrder.fulfill` to GM, warehouse, service, parts managers | implemented | grants visible in the 2026-10-21 census; live walk not evidenced |
| #2190 | `cd843df1` | SAE-1 protected-Owner exemption | implemented, CI-proven | live: not evidenced |
| #2189 | `85121fd8` | S1c Sales Order allocation | implemented, CI-proven | live: not evidenced; activation is an operator row (S1b lane note) |
| #2186 | `0ee9188a` | S1b hard stock reservations per company and warehouse | implemented, CI-proven | live: not evidenced; **blocked** on the activation row |
| #2188 | `5671c167` | F-1b credits, write-offs, adjustments, refunds, eligible voids | implemented, CI-proven | live: not evidenced |
| #2187 / #2184 | `c1721406` / `5c1fe280` | F-1a invoice issue (server) and UI | implemented, CI-proven, **live-proven** (Taylor) | `f1a-invoice-issue-live-acceptance-2026-10-20.md` (persona financeAccounting; INV-2026-000001; replay and key-reuse checks). Cross-company: no Ventana invoice exists |
| #2185 | `cbb30946` | Service WO invoicing policy requirements (docs) | docs | - |
| #2182 / #2183 | `403564c8`, `e19dc610` | Owner rulings on the seven commercial specs; safeguards A-C (docs) | docs | `commercial-spec-decision-classification-2026-10-20.md` |
| #2177 | `ec66b089` | SCAN-PORT thirteen scanner scenarios as tests | CI-proven (test-only) | live: the B5 matrix says the device walk is owed |
| #2178 | `5b2e58d0` | HARDEN review follow-ups | implemented, CI-proven | - |
| #2181 | `a9ab16c7` | UX-2 account page refusal wording | implemented, CI-proven | - |
| #2180 / #2176 | `ec4df468` / `9f839135` | Display batch and its follow-ups | implemented, CI-proven | `morning-owner-review-2026-10-20.md` |
| #2179 | `bfeb6dd8` | R1 production recovery release record (docs) | docs | gates Firebase deletion |
| #2168 | `2f8be86f` | F-2 finance reads serve the Firebase fact families | implemented, CI-proven; partly live (the F-1a acceptance reads `listObligations`) | - |
| #2169 | `237b4897` | Q-1 PR 1: one audit row per applied Commercial/CRM command | implemented, CI-proven | **Stale evidence:** `B5-ACCEPTANCE-MATRIX.md` still lists "Audit on commercial and CRM commands: MISSING / FAIL"; #2169 supersedes it (live audit readback not yet evidenced) |
| #2166 / #2165 | `b3d09dc3` / `09a82d3e` | G-1b / G-1 performance goal authoring (resolves OD-B4-3) | implemented, CI-proven, **live-proven** | `g1-goal-authoring-live-acceptance-2026-10-20.md` |
| #2164 | `c2f95ac9` | A6 customer-balance summary (`finance.accountBalance.read`, 8 grants) | implemented, CI-proven | live: not evidenced |
| #2163 | `e1565a01` | GRANT-1 Owner policy grants (1 capability, 30 grants) | implemented | grants visible in the 2026-10-21 census; `policy-grants-analysis-2026-10-19.*` |
| #2162 | `a5a7c1ce` | P-1 supplier PO authoring (raise, approve, send, receive) | implemented, CI-proven, **live-proven** (single company) | `purchasing-loop-proof-2026-10-19.md` (SPO-2026-000001) |
| #2161 | `fe5c9896` | PERM-UI controls match capabilities | implemented, CI-proven | B5 matrix |
| #2160 | `d8ee3a61` | TW1-TW5 technician workflow fixes | implemented, **live-proven** | `b3-technician-proof-finley-2026-10-19.md` |
| #2159 / #2155 | `21354269` / `04a63270` | ISO / ISO-2 inventory company isolation | implemented, CI-proven, **live-proven single-company** | `iso-retest-and-cycle-count-adjustment-2026-10-19.md`. Cross-company: **not live-proven** |
| #2158 | `9b41bfb1` | Mobile drawer clears the tab bar | implemented, CI-proven | - |

(Commits from earlier in the window, such as the Firebase exit PRs, are recorded in their own registry rows.)

## 3. Open lanes and gaps

| Item | State | Effect on the UAT |
|---|---|---|
| **#2200 DWO** Work Order company boundary | **not built into main** (PR pending) | Work Order record-reach and DWO-1/DWO-2 rows are `after #2200`; nonprod holds 77 Work Orders, all `taylor` (`f1a-invoice-issue-live-acceptance-2026-10-21-dwo-census.md`) |
| **#2199 CLC** company-less record correction | **not built into main** (PR pending) | `assignRecordOperatingCompany` and its named-only capability rows are `after #2199` |
| **#2201 HAR** persona harness target allowlist | **not built into main** (PR in final round) | **Prerequisite for any Codex run** |
| Quote object, quote/discount approval workflow (Q-1 PR 2) | **not built** (specification only) | Out of scope for the matrix; B5 stage 6 stays BLOCKED |
| Delivery / signature (D-1), Warranty (W-1), Sales attribution (F-3), accounting delivery | **not built** (B5 matrix) | No objects to test |
| Ventana operating-company key and records | **blocked** (Owner OQ-09; config PR; fixtures) | All cross-company live rows |

## 4. Registry edits made in this PR

`docs/engineering/ACTIVE_WORKSTREAMS.md`: the lifecycle line of 14 rows whose PR is merged was rewritten from "INTEGRATION (PR open)" to "MERGED `sha` (#PR)", and one **Lane UAT** row was added before "Ready for assignment". No other row was touched. Rows left as they were because the git log since 2026-10-19 does not settle them: Lane Q-1 PR 2 (specification), Finance F-2 PR 2, and older rows from before the window (for example the training documentation row at SANDBOX BUILD).
