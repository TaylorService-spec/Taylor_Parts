# OPEN PR REGISTER — post-Wave-1 reconciliation

**OBSERVED AT:** `64008d5ae0bdd9532909671b15a91122400accf1` = `ATLAS-BASE-2026-09-12-A` · 2026-09-12
**MODE:** READ_ONLY. Nothing merged, closed, rebased or commented. No GitHub API used.

## Method — and the correction that makes the numbers mean anything

PR refs were enumerated with `git --no-pager ls-remote origin 'refs/pull/*/head'`, which **works over
SSH without authentication**. 1,792 refs.

**Ancestry alone is not a sufficient discriminator in this repository, because it is predominantly
squash-merge.** A squash-merged PR's head is never an ancestor of `main`, so an ancestry test reports
**1,098** PRs "not in main" — an overstatement of roughly **15×**. Main's history carries **1,191
squash-style `(#N)` subjects against 511 `Merge pull request` subjects**.

Adding a second discriminator — *is the PR number named in a commit subject reachable from the
baseline* — collapses the set. All 11 Owner-named PRs fall inside the result, which is what validates
the combined test.

| Measure | Count |
|---|---:|
| Total PR refs | 1,792 |
| Head object present locally | 1,678 |
| Head object absent locally | 114 |
| Head **is** ancestor of baseline | 580 |
| Head **not** ancestor | 1,098 |
| PR number named in baseline history (squash ∪ merge) | 1,694 |
| **Absorbed** (ancestor **or** named) | **1,744** |
| **Candidates** (neither) | **71** |

### The one caveat that must travel with this document

**`refs/pull/N/head` exists for open, closed-unmerged AND merged PRs.** The 71 are therefore
*"not absorbed into main; open/closed state unobtainable without the GitHub API."* Over a long
history most not-absorbed refs are expected to be **closed-unmerged** — rejected, superseded,
abandoned or force-pushed away. **71 is not an open-PR backlog and must not be quoted as one.**

### Candidates (71)

```
10 12 23 149 156 159 165 188 409 468 636 786 791 797 825 827 830 919 948 953 954
955 956 957 958 959 960 961 974 975 977 1008 1042 1049 1050 1055 1060 1064 1074
1077 1078 1104 1166 1167 1317 1414 1417 1452 1455 1458 1482 1487 1515 1517 1518
1519 1543 1569 1600 1614 1617 1629 1630 1722 1724 1812 1821 1826 1832 1855 1857
```
`#1008` is the only candidate whose head object is absent locally. 113 of the other 114 absent
objects belong to PRs already named in main.

## The 11 Owner-named PRs

Every head matched `ls-remote` exactly. "Absorbed" = per-file blob comparison against the baseline.

