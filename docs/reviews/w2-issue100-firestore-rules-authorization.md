---
artifact_type: authorization-package
gate: W2 / Issue #100 — Firestore Rules (protected boundary)
wave: W2
status: AWAITING OWNER AUTHORIZATION (single decision)
date: 2026-08-05
owner: Claude Code
base_commit: 55c55b8 (origin/main)
spec: docs/specifications/inventory-nav-access-alignment.md
tier: 2 (firestore.rules — always Tier 2, DelegationCharter §2)
---

# W2 / Issue #100 — Firestore Rules authorization package

## 0. Headline: there is NO new Rules code to write

The entire Issue #100 Rules design is **already authored, merged to `main`, and in
dual-copy parity.** Verified against the live tree at `55c55b8`:

- **Helpers present:** `reciprocallyLinkedEmployee()` (line 88), `linkedEmployeeData()`,
  `isActiveOperationalRole(role)` (line 112).
- **Retrofit done:** `canSubmitManualZeroHistoryQuantity()` (line 160) calls
  `isActiveOperationalRole()`.
- **All read grants present:** `reorder_requests` read has all four new branches
  (lines 606–619); `inventory_transactions` read grants PARTS_MANAGER + WAREHOUSE_MANAGER
  (489–491); `reorder_purchase_orders` read (1044) and `reorder_purchase_order_voids`
  read (1102) grant self-scoped PARTS_ASSOCIATE; `inventory_actions` read grants
  WAREHOUSE_MANAGER (1156).
- **`reorder_requests` `allow update` FULLY RESTRUCTURED (PR 3a):** each branch is
  self-contained (no shared outer `isAdminOrDispatcher()`); Assign gains PARTS_MANAGER
  (738); Start Purchasing / Post Purchasing Update / Record PO / Mark Received each gain
  `|| isActiveOperationalRole("PARTS_ASSOCIATE")` ANDed with assignee (752+);
  Approve/Reject/Cancel remain admin/dispatcher-only; Void remains admin/dispatcher+assignee.
- **`reorder_purchase_orders` create** grants PARTS_ASSOCIATE (1053).
- **Parity:** root `firestore.rules` (the `firebase.json` deploy source) and
  `field-ops-app-vite/firestore.rules` are **byte-identical**; both carry all 26
  `isActiveOperationalRole(...)` grant-references.

**Therefore the protected-boundary decision is not "authorize a diff to write." It is
purely about DEPLOYMENT: is `main`'s `firestore.rules` deployed live, and if not, do you
authorize deploying it?** (`firestore.rules` is never auto-deployed — merged ≠ live.)

## 1. CRITICAL: a `firestore.rules` deploy is whole-file, not per-workstream

`firebase deploy --only firestore:rules` publishes the **entire** `firestore.rules`
file. It cannot deploy "just Issue #100." `main`'s current rules also contain other
workstreams' committed changes whose live status I cannot verify from here (no prod
access) — recent `firestore.rules` commits include EI Phase-2 Receiving (`receiving_orders`),
EI Truck Registry, Equipment D4, INV-CONVERGENCE-E Stage B. **Deploying now activates
every committed-but-undeployed rules change across ALL of them, not only Issue #100's.**

This is the single most important thing to weigh before authorizing a deploy. It is why
this needs your decision, and why I cannot self-clear it.

## 2. Affected collections + roles (what a deploy activates for Issue #100)

| Collection | Operation | New grant (additive `||`, nothing existing narrowed) | Roles |
|---|---|---|---|
| `reorder_requests` | read | Queue / oversight / relevant-history / self-scoped | PARTS_MANAGER, PARTS_ASSOCIATE |
| `reorder_requests` | update | Assign (+PM); Start/Update/Record-PO/Receive (+PA, assignee-bound) | PARTS_MANAGER, PARTS_ASSOCIATE |
| `inventory_transactions` | read | catalog/health computed view | PARTS_MANAGER, WAREHOUSE_MANAGER |
| `inventory_actions` | read | part-activity | WAREHOUSE_MANAGER |
| `reorder_purchase_orders` | read + create | self-scoped assignee | PARTS_ASSOCIATE |
| `reorder_purchase_order_voids` | read | self-scoped assignee (create UNCHANGED) | PARTS_ASSOCIATE |
| `canSubmitManualZeroHistoryQuantity()` | (retrofit) | tightened to reciprocal-link + ACTIVE | PM/WM (bug-fix only) |

**No change** to: `employees/{employeeId}` self-read, the full `employees` directory,
`users/{uid}`, Cancel/Void authorization, or any Customer/Service/Financial collection.
**No `firestore.indexes.json` change** (all queries single-field or existing equality/`in`).

## 3. Least-privilege rationale (already satisfied by the committed design)

Every grant flows through the ONE `isActiveOperationalRole(role)` predicate, which
requires reciprocal user↔employee linkage **and** `employmentStatus == "ACTIVE"` **and**
exact `operationalRoles` membership — invalid/inactive/mismatched all fail closed with no
separate branch. Reads are scoped by the same `where()` the client already issues; the
`allow update` restructure keeps every pre-existing field-level validation byte-unchanged
and does not leak Approve/Reject/Assign/Cancel to PARTS_ASSOCIATE (each branch is
independently gated — verified line-by-line, 725–). Catalog/health is a deliberately
Owner-adopted broad read (not an implementation shortcut). This matches the spec's
"Firestore Rules impact" section exactly.