| PR | Disposition | Evidence at baseline | Action | Owner decision |
|---|---|---|---|:-:|
| **#1855** `1d3fa9c6` | **HOLD — PREREQUISITE** | 0/11 files in main. **Creates no Firebase *data* dependency** — `resolveAssistantFirestoreClient` is a hard `return null;` (`firestoreAssistantAdapters.ts:153-157`), so the route fails closed with `ASSISTANT_DATA_SOURCE_NOT_CONFIGURED`. The Render API's Firebase coupling is pre-existing **Auth** verification at mainline. | Hold — it ships a *seam* whose two sources are unbound, and the ZERO-FIREBASE ruling decides what gets bound. | **YES** |
| **#1857** `add03de3` | **MERGE CANDIDATE** | Merges clean. **This PR is the remedy for the very failure mode it was suspected of**: main still carries `status: NOT DEPLOYED — operator action required` at `docs/releases/bin-sandbox-release-2026-09-10.md:4`, and 16 docs carry "NOT DEPLOYED" at baseline. `docs/training/CYCLE_COUNTS.md` is a **first publication**, not a revision. | Merge the release-record correction. Route the training half separately past *training is final*; its `Environment: deployed` line is a live claim needing re-verification. | **YES** (training half) |
| **#1832** `ec0fe13b` | **MERGE CANDIDATE** | Requirement is **live**: `WORKSPACE_NAME = "Taylor Parts"` at `AuthShell.jsx:39`, `AppRail.jsx:376`, and 6 further occurrences across 6 files. | Merge, then finish the sweep. 74 files mention "Taylor Parts"; **566 mention the `taylor-parts` project id — that is a Firebase project identifier, not branding. Do not rename it.** | Scope confirm |
| **#1826** `eadcf3f1` | **DO NOT MERGE AS-IS** | Adds only `.cursor/{environment.json,install.sh,start.sh}`. Every capability it wraps already exists (`field-ops-app-vite/.claude/skills/run-field-ops-app-vite/`, 27 files). Wholly **Firebase-emulator-shaped** (installs `firebase-tools`, boots Firestore/Auth/Functions, JVM dependency) and hardcodes the **retired** identity, contradicting #1832. | Do not merge. Temporary testing need is already met in-repo. A fresh 3-file manifest calling the existing skill, with corrected naming, if Cursor Cloud Agent support is wanted. | No |
| **#1821** `bc4c626f` | **DO NOT MERGE AS-IS** | Owner ruling confirmed. `governedListReadService.ts` defaults `deps.roles ?? COMPATIBILITY_ROLES` at `:392` and `:535`; its own `:130` comment concedes governed Roles "reach NO governed source through it." 277 files, 272 differ, 56 novel, 8 conflicts. | **Salvage, smallest form:** port `governedReadRegistry.ts` (1,036 lines, pure declarative, zero Firebase imports) as a spec module; carry `firebase-removal-closure-ledger.md` forward as **method and classification only, never its scoreboard numbers**. Discard `governedListReadService.ts`. The other 12 novel modules each import `firebase-admin`. | **YES** (salvage scope) |
| **#1724** `6c84aa46` | **ABSORBED BY MAIN** | 11/18 files **byte-identical**, including every visual-system deliverable. All 7 differing files show **main far ahead** — `index.css` +29/−1098. | **Nothing to carry forward.** The token/contrast/accessibility work is already in main byte-identical; **merging would regress `index.css` by ~1,069 net lines.** No constraint on new Atlas design exists here. | No |
| **#1722** `0d5defa8` | **HISTORICAL / EVIDENCE ONLY** | Main still asserts the stale opposite (`Merged is not live` survives in `north-star-open-product-decisions.md`). | Preserve the evidence; do not merge the release-state prose. **Smallest change:** delete the stale sentence. Separately open a Receiving item for its incidental finding — `listReceivingLocationOptions` answering admin with `{"options":[]}`. | No |
| **#1630** `f1f50bae` | **HISTORICAL / EVIDENCE ONLY** | 75-line production-evidence section is unique. Findings are **consistent with main, not superseding it** — the client write is already retired (`recordInventoryAction()` throws unconditionally). | Preserve. **One recommendation is still actionable:** close the `inventory_actions` Rules create path, still open at `firestore.rules:1156` as `allow create: if isAdminOrDispatcher();` with no field validation and no `createdBy` binding. | Only if deletion proposed |
| **#1569** `b9d804fa` | **MERGE CANDIDATE** | **Defect verified still present.** `.ns-dispatch-grid__head` (`index.css:6727`), `__week__head` (`:6795`), `__load__head` (`:6816`) carry only `display:grid` + `border-bottom` — **no `position: sticky` anywhere.** | Merge, or reimplement as ~6 lines of CSS plus the supplied test. Smallest fix in the register. | No |
| **#1487** `8f6fda61` | **ABSORBED BY MAIN** | **Three concerns, not two — all three already byte-identical in main:** release provenance; the legacy stored-id migration (`workOrderComplaintReferenceMigration.ts` + runner + test); and a sales product-reference picker. | Nothing to merge. The migration **code** is in main; whether it is ever **executed** is a live operational decision, not a PR decision. Runner is dry-run by default. | Only to authorize execution |
| **#1414** `b8e68485` | **SUPERSEDED** | PR defines **31** governed Roles vs main's **45**; `trustedWriterCommands.ts` +7/−980. Its unique lines are the older 8-role-era lists. | Close as superseded. Certification world stays frozen; main demonstrably lacks no authorized change. | No |

### Counts by disposition

| Disposition | Count | PRs |
|---|---:|---|
| MERGE CANDIDATE | 3 | #1857, #1832, #1569 |
| DO NOT MERGE AS-IS | 2 | #1826, #1821 |
| ABSORBED BY MAIN | 2 | #1724, #1487 |
| HISTORICAL / EVIDENCE ONLY | 2 | #1722, #1630 |
| HOLD — PREREQUISITE | 1 | #1855 |
| SUPERSEDED | 1 | #1414 |
| REBASE / RECONCILE · HOLD — OWNER DECISION · CLOSE — STALE | 0 | — |

**Owner decision needed on 3 of 11:** #1855, #1857 (training half), #1821 (salvage scope).

## Unobtainable without the GitHub API — none of this was fabricated

Open/closed state · merged-via-GitHub state · titles · creation and update dates · age · author of
record · GitHub-computed mergeability · review approvals · CI state · labels, milestones, linked
issues · comment threads and prior Owner remarks on the PRs themselves.

## #1866–#1897 — Wave-1 source PRs

Proven absorbed: **32/32** source heads are ancestors of the baseline, zero missing objects. Closure
as **SUPERSEDED / ABSORBED BY #1898** is **repository hygiene only** and does not gate Atlas forward
work. **They were not individually merged and must never be described as such.**

## UNPROVEN

1. Open vs closed-unmerged for all 71 candidates — the one discriminator the API holds.
2. `#1008` ancestry — head object absent locally, not fetched.
3. Whether the 23 numbers named in main's subjects with no `refs/pull` entry are issues, cross-repo
   PRs, or deleted refs.
4. `#1630`'s reporting-catalogue recommendation — `reportCatalog.js:68` still lists
   `obj("inventoryAction", …, false)`; what the `false` governs was not traced.
5. `#1722`'s Receiving finding — whether the empty-options defect persists.