## 4. Emulator test matrix (repo-only — I can EXECUTE this before any deploy)

Proposed pre-deploy proof that the committed rules behave correctly, run in the emulator
from the W2 worktree (correct CWD/branch — avoids the stale-branch rules gotcha). Per role:

- **PARTS_MANAGER:** Queue read (READY_FOR_PARTS_MANAGER) allowed; oversight read allowed;
  relevant-history read allowed only for own reviewed/assigned; Assign update allowed;
  purchasing writes DENIED; another PM's history DENIED.
- **WAREHOUSE_MANAGER:** `inventory_transactions` + `inventory_actions` read allowed;
  Queue/Assign/purchasing writes DENIED.
- **PARTS_ASSOCIATE:** self-assigned `reorder_requests` read allowed; Start/Update/Record-PO/
  Receive allowed on own assigned request; a DIFFERENT associate's request read + writes
  DENIED; Cancel + Void DENIED (proves the restructure didn't leak).
- **Negative (all):** ineligible / broken-linkage / INACTIVE technician DENIED every grant.
- **Regression:** existing admin/dispatcher reads/writes unchanged; `canSubmit…` retrofit
  doesn't regress any valid ACTIVE linked employee.

I can run this now, repo-only, and report pass/fail — no production, no deploy.

## 5. Deploy procedure (if authorized) — verify-rules-deploy skill

1. Confirm Tier-2 authorization recorded (this package + Owner "yes").
2. Confirm dual-copy parity (done — byte-identical) and correct CWD/branch.
3. Run `firebase deploy --only firestore:rules --project taylor-parts` (Owner-run or
   Owner-authorized). **This deploys the WHOLE file (see §1).**
4. Confirm live rules match committed source (fetch live ruleset, compare hash).
5. Record in DECISIONS.md with evidence.

## 6. Rollback

Every Issue #100 grant is additive (read-only or reuses an existing, unmodified write
path) or a tightening retrofit — **no data is altered by any grant.** Rollback = redeploy
the prior ruleset; immediate, no data consequence. Per-role independence means one role's
issue doesn't force rolling back the others. (Whole-file caveat from §1 applies in reverse
too: a rollback redeploys the prior whole file.)

## 7. Live-verification plan (post-deploy)

Per-role, against production, Owner-operated or Owner-authorized (I do not use prod
credentials): each role's surface loads its allowed data and shows the honest failure
state on a denied read (now wired in the W2 Tier-1 branch); SDK-level Rules probes confirm
the negative cases (ineligible/inactive/cross-user denied; PARTS_ASSOCIATE Cancel/Void
denied while its four purchasing writes succeed). Record in DECISIONS.md.

## 8. THE SINGLE OWNER DECISION

One of:
- **(a)** Confirm `main`'s `firestore.rules` is **already deployed** live (you check the
  Firebase Console) → no deploy needed; I proceed to §7 live-verification of the W2 surfaces.
- **(b)** Authorize the whole-file `firestore.rules` **deploy** (§1 blast-radius understood).
  I recommend running §4's emulator matrix repo-only first; say the word and I run it now.
- **(c)** Hold the deploy; I run §4's emulator matrix repo-only as evidence and stop.

No rules modified. Nothing deployed or live-verified. Awaiting your single decision.

## 9. RESOLUTION (2026-08-05) — rules are ALREADY LIVE; the mismatch was a CRLF artifact

- Owner chose §8(c): the repo-only emulator matrix was run — **30 passed / 0 failed**
  (`field-ops-app-vite/test/emulator/inventoryRoleRulesMatrix.mjs`).
- An authorized operator captured the LIVE ruleset:
  `projects/taylor-parts/rulesets/6316db98-9fce-4123-9391-9919e6dd70bd`, SHA-256
  **`ec1f0a9b…13b1ccd1`**.
- **Correction:** the "expected" SHA `1bbf365…95636` reported earlier was `sha256sum` of
  the **Windows working-tree checkout**, which git had normalized to **CRLF** — an
  inflated hash, not the canonical repo rules. The canonical git **blob** of
  `main:firestore.rules` (LF) hashes to **`ec1f0a9b…13b1ccd1`** — identical to the live
  ruleset. `git diff e3e5565..main -- firestore.rules` is empty (byte-identical blobs).
- **Therefore: repo Rules == live Rules. The Issue #100 grants are ALREADY DEPLOYED**
  (in the whole-file ruleset deployed 2026-08-04 at commit `e3e5565`, EI Receiving Phase D).
  No deploy needed; nothing to reconcile. The 30/30 matrix tested exactly the live ruleset.
- **W2 Firestore Rules protected boundary: SATISFIED.** Remaining W2 work is repo-only
  Tier-1 (already done: UI/hook read-error contract) → Codex review + Owner approval at the
  W2 section boundary. Optional live-surface functional verification remains a separate,
  Owner-authorized step (ambient-auth green-light still parked).
- **Lesson:** on Windows, always hash the git blob (`git show <ref>:firestore.rules | sha256sum`),
  never the checked-out file, when comparing against a deployed ruleset SHA.
